# Workstream B: Backend

**Goal:** accounts and saved game data on Supabase, ready for the web app.

**You own:** `supabase/**` (migrations, seed, edge functions) and `packages/api` if you need a typed client.

**Read first:** the design doc's SaaS plan (core data model table) and `packages/contracts/src/index.ts`. Tables mirror the contract types.

**Deliver:**
1. Migrations for users/profile, goals, programs, habits, check-ins (one row per habit per day), resistance, game plans, rule adjustments, character, ledger, seasons, crews (empty for now).
2. Row-level security: a user reads and writes only their own rows.
3. Seed script that loads `SAMPLE_STATE` for a test user.
4. A typed client: load `GameState` for a user, save a `StepResult` atomically (state + ledger + events).
5. Scheduled job design for `closeWeek` every Sunday night per user time zone (calls the engine; can stub until A lands).

**Do not** create or change live Supabase projects without the founder's go-ahead. Work against local Supabase (CLI) first.

**Done when:** migrations apply cleanly on a fresh local database, RLS is tested, and the client round-trips `SAMPLE_STATE`.
