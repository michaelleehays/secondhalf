import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, createEngine } from "../src/index";

const DATE = "2026-11-27";
const day = (state: GameState, ...entries: CheckInEntry[]) => closeDay(state, { date: DATE, entries });
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string): CheckInEntry => ({ habitId, result: "missed", reason: "fatigue" });

/** Sample player (Level 201) with the character set as given. */
const withCharacter = (c: Partial<GameState["character"]>): GameState => ({
  ...SAMPLE_STATE,
  character: { ...SAMPLE_STATE.character, ...c },
});
const noGrace = withCharacter({ graceDaysLeft: 0 });
const mult = R.levelMultiplier[SAMPLE_STATE.level];
/** Sample player with one habit's history preset. */
const withHistory = (state: GameState, habitId: string, ...results: ("full" | "minimum" | "missed")[]): GameState => ({
  ...state,
  habits: state.habits.map((h) =>
    h.id === habitId ? { ...h, history: results.map((result, i) => ({ date: `2026-11-${String(20 + i).padStart(2, "0")}`, result })) } : h,
  ),
});
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const withGoal = (state: GameState, id: string, patch: Partial<GameState["goals"][number]>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe("closeDay", () => {
  it("full habit earns full points times the level multiplier, and full credits (Level 201: 15 x 1.25 = 19)", () => {
    const { state, events } = day(SAMPLE_STATE, full("run"));
    expect(state.score).toBe(SAMPLE_STATE.score + 19);
    expect(state.credits).toBe(SAMPLE_STATE.credits + 10);
    expect(events).toContainEqual({ type: "points", score: 19, credits: 10, reason: "habit" });
  });

  it("minimum habit earns minimum points times the level multiplier, and minimum credits (Level 201: 6 x 1.25 = 8)", () => {
    const { state } = day(SAMPLE_STATE, minimum("run"));
    expect(state.score).toBe(SAMPLE_STATE.score + 8);
    expect(state.credits).toBe(SAMPLE_STATE.credits + 4);
  });

  it("credits do not take the level multiplier", () => {
    const level1 = day({ ...SAMPLE_STATE, level: 1 }, full("run")).state;
    const level2 = day(SAMPLE_STATE, full("run")).state;
    expect(level1.credits - SAMPLE_STATE.credits).toBe(level2.credits - SAMPLE_STATE.credits);
    expect(level2.score - SAMPLE_STATE.score).toBeGreaterThan(level1.score - SAMPLE_STATE.score);
  });

  it("done habits restore health: full and minimum restore their own amounts", () => {
    expect(day(SAMPLE_STATE, full("run")).state.character.health).toBe(SAMPLE_STATE.character.health + R.health.fullRestore);
    expect(day(SAMPLE_STATE, minimum("run")).state.character.health).toBe(SAMPLE_STATE.character.health + R.health.minimumRestore);
  });

  it("done habits build strength: full and minimum gain their own amounts", () => {
    const { state, events } = day(SAMPLE_STATE, full("run"), minimum("meditate"));
    const gain = R.strength.fullGain + R.strength.minimumGain;
    expect(state.character.strength).toBe(SAMPLE_STATE.character.strength + gain);
    expect(events).toContainEqual({ type: "strength_changed", delta: gain });
  });

  it("health changes are summed and clamped once, so entry order does not matter", () => {
    const start = withCharacter({ health: 100, graceDaysLeft: 0 });
    const a = day(start, full("run"), missed("meditate"));
    const b = day(start, missed("meditate"), full("run"));
    const expected = 100 + R.health.fullRestore - R.health.missCost;
    expect(a.state.character.health).toBe(expected);
    expect(b.state.character.health).toBe(expected);
    expect(a.events).toEqual(b.events);
    const sum = (r: typeof a) => r.events.reduce((n, e) => n + (e.type === "health_changed" ? e.delta : 0), 0);
    expect(sum(a)).toBe(expected - 100);
    expect(sum(b)).toBe(expected - 100);
  });

  it("health events add up to the clamped change", () => {
    const top = day(withCharacter({ health: 99 }), full("run"), full("meditate"));
    expect(top.events.filter((e) => e.type === "health_changed")).toEqual([{ type: "health_changed", delta: 1, reason: "habit" }]);
    // 2 + 3 - 6 = -1, clamped to 0: the events add up to -2.
    const bottom = day(withCharacter({ health: 2, graceDaysLeft: 0 }), missed("run"), full("meditate"));
    expect(bottom.state.character.health).toBe(0);
    const deltas = bottom.events.flatMap((e) => (e.type === "health_changed" ? [e.delta] : []));
    expect(deltas.reduce((n, d) => n + d, 0)).toBe(-2);
  });

  it("health and strength stay within 0 and their max", () => {
    const top = day(withCharacter({ health: R.health.max, strength: R.strength.max }), full("run")).state.character;
    expect(top.health).toBe(R.health.max);
    expect(top.strength).toBe(R.strength.max);
    const bottom = day(withCharacter({ health: 2, graceDaysLeft: 0 }), missed("run")).state.character;
    expect(bottom.health).toBe(0);
  });

  it("a done habit marks its area as moved this week", () => {
    const { state } = day(SAMPLE_STATE, minimum("reach-out"), missed("run"));
    expect(state.weekProgress.people).toBe(true);
    expect(state.weekProgress.body).toBeUndefined();
  });

  it("grace days absorb misses first, with no damage", () => {
    const { state, events } = day(withCharacter({ graceDaysLeft: 1 }), missed("run"));
    expect(state.character.graceDaysLeft).toBe(0);
    expect(state.character.health).toBe(SAMPLE_STATE.character.health);
    expect(events).toContainEqual({ type: "grace_used", habitId: "run" });
    expect(events.some((e) => e.type === "health_changed")).toBe(false);
  });

  it("a miss with no grace left costs health", () => {
    const { state, events } = day(noGrace, missed("run"));
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost);
    expect(events).toContainEqual({ type: "health_changed", delta: -R.health.missCost, reason: "miss" });
  });

  it("grace covers as many misses as it has days; the rest cost health", () => {
    const { state, events } = day(withCharacter({ graceDaysLeft: 1 }), missed("run"), missed("meditate"));
    expect(state.character.graceDaysLeft).toBe(0);
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost);
    expect(events.filter((e) => e.type === "grace_used")).toHaveLength(1);
  });

  it("double miss: a second miss in a row on the same habit costs double", () => {
    const first = day(noGrace, missed("run")).state;
    const { state, events } = closeDay(first, { date: "2026-11-28", entries: [missed("run")] });
    const cost = R.health.missCost * R.health.doubleMissFactor;
    expect(state.character.health).toBe(first.character.health - cost);
    expect(events).toContainEqual({ type: "health_changed", delta: -cost, reason: "double_miss" });
  });

  it("double miss: a miss absorbed by grace still counts toward a second miss in a row", () => {
    const first = day(withCharacter({ graceDaysLeft: 1 }), missed("run")).state;
    const { state } = closeDay(first, { date: "2026-11-28", entries: [missed("run")] });
    expect(state.character.health).toBe(first.character.health - R.health.missCost * R.health.doubleMissFactor);
  });

  it("double miss: two misses in a row means the habit's last two check-ins, not calendar days", () => {
    const start = withHistory(noGrace, "run", "full", "missed");
    const { state } = closeDay(start, { date: "2026-11-27", entries: [missed("run")] });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost * R.health.doubleMissFactor);
  });

  it("double miss: a done day in between breaks the streak", () => {
    const missedOnce = day(noGrace, missed("run")).state;
    const done = closeDay(missedOnce, { date: "2026-11-28", entries: [minimum("run")] }).state;
    const { state } = closeDay(done, { date: "2026-11-29", entries: [missed("run")] });
    expect(state.character.health).toBe(done.character.health - R.health.missCost);
  });

  it("grace absorbs a double miss before a single miss", () => {
    const start = withHistory(withCharacter({ graceDaysLeft: 1 }), "run", "missed");
    const { state, events } = day(start, missed("meditate"), missed("run"));
    expect(events).toContainEqual({ type: "grace_used", habitId: "run" });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost);
  });

  it("history: each check-in is appended to the habit's history, oldest first", () => {
    const { state } = day(SAMPLE_STATE, missed("run"), full("meditate"));
    expect(state.habits.find((h) => h.id === "run")!.history).toEqual([{ date: DATE, result: "missed", reason: "fatigue", graced: true }]);
    expect(state.habits.find((h) => h.id === "meditate")!.history).toEqual([{ date: DATE, result: "full" }]);
    expect(state.habits.find((h) => h.id === "deep-work")!.history).toEqual([]);
  });

  it("history: keeps only the last history.days days", () => {
    const old = { date: "2026-11-01", result: "full" as const };
    const recent = { date: "2026-11-20", result: "missed" as const };
    const start: GameState = { ...SAMPLE_STATE, habits: SAMPLE_STATE.habits.map((h) => (h.id === "run" ? { ...h, history: [old, recent] } : h)) };
    const { state } = day(start, full("run"));
    expect(state.habits.find((h) => h.id === "run")!.history).toEqual([recent, { date: DATE, result: "full" }]);
  });

  it("goal progress: full and minimum check-ins move the habit's goal by perFull and perMinimum", () => {
    // run -> body-201 (in progress, 0.4); deep-work -> work-201 (open, 0).
    const { state, events } = day(SAMPLE_STATE, full("run"), minimum("deep-work"));
    expect(goal(state, "body-201").progress).toBeCloseTo(0.4 + R.progress.perFull);
    expect(goal(state, "work-201").progress).toBeCloseTo(R.progress.perMinimum);
    expect(goal(state, "work-201").status).toBe("in_progress");
    expect(events).toContainEqual({ type: "progress", goalId: "body-201", from: 0.4, to: goal(state, "body-201").progress });
  });

  it("goal progress: misses, locked-in goals, frozen goals and goals with a program do not move", () => {
    const frozen = withGoal(SAMPLE_STATE, "body-201", { frozen: true });
    expect(goal(day(frozen, full("run")).state, "body-201").progress).toBe(0.4);
    const programmed: GameState = {
      ...SAMPLE_STATE,
      programs: [{ id: "p", goalId: "body-201", weeks: [], currentWeek: 1, done: [], threshold: R.program.defaultThreshold }],
    };
    expect(goal(day(programmed, full("run")).state, "body-201").progress).toBe(0.4);
    // meditate -> mind-101, already locked in.
    const { events } = day(SAMPLE_STATE, full("meditate"), missed("run"));
    expect(events.some((e) => e.type === "progress")).toBe(false);
  });

  it("locked in: a goal reaching full progress locks in and pays goalLockedInPerLevel x level, with the level multiplier", () => {
    // reach-out -> people-101 (level 1).
    const start = withGoal(SAMPLE_STATE, "people-101", { progress: 1 - R.progress.perMinimum });
    const { state, events } = day(start, minimum("reach-out"));
    const g = goal(state, "people-101");
    expect(g.status).toBe("locked_in");
    expect(g.progress).toBe(1);
    expect(g.lockedInOn).toBe(DATE);
    const bonus = Math.round(R.points.goalLockedInPerLevel * 1 * mult);
    expect(events).toContainEqual({ type: "locked_in", goalId: "people-101" });
    expect(events).toContainEqual({ type: "points", score: bonus, credits: R.credits.goalLockedInPerLevel * 1, reason: "goal_locked_in" });
    expect(state.score).toBe(SAMPLE_STATE.score + 8 + bonus);
  });

  it("locked in: lost ground is won back by check-ins and locks in again at full progress", () => {
    const start = withGoal(SAMPLE_STATE, "people-101", { status: "lost", progress: 0.99 });
    expect(goal(day(start, full("reach-out")).state, "people-101").status).toBe("locked_in");
  });

  it("score is never taken away by misses", () => {
    const { state } = day(noGrace, missed("run"), missed("meditate"));
    expect(state.score).toBe(SAMPLE_STATE.score);
    expect(state.credits).toBe(SAMPLE_STATE.credits);
  });

  it("entries for unknown habits are ignored", () => {
    const { state, events } = day(SAMPLE_STATE, full("not-a-habit"));
    expect(events).toEqual([]);
    expect(state.score).toBe(SAMPLE_STATE.score);
  });

  it("moves today to the check-in date", () => {
    expect(day(SAMPLE_STATE).state.today).toBe(DATE);
  });

  it("does not mutate its input", () => {
    const input = deepFreeze(structuredClone(withCharacter({ graceDaysLeft: 1 })));
    const before = structuredClone(input);
    day(input, full("run"), missed("meditate"), missed("deep-work"));
    expect(input).toEqual(before);
  });

  it("reads rule values from the config passed to the engine", () => {
    const config = { ...R, health: { ...R.health, missCost: 10 } };
    const { state } = createEngine(config).closeDay(noGrace, { date: DATE, entries: [missed("run")] });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - 10);
  });
});
