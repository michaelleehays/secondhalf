-- Weekly rollover: who is due, never moving a date backwards, idempotency, versions, and access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000000', 'ny@example.test'),
  ('e2000000-0000-0000-0000-000000000000', 'tokyo@example.test'),
  ('e3000000-0000-0000-0000-000000000000', 'kolkata@example.test'),
  ('e4000000-0000-0000-0000-000000000000', 'bad-zone@example.test'),
  ('e5000000-0000-0000-0000-000000000000', 'ahead@example.test'),
  ('e6000000-0000-0000-0000-000000000000', 'new@example.test');
-- Everyone joined on 1 Nov and last played on 20 Nov, except:
--   e5 has already played on Monday 30 Nov (today is past the 29 Nov close)
--   e6 signed up on Monday 30 Nov (after the 29 Nov close)
insert into public.profiles (id, birth_year, end_age, today, timezone, level, created_at) values
  ('e1000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-20', 'America/New_York', 1, '2026-11-01 12:00Z'),
  ('e2000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-20', 'Asia/Tokyo', 1, '2026-11-01 12:00Z'),
  ('e3000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-20', 'Asia/Kolkata', 1, '2026-11-01 12:00Z'),
  ('e4000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-20', 'Mars/Olympus_Mons', 1, '2026-11-01 12:00Z'),
  ('e5000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-30', 'America/New_York', 1, '2026-11-01 12:00Z'),
  ('e6000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-30', 'America/New_York', 1, '2026-11-30 15:00Z');

create temp table due (user_id uuid, week_start date, week_ending date);
create function pg_temp.due_at(t timestamptz) returns setof due language sql as $$
  select * from public.due_week_rollovers(t) where user_id::text like 'e_000000-%'
$$;
create function pg_temp.due_week(t timestamptz, u uuid) returns date language sql as $$
  select week_ending from pg_temp.due_at(t) where user_id = u
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------- Who is due ----------
select is(pg_temp.due_week('2026-11-29 22:59 America/New_York', 'e1000000-0000-0000-0000-000000000000'), '2026-11-22'::date,
          'one minute before Sunday 23:00 local, the due week is the previous one');
select results_eq(
  $$select week_start, week_ending from pg_temp.due_at('2026-11-29 23:00 America/New_York') where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-23'::date, '2026-11-29'::date)$$, 'at Sunday 23:00 local, this week (Mon 23 to Sun 29 Nov) is due');
select is(pg_temp.due_week('2026-11-29 23:00 America/New_York', 'e2000000-0000-0000-0000-000000000000'), '2026-11-29'::date,
          'each player is judged in their own time zone (Monday 13:00 in Tokyo)');
select is(pg_temp.due_week('2026-11-29 17:29 UTC', 'e3000000-0000-0000-0000-000000000000'), '2026-11-22'::date,
          'Kolkata (UTC+5:30) is not due for 29 Nov at 17:29 UTC');
select is(pg_temp.due_week('2026-11-29 17:30 UTC', 'e3000000-0000-0000-0000-000000000000'), '2026-11-29'::date,
          'Kolkata (UTC+5:30) is due at 17:30 UTC');
select is_empty($$select 1 from pg_temp.due_at(now()) where user_id = 'e4000000-0000-0000-0000-000000000000'$$,
                'a profile with an unknown time zone is skipped, not an error');

-- ---------- Never behind the player ----------
select is_empty($$select 1 from pg_temp.due_at('2026-11-30 03:00 America/New_York') where user_id = 'e5000000-0000-0000-0000-000000000000'$$,
                'a player whose day is already past the close is not due (their date never moves back)');
select is_empty($$select 1 from pg_temp.due_at('2026-11-30 18:00 America/New_York') where user_id = 'e6000000-0000-0000-0000-000000000000'$$,
                'a player who signed up after the close is not due for a week they never played');
select is(pg_temp.due_week('2026-12-06 23:30 America/New_York', 'e6000000-0000-0000-0000-000000000000'), '2026-12-06'::date,
          'the new player is due for their first full Sunday');

-- ---------- Closing a week ----------
create temp table st (s jsonb);
insert into st values ($json${
  "userId": "e1000000-0000-0000-0000-000000000000",
  "birthYear": 1984, "endAge": 84, "today": "2026-11-29", "timezone": "America/New_York",
  "level": 1, "score": 100, "credits": 10,
  "modes": {"body": "focus", "mind": "maintain", "work": "maintain", "people": "maintain", "money": "rest"},
  "goals": [], "programs": [], "habits": [], "gamePlans": [], "rules": [],
  "resistance": {"fatigue": {"id": "fatigue", "strength": 2, "reports14d": 1, "targetArea": "body"}},
  "character": {"health": 72, "strength": 64, "graceDaysLeft": 2},
  "recovery": null,
  "season": {"index": 1, "startsOn": "2026-10-26", "focus": ["body"], "autoRecoveryUsed": false, "lifeEventPauseUsed": false},
  "weekProgress": {}
}$json$);
grant select on st to service_role, authenticated;
create function pg_temp.version(u uuid) returns bigint language sql as $$ select version from public.profiles where id = u $$;

select lives_ok(
  $$select public.save_week_rollover('e1000000-0000-0000-0000-000000000000', '2026-11-29',
      (select s from st), '[{"date":"2026-11-29","kind":"dividend","score":45,"credits":0}]',
      '[{"type":"points","score":45,"credits":0,"reason":"dividend"}]', 0)$$,
  'the job closes a week');
select results_eq(
  $$select week_start, week_ending, event_count from public.week_rollovers where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-23'::date, '2026-11-29'::date, 1)$$, 'the rollover is recorded');
select is(pg_temp.version('e1000000-0000-0000-0000-000000000000'), 1::bigint, 'the save bumped the version');
select is_empty($$select 1 from pg_temp.due_at('2026-11-30 03:00 America/New_York') where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
                'a closed week is no longer due');

select throws_ok(
  $$select public.save_week_rollover('e1000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{score}', '999999'),
      '[{"date":"2026-11-29","kind":"dividend","score":45,"credits":0}]', '[]', 1)$$,
  '23505', null, 'a week cannot be closed twice');
select is((select score from public.profiles where id = 'e1000000-0000-0000-0000-000000000000'), 100::double precision,
          'the refused second close changed nothing');
select is((select count(*)::int from public.ledger where user_id = 'e1000000-0000-0000-0000-000000000000'), 1,
          'the dividend was paid once');

select throws_ok(
  $$select public.save_week_rollover('e5000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{userId}', '"e5000000-0000-0000-0000-000000000000"'), '[]', '[]', 0)$$,
  '22023', null, 'a week ending before the player''s current day is refused');
select throws_ok(
  $$select public.save_week_rollover('e2000000-0000-0000-0000-000000000000', '2026-11-29', (select s from st), '[]', '[]', 0)$$,
  '22023', 'state.userId does not match the user being saved.', 'the state must belong to the player being closed');
select throws_ok(
  $$select public.save_week_rollover('e2000000-0000-0000-0000-000000000000', '2026-11-28',
      jsonb_set((select s from st), '{userId}', '"e2000000-0000-0000-0000-000000000000"'), '[]', '[]', 0)$$,
  '22023', null, 'a week ends on a Sunday');

-- ---------- A check-in saved while the job ran ----------
-- The job loaded e2 at version 0. A check-in is saved (version 1). The job's save must be refused.
select lives_ok(
  $$select public.save_step_result('e2000000-0000-0000-0000-000000000000',
      jsonb_set(jsonb_set((select s from st), '{userId}', '"e2000000-0000-0000-0000-000000000000"'), '{score}', '115'),
      '[]', '[]')$$,
  'a check-in saves in the Sunday-night window');
select throws_ok(
  $$select public.save_week_rollover('e2000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{userId}', '"e2000000-0000-0000-0000-000000000000"'), '[]', '[]', 0)$$,
  '40001', null, 'the rollover built from the older load is refused');
select ok(
  (select score = 115 and not exists (select 1 from public.week_rollovers w where w.user_id = p.id)
     from public.profiles p where p.id = 'e2000000-0000-0000-0000-000000000000'),
  'the check-in is kept and the week stays open for the next run');

-- ---------- Players cannot run or fake the job ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
select throws_ok($$select * from public.due_week_rollovers(now())$$, '42501', null, 'a player cannot list who is due');
select throws_ok(
  $$select public.save_week_rollover('e2000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{userId}', '"e2000000-0000-0000-0000-000000000000"'), '[]', '[]', 1)$$,
  '42501', null, 'a player cannot close their own week');

select * from finish();
rollback;
