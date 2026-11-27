-- RLS tests. Run with: supabase test db
-- Three players: A and B each have a full game; C has a profile only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- ---------- Fixtures (as postgres, RLS bypassed) ----------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'a@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'b@example.test'),
  ('cccccccc-0000-0000-0000-000000000000', 'c@example.test');

insert into public.profiles (id, birth_year, end_age, today, level) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 1984, 84, '2026-11-26', 2),
  ('bbbbbbbb-0000-0000-0000-000000000000', 1980, 84, '2026-11-26', 1),
  ('cccccccc-0000-0000-0000-000000000000', 1975, 84, '2026-11-26', 1);

create temp table players (key text, id uuid);
insert into players values ('a', 'aaaaaaaa-0000-0000-0000-000000000000'), ('b', 'bbbbbbbb-0000-0000-0000-000000000000');
grant select on players to authenticated, anon;

insert into public.areas (user_id, area, mode) select id, 'body', 'focus' from players;
insert into public.goals (user_id, id, area, level, title, kind, status)
  select id, 'body-101', 'body', 1, 'Run a 5K', 'milestone', 'open' from players;
insert into public.programs (user_id, id, goal_id, current_week, threshold)
  select id, 'p1', 'body-101', 1, 3 from players;
insert into public.habits (user_id, id, goal_id, area, title, full_dose, minimum_dose,
                           weekly_target_focus, weekly_target_maintain, weekly_target_rest)
  select id, 'run', 'body-101', 'body', 'Tempo run', '25 minutes', '15-minute jog', 4, 2, 0 from players;
insert into public.check_ins (user_id, habit_id, date, result) select id, 'run', '2026-11-25', 'full' from players;
insert into public.resistance (user_id, id, strength, target_area) select id, 'fatigue', 2, 'body' from players;
insert into public.game_plans (user_id, id, resistance, text) select id, 'gp1', 'fatigue', 'If tired, 15 minutes.' from players;
insert into public.rule_adjustments (user_id, id, trigger, message, effect, starts_on, ends_on)
  select id, 'r1', 'fatigue', 'Your minimum counts as full for 2 weeks.',
         '{"kind":"minimum_counts_as_full","habitId":"run"}', '2026-11-20', '2026-12-04' from players;
insert into public.character (user_id, health, strength, grace_days_left) select id, 72, 64, 2 from players;
insert into public.recovery (user_id, cause, started_on, day, days_done, habit_title)
  select id, 'auto', '2026-11-24', 3, 2, 'Tempo run' from players;
insert into public.seasons (user_id, index, starts_on, focus) select id, 1, '2026-10-26', '{body,work}' from players;
insert into public.ledger (user_id, date, kind, score, credits) select id, '2026-11-25', 'habit', 15, 10 from players;
insert into public.game_events (user_id, date, event)
  select id, '2026-11-25', '{"type":"points","score":15,"credits":10,"reason":"habit"}' from players;

-- ---------- Every table has RLS on ----------
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'every public table has row-level security enabled'
);

-- ---------- As player A ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000000","role":"authenticated"}', true);

select results_eq('select id from public.profiles', $$values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid)$$, 'A reads only own profile');

-- Each game table: A sees exactly one row, and it is A's.
select results_eq(format('select user_id from public.%I', t), $$values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid)$$,
                  'A reads only own rows in ' || t)
from unnest(array['areas','goals','programs','habits','check_ins','resistance','game_plans',
                  'rule_adjustments','character','recovery','seasons','ledger','game_events']) as t;

-- Writing as someone else is refused.
select throws_ok($$insert into public.profiles (id, birth_year, end_age, today, level)
                   values ('bbbbbbbb-0000-0000-0000-000000000000', 1990, 84, '2026-11-26', 1)$$,
                 '42501', null, 'A cannot insert a profile for B');
select throws_ok($$insert into public.goals (user_id, id, area, level, title, kind, status)
                   values ('bbbbbbbb-0000-0000-0000-000000000000', 'x', 'mind', 1, 'x', 'system', 'open')$$,
                 '42501', null, 'A cannot insert a goal for B');
select throws_ok($$insert into public.check_ins (user_id, habit_id, date, result)
                   values ('bbbbbbbb-0000-0000-0000-000000000000', 'run', '2026-11-26', 'full')$$,
                 '42501', null, 'A cannot check in for B');
select throws_ok($$insert into public.ledger (user_id, date, kind, score, credits)
                   values ('bbbbbbbb-0000-0000-0000-000000000000', '2026-11-26', 'habit', 999, 999)$$,
                 '42501', null, 'A cannot write to B''s ledger');
select throws_ok($$update public.goals set user_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'body-101'$$,
                 '42501', null, 'A cannot hand a row over to B');

-- Updates and deletes of B's rows touch nothing.
select is_empty($$update public.character set health = 0 where user_id = 'bbbbbbbb-0000-0000-0000-000000000000' returning 1$$,
                'A cannot update B''s character');
select is_empty($$update public.profiles set score = 0 where id = 'bbbbbbbb-0000-0000-0000-000000000000' returning 1$$,
                'A cannot update B''s profile');
select is_empty($$delete from public.goals where user_id = 'bbbbbbbb-0000-0000-0000-000000000000' returning 1$$,
                'A cannot delete B''s goals');
select is_empty($$delete from public.seasons where user_id = 'bbbbbbbb-0000-0000-0000-000000000000' returning 1$$,
                'A cannot delete B''s seasons');

-- A cannot attach a habit to a goal A does not own (composite foreign key).
select throws_ok($$insert into public.habits (user_id, id, goal_id, area, title, full_dose, minimum_dose,
                                               weekly_target_focus, weekly_target_maintain, weekly_target_rest)
                   values ('aaaaaaaa-0000-0000-0000-000000000000', 'h2', 'mind-101', 'mind', 'x', 'x', 'x', 1, 1, 0)$$,
                 '23503', null, 'a habit must point at one of the player''s own goals');

-- A's own writes work.
select lives_ok($$update public.character set health = 75 where user_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
                'A updates own character');
select lives_ok($$insert into public.check_ins (user_id, habit_id, date, result, reason)
                  values ('aaaaaaaa-0000-0000-0000-000000000000', 'run', '2026-11-26', 'missed', 'fatigue')$$,
                'A checks in own habit');
select lives_ok($$insert into public.ledger (user_id, date, kind, score, credits)
                  values ('aaaaaaaa-0000-0000-0000-000000000000', '2026-11-26', 'habit', 6, 4)$$,
                'A appends to own ledger');

-- Ledger and events are append-only, even for the owner.
select throws_ok($$update public.ledger set score = 1e9$$, '42501', null, 'ledger rows cannot be updated');
select throws_ok($$delete from public.ledger$$, '42501', null, 'ledger rows cannot be deleted');
select throws_ok($$update public.game_events set event = '{"type":"knocked_down"}'$$, '42501', null, 'events cannot be updated');
select throws_ok($$delete from public.game_events$$, '42501', null, 'events cannot be deleted');

-- Contract shape checks.
select throws_ok($$insert into public.check_ins (user_id, habit_id, date, result)
                   values ('aaaaaaaa-0000-0000-0000-000000000000', 'run', '2026-11-27', 'missed')$$,
                 '23514', null, 'a missed check-in needs a reason');
select throws_ok($$insert into public.check_ins (user_id, habit_id, date, result)
                   values ('aaaaaaaa-0000-0000-0000-000000000000', 'run', '2026-11-25', 'minimum')$$,
                 '23505', null, 'one check-in per habit per day');

-- ---------- Crews ----------
select lives_ok($$insert into public.crews (id, name, created_by)
                  values ('11111111-0000-0000-0000-000000000000', 'Sunday runners', 'aaaaaaaa-0000-0000-0000-000000000000')$$,
                'A creates a crew');
select lives_ok($$insert into public.crew_members (crew_id, user_id, role) values
                  ('11111111-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'owner'),
                  ('11111111-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'member')$$,
                'the crew owner adds members');
select throws_ok($$insert into public.crews (name, created_by) values ('x', 'bbbbbbbb-0000-0000-0000-000000000000')$$,
                 '42501', null, 'A cannot create a crew as B');

-- As B: sees the crew, cannot add people, can leave.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000000","role":"authenticated"}', true);
select results_eq('select name from public.crews', $$values ('Sunday runners'::text)$$, 'a member sees the crew');
select is((select count(*)::int from public.crew_members), 2, 'a member sees the member list');
select throws_ok($$insert into public.crew_members (crew_id, user_id)
                   values ('11111111-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000000')$$,
                 '42501', null, 'a member cannot add people');
select is_empty($$update public.crews set name = 'mine now' returning 1$$, 'a member cannot rename the crew');
select is((select health from public.character), 72::double precision, 'B''s character was not touched by A');

-- As C: outside the crew, sees nothing.
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000000","role":"authenticated"}', true);
select is_empty('select 1 from public.crews', 'a non-member cannot see the crew');
select is_empty('select 1 from public.crew_members', 'a non-member cannot see the members');
select is_empty('select 1 from public.goals', 'a player with no goals sees no goals');

-- B leaves.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000000","role":"authenticated"}', true);
select isnt_empty($$delete from public.crew_members where user_id = 'bbbbbbbb-0000-0000-0000-000000000000' returning 1$$,
                  'a member can leave');

-- ---------- Signed out ----------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select * from public.profiles', '42501', null, 'signed out: no access to profiles');
select throws_ok('select * from public.check_ins', '42501', null, 'signed out: no access to check-ins');
select throws_ok('select * from public.crews', '42501', null, 'signed out: no access to crews');

select * from finish();
rollback;
