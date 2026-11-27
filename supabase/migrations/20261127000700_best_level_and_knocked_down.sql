-- GameState.bestLevel (contracts #19) and CharacterState.knockedDown (contracts #22).
-- Both are optional in the contract, so the columns are nullable and null means "absent":
--   best_level null       -> bestLevel missing, which the engine reads as the same as level
--   knocked_down_* null   -> not knocked down
-- load_game_state returns every column already; save_step_result writes them (final version in ..._000800).

alter table public.profiles add column best_level smallint check (best_level between 1 and 5);
comment on column public.profiles.best_level is 'GameState.bestLevel: highest level ever reached. Null = same as level.';

alter table public.character
  add column knocked_down_since date,
  add column knocked_down_plays integer check (knocked_down_plays >= 0),
  add constraint character_knocked_down_together
    check ((knocked_down_since is null) = (knocked_down_plays is null));
comment on column public.character.knocked_down_since is 'CharacterState.knockedDown.since. Null with plays = not knocked down.';
