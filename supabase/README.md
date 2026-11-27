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
supabase test db    # run pgTAP tests (RLS, saves, weekly rollover)
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

## Weekly rollover (closeWeek)

Every Sunday at 23:00 in each player's own time zone (`profiles.timezone`), the week is closed.

```
pg_cron, hourly at :07  ->  private.invoke_close_week()  ->  pg_net POST /functions/v1/close-week
  Edge Function close-week (X-Close-Week-Secret) -> runWeeklyRollover (packages/api)
    due_week_rollovers(now)   players whose latest local Sunday 23:00 has passed with no rollover row
    load_game_state           per player, with its version
    closeWeek                 engine, through the engineCloseWeek adapter
    save_week_rollover        StepResult + week_rollovers row in one transaction, at the loaded version
```

- **Why a function plus cron, not SQL alone:** closeWeek is engine TypeScript, so it runs in TypeScript. Postgres decides who is due and makes each save atomic.
- **Once per week:** `week_rollovers` is keyed by `(user_id, week_start)`. Closing a week that is already closed fails its insert and rolls back the whole save.
- **Never overwrites a check-in:** every save bumps `profiles.version`. The job saves at the version it loaded, so a check-in that lands between its load and its save makes the rollover fail with `40001`. Nothing is written, and the next hourly run retries from the fresh state. `save_step_result` takes the same optional expected version.
- **Never moves a date backwards:** a week is due only if its Sunday is on or after `profiles.today` and on or after the day the player signed up (local time), and `save_week_rollover` refuses a week ending before `today`. New sign-ups and players who have already played past the close are not charged for a week they did not play.
- **Only the latest week:** a player who missed several weeks gets one rollover, not a backfill.
- **closeWeek** is the real engine function (engine #21), called through `engineCloseWeek`. If it throws for a player, that player counts as `failed`, nothing is written, and the next hour retries.

### The function and its secret
- `verify_jwt` is **off** for `close-week` (`supabase/config.jsonc`), because the caller is the scheduler, not a player. Instead the request must carry `X-Close-Week-Secret` equal to the `CLOSE_WEEK_SECRET` function secret. The function compares the two in constant time (SHA-256 of both, then `timingSafeEqual`). It is a dedicated secret, so the service-role key never leaves the project.
- It returns **counts only** (`due`, `closed`, `skipped`, `retry`, `failed`), because pg_net stores responses in `net._http_response`. Failure messages go to the function log, without player ids.

### Turning it on in a project
Generate one random secret and store it in two places:
```bash
supabase secrets set CLOSE_WEEK_SECRET=<random secret>
```
```sql
select vault.create_secret('https://<project>.supabase.co/functions/v1/close-week', 'close_week_url');
select vault.create_secret('<the same random secret>', 'close_week_secret');
```
Until both Vault secrets exist, the hourly job runs and does nothing.

### Local
```bash
supabase functions serve --env-file <file with CLOSE_WEEK_SECRET=...>
curl -X POST http://127.0.0.1:54321/functions/v1/close-week -H "X-Close-Week-Secret: <secret>"
deno check --config supabase/functions/close-week/deno.json supabase/functions/close-week/index.ts
```
