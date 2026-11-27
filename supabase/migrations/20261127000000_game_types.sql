-- Enum types mirroring the string unions in packages/contracts/src/index.ts.
-- If a contract union changes, add a migration here (alter type ... add value).

create type public.area_id as enum ('body', 'mind', 'work', 'people', 'money');
create type public.area_mode as enum ('focus', 'maintain', 'rest');
create type public.resistance_id as enum ('fatigue', 'no_time', 'temptation', 'stress', 'avoidance');
create type public.goal_kind as enum ('milestone', 'system');
create type public.goal_status as enum ('hidden', 'open', 'in_progress', 'locked_in', 'at_risk', 'lost');
create type public.check_in_result as enum ('full', 'minimum', 'missed');
create type public.recovery_cause as enum ('auto', 'life_event');
create type public.ledger_kind as enum (
  'habit', 'program_week', 'goal_locked_in', 'level_cleared', 'weekly_review', 'dividend', 'reward_redeemed'
);
create type public.crew_role as enum ('owner', 'member');
