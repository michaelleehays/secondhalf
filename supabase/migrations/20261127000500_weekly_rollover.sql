-- Weekly rollover (closeWeek) every Sunday at 23:00 in each player's own time zone.
--
-- Flow, once an hour:
--   pg_cron  ->  pg_net POST /functions/v1/close-week  ->  Edge Function (service role)
--     1. due_week_rollovers(now)    players whose latest local Sunday 23:00 has passed and has no rollover yet
--     2. load_game_state            per player
--     3. engine closeWeek           in TypeScript (packages/api runWeeklyRollover)
--     4. save_week_rollover         state + ledger + events + the week_rollovers row, one transaction
--                                   (defined in ..._000800, with the optimistic version check)
-- Step 4 is what makes it idempotent: the week_rollovers primary key (user_id, week_start) means a
-- second run for the same week fails its insert and rolls back its whole save, so a week can never be
-- closed twice, even with two runs at once. A failed run leaves no row, so the next hour retries it.
-- Only the latest week is rolled; a player who missed several weeks gets one rollover, not a backfill.
-- A week is never closed behind the player: it must end on or after profiles.today (closeWeek sets today to
-- the week ending), and the player must have signed up on or before that Sunday, local time.

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
    select p.id, p.today, (p.created_at at time zone p.timezone)::date as joined_on,
           (p_now at time zone p.timezone) as ts
    from public.profiles p
    join zones z on z.name = p.timezone
  ),
  closes as (
    select id, today, joined_on,
           case
             when (ts::date - extract(dow from ts)::int) + time '23:00' <= ts
               then ts::date - extract(dow from ts)::int
             else ts::date - extract(dow from ts)::int - 7
           end as sunday
    from local_now
  )
  select c.id, c.sunday - 6, c.sunday
  from closes c
  where c.sunday >= c.today
    and c.sunday >= c.joined_on
    and not exists (
    select 1 from public.week_rollovers w where w.user_id = c.id and w.week_start = c.sunday - 6
  )
  order by c.id
  limit p_limit;
$$;
comment on function public.due_week_rollovers(timestamptz, integer) is
  'Players whose latest local Sunday 23:00 at or before p_now has not been rolled over. Service role only.';

revoke all on function public.due_week_rollovers(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.due_week_rollovers(timestamptz, integer) to service_role;

-- ---------- Schedule ----------
-- Hourly at minute 7 (off the top of the hour, when scheduled jobs pile up). Catches every time zone,
-- including :30 and :45 offsets, within the hour after its Sunday 23:00.
-- The URL and a dedicated shared secret come from Vault, so nothing project-specific is in this migration.
-- The same secret is set on the function as CLOSE_WEEK_SECRET. Until both Vault secrets exist
-- (see supabase/README.md) the job runs and does nothing.
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
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'close_week_secret';
  if v_url is null or v_key is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Close-Week-Secret', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function private.invoke_close_week() from public, anon, authenticated;

select cron.schedule('close-week-hourly', '7 * * * *', 'select private.invoke_close_week()');
