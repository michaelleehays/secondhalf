-- GameState.vision (contracts #44): the player's Vision (501) in their own words. Null = absent.
-- save_step_result is replaced to write it (same signature as ..._000800; supersedes ..._000900).

alter table public.profiles add column vision text;
comment on column public.profiles.vision is 'GameState.vision: the player''s Vision (501) in their own words. Null = absent.';

create or replace function public.save_step_result(
  p_user_id uuid, p_state jsonb, p_ledger jsonb, p_events jsonb, p_expected_version bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s jsonb := p_state;
  k text;
  v_current bigint;
  v_new bigint;
begin
  if p_user_id is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'You can only save your own game.' using errcode = '42501';
  end if;
  if s ->> 'userId' is distinct from p_user_id::text then
    raise exception 'state.userId does not match the user being saved.' using errcode = '22023';
  end if;

  -- Shape guard. A missing or null collection would otherwise read as "empty" and archive every goal
  -- and habit, and delete every program, game plan and rule. Refuse the whole save instead.
  if jsonb_typeof(s) is distinct from 'object' then
    raise exception 'state must be a JSON object.' using errcode = '22023';
  end if;
  for k in select unnest(array['goals', 'programs', 'habits', 'gamePlans', 'rules']) loop
    if jsonb_typeof(s -> k) is distinct from 'array' then
      raise exception 'state.% must be an array.', k using errcode = '22023';
    end if;
  end loop;
  for k in select unnest(array['modes', 'resistance', 'character', 'season']) loop
    if jsonb_typeof(s -> k) is distinct from 'object' then
      raise exception 'state.% must be an object.', k using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(coalesce(p_ledger, '[]')) <> 'array' or jsonb_typeof(coalesce(p_events, '[]')) <> 'array' then
    raise exception 'ledger and events must be arrays.' using errcode = '22023';
  end if;

  -- Optimistic concurrency. Lock the profile row so concurrent saves for one player queue up,
  -- then refuse if the caller loaded an older version than the one stored.
  select version into v_current from public.profiles where id = p_user_id for update;
  if p_expected_version is not null and p_expected_version is distinct from coalesce(v_current, 0) then
    raise exception 'The game changed since it was loaded (version % expected, % stored). Load and try again.',
      p_expected_version, coalesce(v_current, 0) using errcode = '40001';
  end if;

  -- Profile. Every save bumps the version.
  insert into public.profiles as t (id, birth_year, end_age, today, timezone, level, best_level, last_review_on,
                                    level_names, vision, score, credits, version)
  values (p_user_id, (s->>'birthYear')::int, (s->>'endAge')::int, (s->>'today')::date, s->>'timezone',
          (s->>'level')::smallint, (s->>'bestLevel')::smallint, (s->>'lastReviewOn')::date,
          nullif(s->'levelNames', 'null'::jsonb), s->>'vision',
          (s->>'score')::double precision, (s->>'credits')::double precision, 1)
  on conflict (id) do update set
    birth_year = excluded.birth_year, end_age = excluded.end_age, today = excluded.today,
    timezone = excluded.timezone, level = excluded.level, best_level = excluded.best_level,
    last_review_on = excluded.last_review_on, level_names = excluded.level_names, vision = excluded.vision,
    score = excluded.score, credits = excluded.credits,
    version = t.version + 1
  returning version into v_new;

  -- Areas: modes and weekProgress.
  insert into public.areas as t (user_id, area, mode, week_progress)
  select p_user_id, m.key::public.area_id, m.value::public.area_mode,
         coalesce((s->'weekProgress'->>m.key)::boolean, false)
  from jsonb_each_text(s->'modes') m
  on conflict (user_id, area) do update set mode = excluded.mode, week_progress = excluded.week_progress;

  -- Goals: upsert what is in the state, archive what is not.
  insert into public.goals as t (user_id, id, position, area, level, title, kind, status, progress, risk, frozen,
                                 locked_in_on, last_quarterly_check, verification, verified_on, archived_at)
  select p_user_id, g->>'id', (o - 1)::int, (g->>'area')::public.area_id, (g->>'level')::smallint, g->>'title',
         (g->>'kind')::public.goal_kind, (g->>'status')::public.goal_status, (g->>'progress')::double precision,
         (g->>'risk')::double precision, (g->>'frozen')::boolean, (g->>'lockedInOn')::date,
         (g->>'lastQuarterlyCheck')::date, g->>'verification', (g->>'verifiedOn')::date, null
  from jsonb_array_elements(s->'goals') with ordinality as x(g, o)
  on conflict (user_id, id) do update set
    position = excluded.position, area = excluded.area, level = excluded.level, title = excluded.title,
    kind = excluded.kind, status = excluded.status, progress = excluded.progress, risk = excluded.risk,
    frozen = excluded.frozen, locked_in_on = excluded.locked_in_on,
    last_quarterly_check = excluded.last_quarterly_check, verification = excluded.verification,
    verified_on = excluded.verified_on, archived_at = null;
  update public.goals set archived_at = now()
  where user_id = p_user_id and archived_at is null
    and id not in (select g->>'id' from jsonb_array_elements(s->'goals') g);

  -- Programs: replace.
  delete from public.programs
  where user_id = p_user_id and id not in (select pr->>'id' from jsonb_array_elements(s->'programs') pr);
  insert into public.programs as t (user_id, id, position, goal_id, weeks, current_week, done, threshold)
  select p_user_id, pr->>'id', (o - 1)::int, pr->>'goalId', pr->'weeks', (pr->>'currentWeek')::int,
         array(select jsonb_array_elements_text(pr->'done')::boolean), (pr->>'threshold')::int
  from jsonb_array_elements(s->'programs') with ordinality as x(pr, o)
  on conflict (user_id, id) do update set
    position = excluded.position, goal_id = excluded.goal_id, weeks = excluded.weeks,
    current_week = excluded.current_week, done = excluded.done, threshold = excluded.threshold;

  -- Habits: upsert, archive what is not in the state (a retired habit is archived here, never deleted).
  insert into public.habits as t (user_id, id, position, goal_id, area, title, full_dose, minimum_dose,
                                  weekly_target_focus, weekly_target_maintain, weekly_target_rest, maintenance, archived_at)
  select p_user_id, h->>'id', (o - 1)::int, h->>'goalId', (h->>'area')::public.area_id, h->>'title',
         h->>'fullDose', h->>'minimumDose', (h->'weeklyTarget'->>'focus')::smallint,
         (h->'weeklyTarget'->>'maintain')::smallint, (h->'weeklyTarget'->>'rest')::smallint,
         (h->>'maintenance')::boolean, null
  from jsonb_array_elements(s->'habits') with ordinality as x(h, o)
  on conflict (user_id, id) do update set
    position = excluded.position, goal_id = excluded.goal_id, area = excluded.area, title = excluded.title,
    full_dose = excluded.full_dose, minimum_dose = excluded.minimum_dose,
    weekly_target_focus = excluded.weekly_target_focus, weekly_target_maintain = excluded.weekly_target_maintain,
    weekly_target_rest = excluded.weekly_target_rest, maintenance = excluded.maintenance, archived_at = null;
  update public.habits set archived_at = now()
  where user_id = p_user_id and archived_at is null
    and id not in (select h->>'id' from jsonb_array_elements(s->'habits') h);

  -- Check-ins come from Habit.history. Entries trimmed out of history stay in the table.
  insert into public.check_ins as t (user_id, habit_id, date, result, reason, graced)
  select p_user_id, h->>'id', (d->>'date')::date, (d->>'result')::public.check_in_result,
         (d->>'reason')::public.resistance_id, coalesce((d->>'graced')::boolean, false)
  from jsonb_array_elements(s->'habits') h, jsonb_array_elements(h->'history') d
  on conflict (user_id, habit_id, date) do update
    set result = excluded.result, reason = excluded.reason, graced = excluded.graced
  where (t.result, t.reason, t.graced) is distinct from (excluded.result, excluded.reason, excluded.graced);

  -- Resistance.
  insert into public.resistance as t (user_id, id, strength, reports_14d, target_area)
  select p_user_id, r.key::public.resistance_id, (r.value->>'strength')::double precision,
         (r.value->>'reports14d')::int, (r.value->>'targetArea')::public.area_id
  from jsonb_each(s->'resistance') r
  on conflict (user_id, id) do update set
    strength = excluded.strength, reports_14d = excluded.reports_14d, target_area = excluded.target_area;

  -- Game plans and rule adjustments: replace.
  delete from public.game_plans
  where user_id = p_user_id and id not in (select gp->>'id' from jsonb_array_elements(s->'gamePlans') gp);
  insert into public.game_plans as t (user_id, id, position, resistance, text, equipped)
  select p_user_id, gp->>'id', (o - 1)::int, (gp->>'resistance')::public.resistance_id, gp->>'text',
         (gp->>'equipped')::boolean
  from jsonb_array_elements(s->'gamePlans') with ordinality as x(gp, o)
  on conflict (user_id, id) do update set
    position = excluded.position, resistance = excluded.resistance, text = excluded.text, equipped = excluded.equipped;

  delete from public.rule_adjustments
  where user_id = p_user_id and id not in (select ra->>'id' from jsonb_array_elements(s->'rules') ra);
  insert into public.rule_adjustments as t (user_id, id, position, trigger, message, effect, starts_on, ends_on)
  select p_user_id, ra->>'id', (o - 1)::int, (ra->>'trigger')::public.resistance_id, ra->>'message',
         ra->'effect', (ra->>'startsOn')::date, (ra->>'endsOn')::date
  from jsonb_array_elements(s->'rules') with ordinality as x(ra, o)
  on conflict (user_id, id) do update set
    position = excluded.position, trigger = excluded.trigger, message = excluded.message,
    effect = excluded.effect, starts_on = excluded.starts_on, ends_on = excluded.ends_on;

  -- Character and Recovery.
  insert into public.character as t (user_id, health, strength, grace_days_left, knocked_down_since, knocked_down_plays)
  values (p_user_id, (s->'character'->>'health')::double precision, (s->'character'->>'strength')::double precision,
          (s->'character'->>'graceDaysLeft')::int,
          (s->'character'->'knockedDown'->>'since')::date, (s->'character'->'knockedDown'->>'plays')::int)
  on conflict (user_id) do update set
    health = excluded.health, strength = excluded.strength, grace_days_left = excluded.grace_days_left,
    knocked_down_since = excluded.knocked_down_since, knocked_down_plays = excluded.knocked_down_plays;

  if jsonb_typeof(s->'recovery') is distinct from 'object' then
    delete from public.recovery where user_id = p_user_id;
  else
    insert into public.recovery as t (user_id, cause, started_on, day, days_done, habit_title)
    values (p_user_id, (s->'recovery'->>'cause')::public.recovery_cause, (s->'recovery'->>'startedOn')::date,
            (s->'recovery'->>'day')::smallint, (s->'recovery'->>'daysDone')::smallint, s->'recovery'->>'habitTitle')
    on conflict (user_id) do update set
      cause = excluded.cause, started_on = excluded.started_on, day = excluded.day,
      days_done = excluded.days_done, habit_title = excluded.habit_title;
  end if;

  -- Season.
  insert into public.seasons as t (user_id, index, starts_on, focus, auto_recovery_used, life_event_pause_used)
  values (p_user_id, (s->'season'->>'index')::int, (s->'season'->>'startsOn')::date,
          array(select jsonb_array_elements_text(s->'season'->'focus')::public.area_id),
          (s->'season'->>'autoRecoveryUsed')::boolean, (s->'season'->>'lifeEventPauseUsed')::boolean)
  on conflict (user_id, index) do update set
    starts_on = excluded.starts_on, focus = excluded.focus,
    auto_recovery_used = excluded.auto_recovery_used, life_event_pause_used = excluded.life_event_pause_used;

  -- Ledger and events: append.
  insert into public.ledger (user_id, date, kind, score, credits, source_id)
  select p_user_id, (l->>'date')::date, (l->>'kind')::public.ledger_kind, (l->>'score')::double precision,
         (l->>'credits')::double precision, l->>'sourceId'
  from jsonb_array_elements(coalesce(p_ledger, '[]')) l;

  insert into public.game_events (user_id, date, event)
  select p_user_id, (s->>'today')::date, e
  from jsonb_array_elements(coalesce(p_events, '[]')) e;

  return v_new;
end;
$$;
