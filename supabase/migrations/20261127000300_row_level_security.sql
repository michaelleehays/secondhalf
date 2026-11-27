-- Row-level security: a signed-in user reads and writes only their own rows.
-- anon gets nothing. service_role (server jobs such as closeWeek) bypasses RLS as usual.
--
-- ledger and game_events are append-only for users: select and insert, never update or delete.
-- Note: until score is computed server-side, the client is trusted with its own numbers.

-- profiles: the row whose id is the user.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: insert own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: delete own" on public.profiles for delete to authenticated using (id = (select auth.uid()));

-- Game tables keyed by user_id with full read and write by the owner.
-- goals and habits get no delete: they are soft-deleted with archived_at (see the tables migration).
do $$
declare
  t text;
begin
  foreach t in array array[
    'areas', 'goals', 'programs', 'habits', 'check_ins', 'resistance',
    'game_plans', 'rule_adjustments', 'character', 'recovery', 'seasons'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || ': read own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || ': insert own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || ': update own', t);
    if t in ('goals', 'habits') then
      execute format('revoke delete, truncate on public.%I from authenticated', t);
    else
      execute format(
        'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
        t || ': delete own', t);
    end if;
  end loop;
end
$$;

-- habit_history is security_invoker, so check_ins policies apply to it.
revoke all on public.habit_history from anon;
revoke all on public.habit_history from authenticated;
grant select on public.habit_history to authenticated;

-- Append-only history.
do $$
declare
  t text;
begin
  foreach t in array array['ledger', 'game_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke update, delete, truncate on public.%I from authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || ': read own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || ': insert own', t);
  end loop;
end
$$;

-- Crews are shared by design: members see their crew and its member list.
-- Helpers are security definer so policies on crew_members can look at crew_members
-- without recursing into their own policy. They live outside the exposed API schema.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_crew_member(p_crew_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crew_members m
    where m.crew_id = p_crew_id and m.user_id = (select auth.uid())
  );
$$;

create function private.is_crew_owner(p_crew_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crews c
    where c.id = p_crew_id and c.created_by = (select auth.uid())
  );
$$;

revoke all on function private.is_crew_member(uuid) from public, anon;
revoke all on function private.is_crew_owner(uuid) from public, anon;
grant execute on function private.is_crew_member(uuid) to authenticated;
grant execute on function private.is_crew_owner(uuid) to authenticated;

alter table public.crews enable row level security;
revoke all on public.crews from anon;
create policy "crews: read if owner or member" on public.crews for select to authenticated
  using (created_by = (select auth.uid()) or (select private.is_crew_member(id)));
create policy "crews: create as self" on public.crews for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "crews: owner updates" on public.crews for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "crews: owner deletes" on public.crews for delete to authenticated
  using (created_by = (select auth.uid()));

alter table public.crew_members enable row level security;
revoke all on public.crew_members from anon;
create policy "crew_members: read own crews" on public.crew_members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_crew_member(crew_id)));
-- A membership row can only be inserted for yourself. Until invites exist, the only crew you can
-- join is one you created; accepting an invite will widen this check when the invites table lands.
create policy "crew_members: join as self" on public.crew_members for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_crew_owner(crew_id)));
-- No update policy: a membership row has nothing to change.
create policy "crew_members: leave or owner removes" on public.crew_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_crew_owner(crew_id)));
