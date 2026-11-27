-- HabitDay.graced (contracts #12): true when a grace day covered the miss. Graced misses do not
-- count toward the at-risk pattern, so the flag must survive a save and load.
-- load_game_state already returns every column; save_step_result writes it (final version in ..._000800).

alter table public.check_ins add column graced boolean not null default false;
comment on column public.check_ins.graced is 'HabitDay.graced: a grace day covered this miss.';
alter table public.check_ins add constraint check_ins_graced_only_on_miss check (not graced or result = 'missed');
