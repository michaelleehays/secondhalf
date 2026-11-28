-- Game Plan (apps/gameplan): the simpler installable habit app.
--
-- gameplan_states: one JSON document per user, the whole plan and history. The app keeps a local
--   copy, pushes after changes and pulls on launch; merging happens on the device.
-- gameplan_push_subscriptions: one row per device that turned on reminders (Web Push), with the
--   device's time zone, which reminders it wants and when each was last sent (local date).
-- private.gameplan_push_config: the shared secret the cron job sends, the function URL, and the
--   VAPID key pair. The edge function creates the key pair on first use, so no key is ever typed
--   or pasted anywhere. Readable only through service-role functions.
--
-- pg_cron, every 5 minutes  ->  private.gameplan_invoke_push()  ->  pg_net POST gameplan-push {action: "cron"}
--   the function sends each reminder once per local day, inside a 15-minute window after its time.

create table public.gameplan_states (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now(),
  device     text
);
comment on table public.gameplan_states is 'Game Plan: the whole synced state for one user. Last write wins; devices merge before writing.';

alter table public.gameplan_states enable row level security;
revoke all on public.gameplan_states from anon, authenticated;
grant select, insert, update, delete on public.gameplan_states to authenticated;
create policy "gameplan_states: own" on public.gameplan_states for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.gameplan_push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  timezone   text not null,
  reminders  jsonb not null default '[]'::jsonb,
  last_sent  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gameplan_push_reminders_array check (jsonb_typeof(reminders) = 'array')
);
create index gameplan_push_subscriptions_user on public.gameplan_push_subscriptions (user_id);
comment on table public.gameplan_push_subscriptions is
  'Game Plan: Web Push subscriptions. reminders = [{id, time "HH:MM", days [0-6] or null, title, body}].';

alter table public.gameplan_push_subscriptions enable row level security;
revoke all on public.gameplan_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.gameplan_push_subscriptions to authenticated;
create policy "gameplan_push_subscriptions: own" on public.gameplan_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create schema if not exists private;

create table private.gameplan_push_config (
  id            integer primary key default 1 check (id = 1),
  cron_secret   text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  function_url  text,
  vapid_public  text,
  vapid_private text
);
insert into private.gameplan_push_config default values;
revoke all on private.gameplan_push_config from public, anon, authenticated;

create function public.gameplan_push_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('cron_secret', c.cron_secret, 'vapid_public', c.vapid_public, 'vapid_private', c.vapid_private)
  from private.gameplan_push_config c where c.id = 1;
$$;
revoke all on function public.gameplan_push_config() from public, anon, authenticated;
grant execute on function public.gameplan_push_config() to service_role;

-- Stores the key pair only if none exists yet, and returns whichever pair is stored.
create function public.gameplan_store_vapid(p_public text, p_private text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update private.gameplan_push_config set vapid_public = p_public, vapid_private = p_private
  where id = 1 and vapid_public is null;
  select jsonb_build_object('vapid_public', c.vapid_public, 'vapid_private', c.vapid_private)
  from private.gameplan_push_config c where c.id = 1;
$$;
revoke all on function public.gameplan_store_vapid(text, text) from public, anon, authenticated;
grant execute on function public.gameplan_store_vapid(text, text) to service_role;

-- Does nothing until function_url is set (it is project-specific, so it is set outside migrations).
create function private.gameplan_invoke_push()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select function_url, cron_secret into v_url, v_secret from private.gameplan_push_config where id = 1;
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-gameplan-secret', v_secret),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function private.gameplan_invoke_push() from public, anon, authenticated;

select cron.schedule('gameplan-reminders', '*/5 * * * *', 'select private.gameplan_invoke_push()');
