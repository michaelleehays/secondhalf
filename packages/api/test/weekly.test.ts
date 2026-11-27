/// <reference types="node" />
/**
 * Weekly rollover against local Supabase, with a stub closeWeek. Skipped unless SUPABASE_INTEGRATION is set.
 * Run with: npm run test:integration -w @second-half/api
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { GameState, StepResult } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createGameApi, engineCloseWeek, runWeeklyRollover, type CloseWeek } from "../src/index";

const env = process.env;
const URL_ = env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE =
  env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Stub until workstream A ships closeWeek: state unchanged plus one dividend event. */
const calls: { userId: string; weekEnding: string }[] = [];
const stubCloseWeek: CloseWeek = (state, weekEnding): StepResult => {
  calls.push({ userId: state.userId, weekEnding });
  return { state, events: [{ type: "points", score: 45, credits: 0, reason: "dividend", sourceId: `week-${weekEnding}` }] };
};

// A year from the sample date so earlier test data never collides. 2027-11-28 is a Sunday.
const SUNDAY = "2027-11-28";
const at = (iso: string) => new Date(iso);

async function player(timezone: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `weekly-${randomUUID()}@second-half.local`, password: randomUUID(), email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  const state: GameState = { ...SAMPLE_STATE, userId: data.user.id, timezone };
  await createGameApi(admin).saveStepResult(data.user.id, { state, events: [] });
  return data.user.id;
}

describe.skipIf(!env.SUPABASE_INTEGRATION)("weekly rollover (local Supabase, stub closeWeek)", () => {
  let ny: string;
  let tokyo: string;

  beforeAll(async () => {
    ny = await player("America/New_York");
    tokyo = await player("Asia/Tokyo");
    // Close everything that is due before our test week, so the runs below only see that week.
    await runWeeklyRollover(admin, stubCloseWeek, at("2027-11-22T12:00:00Z"));
    calls.length = 0;
  });

  it("closes a week only after Sunday 23:00 in the player's own time zone", async () => {
    // 2027-11-28 22:30 in New York = 2027-11-29 03:30 UTC = Monday 12:30 in Tokyo.
    const r = await runWeeklyRollover(admin, stubCloseWeek, at("2027-11-29T03:30:00Z"));
    const closed = r.closed.map((c) => c.userId);
    expect(closed).toContain(tokyo);
    expect(closed).not.toContain(ny);
    expect(calls.find((c) => c.userId === tokyo)?.weekEnding).toBe(SUNDAY);

    // 23:05 in New York.
    const r2 = await runWeeklyRollover(admin, stubCloseWeek, at("2027-11-29T04:05:00Z"));
    expect(r2.closed.map((c) => c.userId)).toContain(ny);
    expect(r2.closed.map((c) => c.userId)).not.toContain(tokyo);
  });

  it("saves the closeWeek result: the event and its ledger row, once", async () => {
    const { data: ledger } = await admin.from("ledger").select("kind, score, source_id").eq("user_id", ny).eq("source_id", `week-${SUNDAY}`);
    expect(ledger).toEqual([{ kind: "dividend", score: 45, source_id: `week-${SUNDAY}` }]);
    const { data: rows } = await admin.from("week_rollovers").select("week_start, week_ending, event_count").eq("user_id", ny).eq("week_ending", SUNDAY);
    expect(rows).toEqual([{ week_start: "2027-11-22", week_ending: SUNDAY, event_count: 1 }]);
  });

  it("is idempotent: rerunning, or running twice at once, closes nothing again", async () => {
    calls.length = 0;
    const later = at("2027-11-29T10:00:00Z");
    const [a, b] = await Promise.all([
      runWeeklyRollover(admin, stubCloseWeek, later),
      runWeeklyRollover(admin, stubCloseWeek, later),
    ]);
    for (const r of [a, b]) {
      expect(r.closed.map((c) => c.userId)).not.toContain(ny);
      expect(r.closed.map((c) => c.userId)).not.toContain(tokyo);
    }
    const { count } = await admin.from("ledger").select("*", { count: "exact", head: true }).eq("user_id", ny).eq("source_id", `week-${SUNDAY}`);
    expect(count).toBe(1);
  });

  it("two runs racing on the same open week close it exactly once", async () => {
    const racer = await player("Europe/London");
    const after = at("2027-12-05T23:30:00Z"); // Sunday 5 Dec 23:30 in London
    // Close the racer's earlier weeks first so only 5 Dec is open.
    await runWeeklyRollover(admin, stubCloseWeek, at("2027-11-29T10:00:00Z"));
    const [a, b] = await Promise.all([
      runWeeklyRollover(admin, stubCloseWeek, after),
      runWeeklyRollover(admin, stubCloseWeek, after),
    ]);
    const closedBy = [a, b].filter((r) => r.closed.some((c) => c.userId === racer)).length;
    expect(closedBy).toBe(1);
    const { count } = await admin.from("ledger").select("*", { count: "exact", head: true }).eq("user_id", racer).eq("source_id", "week-2027-12-05");
    expect(count).toBe(1);
  });

  it("a check-in saved while the job runs is kept: the rollover is refused and retried next run", async () => {
    const busy = await player("America/Chicago");
    await runWeeklyRollover(admin, stubCloseWeek, at("2027-11-29T10:00:00Z")); // close the earlier weeks
    const api = createGameApi(admin);
    const checkInDuringClose: CloseWeek = async (state, weekEnding) => {
      if (state.userId === busy) {
        // The player checks in tonight while the job is between its load and its save.
        const now = (await api.loadGameState(busy))!;
        const checkedIn: GameState = {
          ...now,
          today: "2027-12-05", // closeDay sets today to the check-in date
          score: now.score + 15,
          habits: now.habits.map((h) => (h.id === "run" ? { ...h, history: [...h.history, { date: "2027-12-05", result: "full" }] } : h)),
        };
        await api.saveStepResult(busy, { state: checkedIn, events: [] });
      }
      return stubCloseWeek(state, weekEnding);
    };
    // Sunday 5 Dec 23:30 in Chicago = Monday 05:30 UTC.
    const r = await runWeeklyRollover(admin, checkInDuringClose, at("2027-12-06T05:30:00Z"));
    expect(r.retry.map((x) => x.userId)).toContain(busy);
    expect(r.closed.map((c) => c.userId)).not.toContain(busy);

    const kept = (await api.loadGameState(busy))!;
    expect(kept.habits.find((h) => h.id === "run")!.history.map((d) => d.date)).toContain("2027-12-05");

    // The next hourly run closes the week from the fresh state, check-in included.
    const r2 = await runWeeklyRollover(admin, stubCloseWeek, at("2027-12-06T06:07:00Z"));
    expect(r2.closed.map((c) => c.userId)).toContain(busy);
    const after = (await api.loadGameState(busy))!;
    expect(after.score).toBe(kept.score);
    expect(after.habits.find((h) => h.id === "run")!.history.map((d) => d.date)).toContain("2027-12-05");
  });

  it("the real engine closeWeek (engine #21) runs through the adapter and its result loads back", async () => {
    const solo = await player("Pacific/Auckland");
    // Sunday 12 Dec 23:00 in Auckland (UTC+13) = 10:00 UTC. Close the earlier weeks with the stub first.
    await runWeeklyRollover(admin, stubCloseWeek, at("2027-12-06T00:00:00Z"));
    const before = (await createGameApi(admin).loadGameState(solo))!;
    const r = await runWeeklyRollover(admin, engineCloseWeek(), at("2027-12-12T11:00:00Z"));
    expect(r.failed.filter((f) => f.userId === solo)).toEqual([]);
    expect(r.closed.find((c) => c.userId === solo)?.weekEnding).toBe("2027-12-12");
    const expected = await engineCloseWeek()(before, "2027-12-12");
    expect(await createGameApi(admin).loadGameState(solo)).toEqual(expected.state);
  });
});
