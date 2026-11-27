-- Saved game data. One player per auth user. Tables mirror the contract types:
--   profiles         GameState scalars (birthYear, endAge, today, timezone, level, score, credits)
--   areas            GameState.modes and GameState.weekProgress, one row per area
--   goals            Goal
--   programs         Program
--   habits           Habit
--   check_ins        CheckIn, flattened: one row per habit per day
--   habit_history    view over check_ins that gives Habit.history (see the end of this file)
--   resistance       ResistanceState, one row per resistance type
--   game_plans       GamePlan
--   rule_adjustments RuleAdjustment
--   character        CharacterState
--   recovery         RecoveryState (row present only while in Recovery)
--   seasons          Season (current season = highest index)
--   ledger           LedgerEntry (append-only)
--   game_events      GameEvent (append-only, from each StepResult)
--
-- Contract ids (goal, habit, program, game plan, rule) are client strings such as "body-101",
-- unique per user, so child tables use composite (user_id, id) keys. A composite foreign key
-- also means a row can never point at another user's goal or habit.
--
-- No rule values are hard-coded here: defaults such as endAge 84 come from DEFAULT_RULES
-- and are written by the client. Checks only guard the shape stated in the contracts.
-- "position" keeps the order of arrays in GameState so a load returns what was saved.
--
-- Soft deletes: goals and habits are never hard-deleted in normal use. Set archived_at instead;
-- a load leaves archived rows out of GameState. Check-ins stay as history for the adaptive engine,
-- so a habit (or a goal whose habits) has check-ins cannot be hard-deleted, and users are not
-- granted delete on goals or habits at all (see the RLS migration). Deleting the whole account
-- still removes everything, because every table cascades from profiles.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  birth_year  integer not null check (birth_year between 1900 and 2100),
  end_age     integer not null check (end_age > 0),
  timezone    text not null,
  today       date not null,
  level       smallint not null check (level between 1 and 5),
  score       double precision not null default 0,
  credits     double precision not null default 0,
  created_at  timestamptz not null default now()
);
comment on table public.profiles is 'GameState scalars for one player. id = auth.users.id = GameState.userId.';
comment on column public.profiles.timezone is 'GameState.timezone, IANA, e.g. America/New_York. closeWeek runs Sunday night in this zone.';

create table public.areas (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  area           public.area_id not null,
  mode           public.area_mode not null,
  week_progress  boolean not null default false,
  primary key (user_id, area)
);
comment on column public.areas.week_progress is 'GameState.weekProgress[area]: any full or minimum habit since the week started.';

create table public.goals (
  user_id               uuid not null references public.profiles (id) on delete cascade,
  id                    text not null,
  position              integer not null default 0,
  area                  public.area_id not null,
  level                 smallint not null check (level between 1 and 4),
  title                 text not null,
  kind                  public.goal_kind not null,
  status                public.goal_status not null,
  progress              double precision not null default 0 check (progress between 0 and 1),
  risk                  double precision not null default 0 check (risk between 0 and 100),
  frozen                boolean not null default false,
  locked_in_on          date,
  last_quarterly_check  date,
  archived_at           timestamptz,
  primary key (user_id, id)
);
comment on column public.goals.archived_at is 'Soft delete. Set instead of deleting; archived goals are left out of GameState.';

create table public.programs (
  user_id       uuid not null,
  id            text not null,
  position      integer not null default 0,
  goal_id       text not null,
  weeks         jsonb not null default '[]'::jsonb check (jsonb_typeof(weeks) = 'array'),
  current_week  integer not null check (current_week >= 1),
  done          boolean[] not null default '{}',
  threshold     integer not null check (threshold >= 0),
  primary key (user_id, id),
  foreign key (user_id, goal_id) references public.goals (user_id, id) on delete cascade
);
comment on column public.programs.weeks is 'ProgramWeek[]: [{ "index": 1, "sessions": ["..."] }, ...]';
create index programs_goal_idx on public.programs (user_id, goal_id);

create table public.habits (
  user_id                uuid not null,
  id                     text not null,
  position               integer not null default 0,
  goal_id                text not null,
  area                   public.area_id not null,
  title                  text not null,
  full_dose              text not null,
  minimum_dose           text not null,
  weekly_target_focus    smallint not null check (weekly_target_focus between 0 and 7),
  weekly_target_maintain smallint not null check (weekly_target_maintain between 0 and 7),
  weekly_target_rest     smallint not null check (weekly_target_rest between 0 and 7),
  maintenance            boolean not null default false,
  archived_at            timestamptz,
  primary key (user_id, id),
  foreign key (user_id, goal_id) references public.goals (user_id, id) on delete cascade
);
create index habits_goal_idx on public.habits (user_id, goal_id);
comment on column public.habits.archived_at is 'Soft delete. Set instead of deleting; check-ins are kept as history.';
comment on column public.habits.weekly_target_focus is 'Habit.weeklyTarget.focus: check-ins per week, 0..7.';

-- One row per habit per day. Kept as history for the adaptive engine: the foreign key to habits
-- has no on-delete action, so a habit with check-ins cannot be hard-deleted (archive it instead).
-- Deleting the whole account still cascades through user_id.
create table public.check_ins (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  habit_id     text not null,
  date         date not null,
  result       public.check_in_result not null,
  reason       public.resistance_id,
  recorded_at  timestamptz not null default now(),
  primary key (user_id, habit_id, date),
  foreign key (user_id, habit_id) references public.habits (user_id, id),
  constraint check_ins_missed_needs_reason check (result <> 'missed' or reason is not null)
);
create index check_ins_date_idx on public.check_ins (user_id, date);

create table public.resistance (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  id           public.resistance_id not null,
  strength     double precision not null check (strength between 1 and 5),
  reports_14d  integer not null default 0 check (reports_14d >= 0),
  target_area  public.area_id not null,
  primary key (user_id, id)
);

create table public.game_plans (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  id          text not null,
  position    integer not null default 0,
  resistance  public.resistance_id not null,
  text        text not null,
  equipped    boolean not null default false,
  primary key (user_id, id)
);

create table public.rule_adjustments (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  id         text not null,
  position   integer not null default 0,
  trigger    public.resistance_id not null,
  message    text not null,
  effect     jsonb not null,
  starts_on  date not null,
  ends_on    date not null,
  primary key (user_id, id),
  constraint rule_adjustments_dates check (ends_on >= starts_on),
  constraint rule_adjustments_effect_shape check (
    jsonb_typeof(effect) = 'object'
    and effect ->> 'kind' in ('minimum_counts_as_full', 'shorter_full_dose', 'credit_multiplier', 'no_health_loss_on_miss')
    and effect ? 'habitId'
  )
);
comment on column public.rule_adjustments.effect is 'RuleEffect, e.g. { "kind": "credit_multiplier", "habitId": "run", "multiplier": 1.5 }';

create table public.character (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  health           double precision not null check (health between 0 and 100),
  strength         double precision not null check (strength between 0 and 100),
  grace_days_left  integer not null check (grace_days_left >= 0)
);

create table public.recovery (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  cause        public.recovery_cause not null,
  started_on   date not null,
  day          smallint not null check (day between 1 and 7),
  days_done    smallint not null check (days_done >= 0),
  habit_title  text not null
);
comment on table public.recovery is 'GameState.recovery. No row = null (not in Recovery).';

-- True when no element appears twice. Used by checks, which cannot hold subqueries.
-- Lives in "private", which the Data API does not expose.
create schema if not exists private;
create function private.array_is_distinct(arr anyarray)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select count(*) = count(distinct e) from unnest(arr) as e;
$$;

create table public.seasons (
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  index                   integer not null check (index >= 1),
  starts_on               date not null,
  focus                   public.area_id[] not null default '{}'
                          check (cardinality(focus) <= 2 and private.array_is_distinct(focus)),
  auto_recovery_used      boolean not null default false,
  life_event_pause_used   boolean not null default false,
  primary key (user_id, index)
);
comment on table public.seasons is 'GameState.season is the row with the highest index.';

create table public.ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  kind        public.ledger_kind not null,
  score       double precision not null default 0,
  credits     double precision not null default 0,
  source_id   text,
  created_at  timestamptz not null default now()
);
create index ledger_user_date_idx on public.ledger (user_id, date);

create table public.game_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  event       jsonb not null check (jsonb_typeof(event) = 'object' and event ? 'type'),
  created_at  timestamptz not null default now()
);
comment on table public.game_events is 'GameEvent from each saved StepResult. date = GameState.today at save time.';
create index game_events_user_date_idx on public.game_events (user_id, date);

-- Habit.history: the habit's check-ins, newest first ranked 1, 2, 3...
-- The engine keeps the last DEFAULT_RULES.history.days entries, so the client filters
-- recent_rank <= that number (read from the rules config, never hard-coded here) and
-- reverses to oldest first. security_invoker makes the view obey check_ins RLS.
create view public.habit_history
with (security_invoker = true)
as
select
  c.user_id,
  c.habit_id,
  c.date,
  c.result,
  c.reason,
  row_number() over (partition by c.user_id, c.habit_id order by c.date desc) as recent_rank
from public.check_ins c;
comment on view public.habit_history is 'Habit.history derived from check_ins. Filter recent_rank <= rules.history.days.';
