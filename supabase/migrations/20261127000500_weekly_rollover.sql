-- Weekly rollover (closeWeek) every Sunday at 23:00 in each player's own time zone.
--
-- Flow, once an hour:
--   pg_cron  ->  pg_net POST /functions/v1/close-week  ->  Edge Function (service role)
--     1. due_week_rollovers(now)    players whose latest local Sunday 23:00 has passed and has no rollover yet
--     2. load_game_state            per player
--     3. engine closeWeek           in TypeScript (packages/api runWeeklyRollover)
--     4. save_week_rollover         state + ledger + events + the week_rollovers row, one transaction
-- Step 4 is what makes it idempotent: the week_rollovers primary key (user_id, week_start) means a
-- second run for the same week fails its insert and rolls back its whole save, so a week can never be
-- closed twice, even with two runs at once. A failed run leaves no row, so the next hour retries it.
-- Only the latest week is rolled; a player who missed several weeks gets one rollover, not a backfill.

create table public.week_rollovers (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  week_start   date not null,
  week_ending  date not null,
  rolled_at    timestamptz not null default now(),
  event_count  integer not null default 0,
  primary key (user_id, week_start),
  constraint week_rollovers_week check (week_ending = week_start + 6 and extract(isodow from week_ending) = 7)
);
comment on table public.week_rollovers is
  'One row per player per closed week (Monday week_start .. Sunday week_ending). Written only by save_week_rollover.';

alter table public.week_rollovers enable row level security;
revoke all on public.week_rollovers from anon, authenticated;
grant select on public.week_rollovers to authenticated;
create policy "week_rollovers: read own" on public.week_rollovers for select to authenticated
  using (user_id = (select auth.uid()));

-- Players due a rollover at p_now. The latest local Sunday 23:00 at or before p_now is the week's close;
-- a player is due if that week has no rollover row. Profiles with an unknown time zone are skipped.
create function public.due_week_rollovers(p_now timestamptz, p_limit integer default 500)
returns table (user_id uuid, week_start date, week_ending date)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Materialized so the time-zone filter runs before "at time zone": otherwise the planner may
  -- evaluate the conversion first, and one bad zone would fail the whole job.
  with zones as materialized (
    select name from pg_catalog.pg_timezone_names
  ),
  local_now as materialized (
    select p.id, (p_now at time zone p.timezone) as ts
    from public.profiles p
    join zones z on z.name = p.timezone
  ),
  closes as (
    select id,
           case
             when (ts::date - extract(dow from ts)::int) + time '23:00' <= ts
               then ts::date - extract(dow from ts)::int
             else ts::date - extract(dow from ts)::int - 7
           end as sunday
    from local_now
  )
  select c.id, c.sunday - 6, c.sunday
  from closes c
  where not exists (
    select 1 from public.week_rollovers w where w.user_id = c.id and w.week_start = c.sunday - 6
  )
  order by c.id
  limit p_limit;
$$;
comment on function public.due_week_rollovers(timestamptz, integer) is
  'Players whose latest local Sunday 23:00 at or before p_now has not been rolled over. Service role only.';

-- Save a closeWeek StepResult and record the rollover in one transaction.
create function public.save_week_rollover(
  p_user_id uuid, p_week_ending date, p_state jsonb, p_ledger jsonb, p_events jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the weekly job closes weeks.' using errcode = '42501';
  end if;
  if extract(isodow from p_week_ending) <> 7 then
    raise exception 'week ending % is not a Sunday.', p_week_ending using errcode = '22023';
  end if;

  -- Fails with unique_violation if this week is already closed, which rolls back everything below.
  insert into public.week_rollovers (user_id, week_start, week_ending, event_count)
  values (p_user_id, p_week_ending - 6, p_week_ending, jsonb_array_length(coalesce(p_events, '[]')));

  perform public.save_step_result(p_user_id, p_state, p_ledger, p_events);
end;
$$;
comment on function public.save_week_rollover(uuid, date, jsonb, jsonb, jsonb) is
  'closeWeek result + week_rollovers row, atomically. Raises 23505 if the week was already closed.';

revoke all on function public.due_week_rollovers(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.save_week_rollover(uuid, date, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.due_week_rollovers(timestamptz, integer) to service_role;
grant execute on function public.save_week_rollover(uuid, date, jsonb, jsonb, jsonb) to service_role;

-- ---------- Schedule ----------
-- Hourly at minute 7 (off the top of the hour, when scheduled jobs pile up). Catches every time zone,
-- including :30 and :45 offsets, within the hour after its Sunday 23:00.
-- The URL and key come from Vault, so nothing project-specific is in this migration. Until both secrets
-- exist (see supabase/README.md) the job runs and does nothing.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function private.invoke_close_week()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'close_week_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'close_week_service_key';
  if v_url is null or v_key is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function private.invoke_close_week() from public, anon, authenticated;

select cron.schedule('close-week-hourly', '7 * * * *', 'select private.invoke_close_week()');
