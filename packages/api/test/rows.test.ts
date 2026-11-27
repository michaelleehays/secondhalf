/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameState, StepResult } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { ledgerFromEvents, seedSql, toGameState, toSaveArgs, type GameSnapshot } from "../src/index";

/** The rows save_step_result would write for a state, as load_game_state returns them. */
function snapshotOf(s: GameState): GameSnapshot {
  return {
    profile: {
      id: s.userId, birth_year: s.birthYear, end_age: s.endAge, timezone: s.timezone, today: s.today,
      level: s.level, best_level: s.bestLevel ?? null, last_review_on: s.lastReviewOn ?? null,
      score: s.score, credits: s.credits, version: 0,
    },
    areas: Object.entries(s.modes).map(([area, mode]) => ({
      area: area as never, mode, week_progress: Boolean(s.weekProgress[area as keyof GameState["modes"]]),
    })),
    goals: s.goals.map((g) => ({
      id: g.id, area: g.area, level: g.level, title: g.title, kind: g.kind, status: g.status, progress: g.progress,
      risk: g.risk, frozen: g.frozen, locked_in_on: g.lockedInOn ?? null, last_quarterly_check: g.lastQuarterlyCheck ?? null,
    })),
    programs: s.programs.map((p) => ({
      id: p.id, goal_id: p.goalId, weeks: p.weeks, current_week: p.currentWeek, done: p.done, threshold: p.threshold,
    })),
    habits: s.habits.map((h) => ({
      id: h.id, goal_id: h.goalId, area: h.area, title: h.title, full_dose: h.fullDose, minimum_dose: h.minimumDose,
      weekly_target_focus: h.weeklyTarget.focus, weekly_target_maintain: h.weeklyTarget.maintain,
      weekly_target_rest: h.weeklyTarget.rest, maintenance: h.maintenance,
    })),
    checkIns: s.habits.flatMap((h) =>
      h.history.map((d) => ({ habit_id: h.id, date: d.date, result: d.result, reason: d.reason ?? null, graced: d.graced ?? false })),
    ),
    resistance: Object.values(s.resistance).map((r) => ({
      id: r.id, strength: r.strength, reports_14d: r.reports14d, target_area: r.targetArea,
    })),
    gamePlans: s.gamePlans,
    rules: s.rules.map((r) => ({
      id: r.id, trigger: r.trigger, message: r.message, effect: r.effect, starts_on: r.startsOn, ends_on: r.endsOn,
    })),
    character: {
      health: s.character.health, strength: s.character.strength, grace_days_left: s.character.graceDaysLeft,
      knocked_down_since: s.character.knockedDown?.since ?? null, knocked_down_plays: s.character.knockedDown?.plays ?? null,
    },
    recovery: s.recovery && {
      cause: s.recovery.cause, started_on: s.recovery.startedOn, day: s.recovery.day,
      days_done: s.recovery.daysDone, habit_title: s.recovery.habitTitle,
    },
    season: {
      index: s.season.index, starts_on: s.season.startsOn, focus: s.season.focus,
      auto_recovery_used: s.season.autoRecoveryUsed, life_event_pause_used: s.season.lifeEventPauseUsed,
    },
  };
}

const RICH: GameState = {
  ...SAMPLE_STATE,
  goals: SAMPLE_STATE.goals.map((g) => (g.id === "body-101" ? { ...g, lockedInOn: "2026-09-01" } : g)),
  habits: SAMPLE_STATE.habits.map((h) =>
    h.id === "run"
      ? { ...h, history: [{ date: "2026-11-24", result: "missed", reason: "fatigue", graced: true }, { date: "2026-11-25", result: "full" }] }
      : h,
  ),
  programs: [{ id: "p-10k", goalId: "body-201", weeks: [{ index: 1, sessions: ["Easy 3K", "Intervals"] }], currentWeek: 1, done: [true, false], threshold: 3 }],
  rules: [{ id: "r1", trigger: "fatigue", message: "Your minimum counts as full for 2 weeks.", effect: { kind: "minimum_counts_as_full", habitId: "run" }, startsOn: "2026-11-20", endsOn: "2026-12-04" }],
  recovery: { cause: "auto", startedOn: "2026-11-24", day: 3, daysDone: 2, habitTitle: "Tempo run" },
  weekProgress: { body: true },
  bestLevel: 3,
  lastReviewOn: "2026-11-22",
  character: { ...SAMPLE_STATE.character, health: 0, knockedDown: { since: "2026-11-25", plays: 1 } },
};

describe("toGameState", () => {
  it("round-trips SAMPLE_STATE through rows", () => {
    expect(toGameState(snapshotOf(SAMPLE_STATE))).toEqual(SAMPLE_STATE);
  });

  it("round-trips history, programs, rules, recovery, lock-in dates, week progress, bestLevel and knockedDown", () => {
    expect(toGameState(snapshotOf(RICH))).toEqual(RICH);
  });

  it("orders history oldest first whatever order the rows arrive in", () => {
    const snap = snapshotOf(RICH);
    snap.checkIns.reverse();
    expect(toGameState(snap).habits.find((h) => h.id === "run")!.history.map((d) => d.date)).toEqual(["2026-11-24", "2026-11-25"]);
  });

  it("leaves optional fields out rather than setting them to undefined", () => {
    const goal = toGameState(snapshotOf(SAMPLE_STATE)).goals[0]!;
    expect("lockedInOn" in goal).toBe(false);
    const loaded = toGameState(snapshotOf(SAMPLE_STATE));
    expect("knockedDown" in loaded.character).toBe(false);
    const { bestLevel: _best, ...noBest } = SAMPLE_STATE;
    expect("bestLevel" in toGameState(snapshotOf(noBest))).toBe(false);
    expect("lastReviewOn" in loaded).toBe(false);
    const day = toGameState(snapshotOf(RICH)).habits.find((h) => h.id === "run")!.history[1]!;
    expect("reason" in day).toBe(false);
    expect("graced" in day).toBe(false);
  });

  it("refuses a save with no character", () => {
    expect(() => toGameState({ ...snapshotOf(SAMPLE_STATE), character: null })).toThrow(/no character/);
  });
});

describe("ledgerFromEvents", () => {
  it("writes one row per points event, dated today", () => {
    const result: StepResult = {
      state: { ...SAMPLE_STATE, today: "2026-11-27" },
      events: [
        { type: "points", score: 19, credits: 10, reason: "habit", sourceId: "run" },
        { type: "health_changed", delta: 3, reason: "habit" },
        { type: "points", score: 625, credits: 100, reason: "goal_locked_in" },
      ],
    };
    expect(ledgerFromEvents(result)).toEqual([
      { date: "2026-11-27", kind: "habit", score: 19, credits: 10, sourceId: "run" },
      { date: "2026-11-27", kind: "goal_locked_in", score: 625, credits: 100 },
    ]);
    expect(toSaveArgs("u1", result).p_events).toHaveLength(3);
    expect(toSaveArgs("u1", result).p_expected_version).toBeNull();
    expect(toSaveArgs("u1", result, 7).p_expected_version).toBe(7);
  });
});

describe("seed.sql", () => {
  it("is up to date with SAMPLE_STATE (run npm run seed:generate -w @second-half/api)", () => {
    const committed = new TextDecoder().decode(readFileSync(new URL("../../../supabase/seed.sql", import.meta.url)));
    expect(committed).toBe(seedSql(SAMPLE_STATE));
  });
});
