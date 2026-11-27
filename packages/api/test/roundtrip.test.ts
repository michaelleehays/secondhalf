/// <reference types="node" />
/**
 * Round-trip against local Supabase. Skipped unless SUPABASE_INTEGRATION is set.
 *   supabase start && supabase db reset
 *   npm run test:integration -w @second-half/api
 * Defaults are the local stack's well-known development keys; override with SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Never point this at a live project.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { GameState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay } from "@second-half/engine";
import { createGameApi, SEED_USER, STALE_SAVE } from "../src/index";

const env = process.env;
const URL_ = env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);

async function signedIn(email: string, password: string): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(URL_, ANON, opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error("no user");
  return { client, id: data.user.id };
}

async function newPlayer() {
  const email = `player-${randomUUID()}@second-half.local`;
  const password = randomUUID();
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return signedIn(email, password);
}

const forUser = (id: string): GameState => ({ ...SAMPLE_STATE, userId: id });

describe.skipIf(!env.SUPABASE_INTEGRATION)("game data round-trip (local Supabase)", () => {
  let a: { client: SupabaseClient; id: string };
  let b: { client: SupabaseClient; id: string };

  beforeAll(async () => {
    a = await newPlayer();
    b = await newPlayer();
    await createGameApi(a.client).saveStepResult(a.id, { state: forUser(a.id), events: [] });
  });

  it("the seeded test player loads exactly SAMPLE_STATE", async () => {
    const seeded = await signedIn(SEED_USER.email, SEED_USER.password);
    expect(await createGameApi(seeded.client).loadGameState(seeded.id)).toEqual(forUser(SEED_USER.id));
  });

  it("a saved SAMPLE_STATE loads back unchanged", async () => {
    expect(await createGameApi(a.client).loadGameState(a.id)).toEqual(forUser(a.id));
  });

  it("an engine step saves state, ledger and events, and loads back unchanged", async () => {
    const api = createGameApi(a.client);
    const before = (await api.loadGameState(a.id))!;
    const step = closeDay(before, {
      date: "2026-11-27",
      entries: [
        { habitId: "run", result: "full" },
        { habitId: "meditate", result: "minimum" },
        { habitId: "deep-work", result: "missed", reason: "no_time" },
      ],
    });
    await api.saveStepResult(a.id, step);

    expect(await api.loadGameState(a.id)).toEqual(step.state);

    const points = step.events.filter((e) => e.type === "points");
    expect(points.length).toBeGreaterThan(0);
    const { data: ledger } = await a.client.from("ledger").select("kind, score, credits, date").eq("date", "2026-11-27");
    expect(ledger).toHaveLength(points.length);
    const { data: events } = await a.client.from("game_events").select("event").eq("date", "2026-11-27").order("id");
    expect(events!.map((r) => r.event)).toEqual(step.events);
  });

  it("history keeps only the last rules.history.days calendar days", async () => {
    const api = createGameApi(a.client);
    const s = (await api.loadGameState(a.id))!;
    const old = { date: "2026-11-01", result: "full" as const };
    await api.saveStepResult(a.id, {
      state: { ...s, habits: s.habits.map((h) => (h.id === "run" ? { ...h, history: [old, ...h.history] } : h)) },
      events: [],
    });
    const run = (await api.loadGameState(a.id))!.habits.find((h) => h.id === "run")!;
    expect(run.history.map((d) => d.date)).not.toContain("2026-11-01");
    // The check-in itself is kept as history.
    const { data } = await a.client.from("check_ins").select("date").eq("habit_id", "run").eq("date", "2026-11-01");
    expect(data).toHaveLength(1);
  });

  it("a habit removed from the state is archived: left out of the load, check-ins kept", async () => {
    const api = createGameApi(a.client);
    const s = (await api.loadGameState(a.id))!;
    await api.saveStepResult(a.id, { state: { ...s, habits: s.habits.filter((h) => h.id !== "run") }, events: [] });
    const loaded = (await api.loadGameState(a.id))!;
    expect(loaded.habits.map((h) => h.id)).not.toContain("run");
    const { data: habit } = await a.client.from("habits").select("archived_at").eq("id", "run").single();
    expect(habit!.archived_at).not.toBeNull();
    const { count } = await a.client.from("check_ins").select("*", { count: "exact", head: true }).eq("habit_id", "run");
    expect(count).toBeGreaterThan(0);

    // Putting it back un-archives it.
    await api.saveStepResult(a.id, { state: s, events: [] });
    expect((await api.loadGameState(a.id))!.habits.map((h) => h.id)).toContain("run");
  });

  it("a failed save changes nothing", async () => {
    const api = createGameApi(a.client);
    const before = (await api.loadGameState(a.id))!;
    const { count: ledgerBefore } = await a.client.from("ledger").select("*", { count: "exact", head: true });
    const bad = {
      ...before,
      score: before.score + 1000,
      resistance: { ...before.resistance, fatigue: { ...before.resistance.fatigue, strength: 9 } },
    };
    await expect(
      api.saveStepResult(a.id, { state: bad, events: [{ type: "points", score: 1000, credits: 0, reason: "habit" }] }),
    ).rejects.toThrow(/Could not save/);
    expect(await api.loadGameState(a.id)).toEqual(before);
    const { count: ledgerAfter } = await a.client.from("ledger").select("*", { count: "exact", head: true });
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it("bestLevel, lastReviewOn, levelNames, vision, goal verification and knockedDown survive a save, and clearing them clears them", async () => {
    const api = createGameApi(a.client);
    const s = (await api.loadGameState(a.id))!;
    const knocked: GameState = {
      ...s,
      bestLevel: 3,
      lastReviewOn: "2026-11-22",
      levelNames: { 1: "Getting started", 2: "Building up" },
      vision: "Strong at 84. Free with my time. Surrounded by people I love.",
      goals: s.goals.map((g) => (g.id === "body-201" ? { ...g, verification: "Run a timed 10K", verifiedOn: "2026-11-27" } : g)),
      character: { ...s.character, health: 0, knockedDown: { since: "2026-11-27", plays: 1 } },
    };
    await api.saveStepResult(a.id, { state: knocked, events: [] });
    expect(await api.loadGameState(a.id)).toEqual(knocked);

    const { bestLevel: _best, lastReviewOn: _review, levelNames: _names, vision: _vision, ...rest } = knocked;
    const up: GameState = { ...rest, goals: s.goals, character: { health: 30, strength: s.character.strength, graceDaysLeft: s.character.graceDaysLeft } };
    await api.saveStepResult(a.id, { state: up, events: [] });
    expect(await api.loadGameState(a.id)).toEqual(up);
    await api.saveStepResult(a.id, { state: s, events: [] });
  });

  it("a save built from an older load is refused when it passes its version", async () => {
    const api = createGameApi(a.client);
    const first = (await api.loadVersioned(a.id))!;
    const v2 = await api.saveStepResult(a.id, { state: { ...first.state, score: first.state.score + 6 }, events: [] }, { expectedVersion: first.version });
    expect(v2).toBe(first.version + 1);
    await expect(
      api.saveStepResult(a.id, { state: { ...first.state, score: first.state.score + 15 }, events: [] }, { expectedVersion: first.version }),
    ).rejects.toMatchObject({ code: STALE_SAVE });
    expect((await api.loadGameState(a.id))!.score).toBe(first.state.score + 6);
    await api.saveStepResult(a.id, { state: first.state, events: [] });
  });

  it("a save missing a collection is refused and archives nothing", async () => {
    const api = createGameApi(a.client);
    const before = (await api.loadGameState(a.id))!;
    const { goals: _dropped, ...noGoals } = before;
    await expect(api.saveStepResult(a.id, { state: noGoals as GameState, events: [] })).rejects.toMatchObject({ code: "22023" });
    expect(await api.loadGameState(a.id)).toEqual(before);
  });

  it("ledger rows keep the points event's sourceId", async () => {
    const api = createGameApi(a.client);
    const s = (await api.loadGameState(a.id))!;
    await api.saveStepResult(a.id, {
      state: { ...s, today: "2026-11-28" },
      events: [{ type: "points", score: 19, credits: 10, reason: "habit", sourceId: "meditate" }],
    });
    const { data } = await a.client.from("ledger").select("source_id").eq("date", "2026-11-28");
    expect(data).toEqual([{ source_id: "meditate" }]);
  });

  it("another player can neither load nor save someone else's game", async () => {
    const apiB = createGameApi(b.client);
    expect(await apiB.loadGameState(a.id)).toBeNull();
    await expect(apiB.saveStepResult(a.id, { state: forUser(a.id), events: [] })).rejects.toMatchObject({ code: "42501" });
    expect(await apiB.loadGameState(b.id)).toBeNull();
  });

  it("the service role can load any player (for server jobs)", async () => {
    expect((await createGameApi(admin).loadGameState(a.id))!.userId).toBe(a.id);
  });
});
