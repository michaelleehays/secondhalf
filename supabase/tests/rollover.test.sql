-- Weekly rollover: who is due, idempotency, and who may call it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000000', 'ny@example.test'),
  ('e2000000-0000-0000-0000-000000000000', 'tokyo@example.test'),
  ('e3000000-0000-0000-0000-000000000000', 'kolkata@example.test'),
  ('e4000000-0000-0000-0000-000000000000', 'bad-zone@example.test');
insert into public.profiles (id, birth_year, end_age, today, timezone, level) values
  ('e1000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-29', 'America/New_York', 1),
  ('e2000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-29', 'Asia/Tokyo', 1),
  ('e3000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-29', 'Asia/Kolkata', 1),
  ('e4000000-0000-0000-0000-000000000000', 1984, 84, '2026-11-29', 'Mars/Olympus_Mons', 1);

-- Only players from this test (the seed may add more).
create temp table due (user_id uuid, week_start date, week_ending date);
create function pg_temp.due_at(t timestamptz) returns setof due language sql as $$
  select * from public.due_week_rollovers(t)
  where user_id in ('e1000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000000',
                    'e3000000-0000-0000-0000-000000000000', 'e4000000-0000-0000-0000-000000000000')
$$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Sunday 29 Nov 2026, 22:59 in New York: New York's week is not closed yet, its last close was 22 Nov.
select results_eq(
  $$select week_ending from pg_temp.due_at('2026-11-29 22:59 America/New_York') where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-22'::date)$$, 'one minute before Sunday 23:00 local, the due week is the previous one');
select results_eq(
  $$select week_start, week_ending from pg_temp.due_at('2026-11-29 23:00 America/New_York') where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-23'::date, '2026-11-29'::date)$$, 'at Sunday 23:00 local, this week (Mon 23 to Sun 29 Nov) is due');
-- The same instant is Monday 13:00 in Tokyo: Tokyo's Sunday 23:00 passed hours ago.
select results_eq(
  $$select week_ending from pg_temp.due_at('2026-11-29 23:00 America/New_York') where user_id = 'e2000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-29'::date)$$, 'each player is judged in their own time zone');
-- Half-hour offset: Kolkata's Sunday 23:00 is 17:30 UTC.
select results_eq(
  $$select week_ending from pg_temp.due_at('2026-11-29 17:29 UTC') where user_id = 'e3000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-22'::date)$$, 'Kolkata (UTC+5:30) is not due at 17:29 UTC');
select results_eq(
  $$select week_ending from pg_temp.due_at('2026-11-29 17:30 UTC') where user_id = 'e3000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-29'::date)$$, 'Kolkata (UTC+5:30) is due at 17:30 UTC');
select is_empty(
  $$select 1 from pg_temp.due_at(now()) where user_id = 'e4000000-0000-0000-0000-000000000000'$$,
  'a profile with an unknown time zone is skipped, not an error');

-- Closing a week records it and removes the player from the due list.
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

select lives_ok(
  $$select public.save_week_rollover('e1000000-0000-0000-0000-000000000000', '2026-11-29',
      (select s from st), '[{"date":"2026-11-29","kind":"dividend","score":45,"credits":0}]',
      '[{"type":"points","score":45,"credits":0,"reason":"dividend"}]')$$,
  'the job closes a week');
select results_eq(
  $$select week_start, week_ending, event_count from public.week_rollovers where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  $$values ('2026-11-23'::date, '2026-11-29'::date, 1)$$, 'the rollover is recorded');
select is_empty(
  $$select 1 from pg_temp.due_at('2026-11-30 03:00 America/New_York') where user_id = 'e1000000-0000-0000-0000-000000000000'$$,
  'a closed week is no longer due');

-- Second close of the same week: refused, and its save is rolled back with it.
select throws_ok(
  $$select public.save_week_rollover('e1000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{score}', '999999'),
      '[{"date":"2026-11-29","kind":"dividend","score":45,"credits":0}]', '[]')$$,
  '23505', null, 'a week cannot be closed twice');
select is((select score from public.profiles where id = 'e1000000-0000-0000-0000-000000000000'), 100::double precision,
          'the refused second close changed nothing');
select is((select count(*)::int from public.ledger where user_id = 'e1000000-0000-0000-0000-000000000000'), 1,
          'the dividend was paid once');

select throws_ok(
  $$select public.save_week_rollover('e1000000-0000-0000-0000-000000000000', '2026-11-28', (select s from st), '[]', '[]')$$,
  '22023', null, 'a week ends on a Sunday');

-- Players cannot run or fake the job.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
select throws_ok($$select * from public.due_week_rollovers(now())$$, '42501', null, 'a player cannot list who is due');
select throws_ok(
  $$select public.save_week_rollover('e2000000-0000-0000-0000-000000000000', '2026-11-29',
      jsonb_set((select s from st), '{userId}', '"e2000000-0000-0000-0000-000000000000"'), '[]', '[]')$$,
  '42501', null, 'a player cannot close their own week');

select * from finish();
rollback;
