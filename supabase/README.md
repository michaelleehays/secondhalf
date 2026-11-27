# Supabase (workstream B)

Schema, auth and jobs. See `docs/workstreams/B-backend.md`.

## Layout

| Path | What |
| --- | --- |
| `migrations/` | Schema. Tables mirror `packages/contracts` (see the header of `20261127000100_game_tables.sql` for the type-to-table map). |
| `tests/` | pgTAP tests, including row-level security. |
| `seed.sql` | Generated from `SAMPLE_STATE`: a local test player `sample@second-half.local` / `sample-password`. Regenerate with `npm run seed:generate -w @second-half/api`; a unit test fails if it is stale. |
| `config.jsonc` | Local stack config from `supabase init`. Not linked to any live project. |

## Run locally

Needs Docker and the Supabase CLI.

```bash
supabase start      # local stack
supabase db reset   # apply every migration to a fresh database
supabase test db    # run pgTAP tests (RLS)
supabase db lint
npm run test:integration -w @second-half/api   # client round-trip against the local stack
```

## Loading and saving

`packages/api` wraps two Postgres functions (both security invoker, so RLS applies):

- `load_game_state(user_id, history_days)`: the whole game in one read. Archived goals and habits are left out, and `Habit.history` holds the check-ins dated after `today - rules.history.days`.
- `save_step_result(user_id, state, ledger, events)`: state, ledger rows and game events in one transaction. Goals and habits missing from the state are archived. Check-ins are upserted from `Habit.history` and never deleted.

```ts
const api = createGameApi(supabase); // signed in as the player, or service role for jobs
const state = await api.loadGameState(userId);
await api.saveStepResult(userId, engine.closeDay(state, checkIn));
```

If image pulls from `public.ecr.aws` are blocked on your network, pull from Docker Hub instead:
`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io supabase start`.

## Security model

- Every table in `public` has RLS on. A signed-in user reads and writes only rows where `user_id` (or `profiles.id`) is their own `auth.uid()`.
- `anon` has no access to any game table.
- `ledger` and `game_events` are append-only for users (select and insert only).
- Child rows use composite `(user_id, id)` foreign keys, so a habit or program can only point at the player's own goal.
- Goals and habits are soft-deleted (`archived_at`); users have no delete on them, and check-ins are kept as history. Deleting the account still removes everything.
- `Habit.history` comes from the `habit_history` view (security invoker, so check-in RLS applies). Filter `recent_rank <= rules.history.days`.
- Crews are shared by design: members can see their crew and its member list. Ownership is `crews.created_by`. A user can only insert a membership row for themselves, and until invites exist only into a crew they created. Members can leave; the creator can remove people.
- `service_role` bypasses RLS and is for server jobs only (e.g. the weekly `closeWeek` run).
