-- save_step_result: a malformed state is refused whole and leaves saved data intact.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000000', 'd@example.test');

create temp table good (s jsonb);
insert into good values ($json${
  "userId": "dddddddd-0000-0000-0000-000000000000",
  "birthYear": 1984, "endAge": 84, "today": "2026-11-26", "timezone": "America/New_York",
  "level": 1, "score": 100, "credits": 10,
  "modes": {"body": "focus", "mind": "maintain", "work": "maintain", "people": "maintain", "money": "rest"},
  "goals": [{"id": "body-101", "area": "body", "level": 1, "title": "Run a 5K", "kind": "milestone",
             "status": "in_progress", "progress": 0.4, "risk": 0, "frozen": false}],
  "programs": [{"id": "p1", "goalId": "body-101", "weeks": [{"index": 1, "sessions": ["Easy 3K"]}],
                "currentWeek": 1, "done": [false], "threshold": 3}],
  "habits": [{"id": "run", "goalId": "body-101", "area": "body", "title": "Tempo run", "fullDose": "25 minutes",
              "minimumDose": "15-minute jog", "weeklyTarget": {"focus": 4, "maintain": 2, "rest": 0},
              "maintenance": false, "history": [{"date": "2026-11-25", "result": "full"}]}],
  "resistance": {"fatigue": {"id": "fatigue", "strength": 2, "reports14d": 1, "targetArea": "body"}},
  "gamePlans": [{"id": "gp1", "resistance": "fatigue", "text": "If tired, 15 minutes.", "equipped": true}],
  "rules": [],
  "character": {"health": 72, "strength": 64, "graceDaysLeft": 2},
  "recovery": null,
  "season": {"index": 1, "startsOn": "2026-10-26", "focus": ["body"], "autoRecoveryUsed": false, "lifeEventPauseUsed": false},
  "weekProgress": {}
}$json$);
grant select on good to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000000","role":"authenticated"}', true);

select lives_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000', (select s from good), '[]', '[]')$$,
                'a well-formed state saves');

select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000', (select s - 'goals' from good), '[]', '[]')$$,
                 '22023', 'state.goals must be an array.', 'a state missing goals is refused');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000',
                   (select jsonb_set(s, '{habits}', 'null') from good), '[]', '[]')$$,
                 '22023', 'state.habits must be an array.', 'a state with null habits is refused');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000', (select s - 'programs' from good), '[]', '[]')$$,
                 '22023', null, 'a state missing programs is refused');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000', (select s - 'gamePlans' from good), '[]', '[]')$$,
                 '22023', null, 'a state missing game plans is refused');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000', (select s - 'character' from good), '[]', '[]')$$,
                 '22023', 'state.character must be an object.', 'a state missing character is refused');

-- Nothing was archived or deleted by the refused saves.
select is((select count(*)::int from public.goals where archived_at is null), 1, 'goals are intact');
select is((select count(*)::int from public.habits where archived_at is null), 1, 'habits are intact');
select is((select count(*)::int from public.programs), 1, 'programs are intact');
select is((select count(*)::int from public.game_plans), 1, 'game plans are intact');
select is((select count(*)::int from public.check_ins), 1, 'check-ins are intact');

-- A retired habit (removed from state.habits by the engine's retire_habit edit) is archived, not deleted.
select lives_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000',
                  (select jsonb_set(s, '{habits}', '[]') from good), '[]', '[]')$$,
                'a save without the habit succeeds');
select isnt((select archived_at from public.habits where id = 'run'), null, 'the retired habit is archived');
select is((select count(*)::int from public.check_ins where habit_id = 'run'), 1, 'its check-ins stay as history');

-- Level names: keys are levels 1..5 and values are names.
select lives_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000',
                  (select jsonb_set(s, '{levelNames}', '{"1": "Getting started"}') from good), '[]', '[]')$$,
                'level names save');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000',
                   (select jsonb_set(s, '{levelNames}', '{"7": "Beyond"}') from good), '[]', '[]')$$,
                 '23514', null, 'a level name for a level that does not exist is refused');
select throws_ok($$select public.save_step_result('dddddddd-0000-0000-0000-000000000000',
                   (select jsonb_set(s, '{levelNames}', '{"2": ""}') from good), '[]', '[]')$$,
                 '23514', null, 'an empty level name is refused');

select * from finish();
rollback;
