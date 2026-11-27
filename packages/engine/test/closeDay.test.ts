import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, createEngine, type HabitWithLastResult } from "../src/index";

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

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe("closeDay", () => {
  it("full habit earns full points times the level multiplier, and full credits", () => {
    const { state, events } = day(SAMPLE_STATE, full("run"));
    const points = Math.round(R.points.habitFull * mult);
    expect(state.score).toBe(SAMPLE_STATE.score + points);
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.habitFull);
    expect(events).toContainEqual({ type: "points", score: points, credits: R.credits.habitFull, reason: "habit" });
  });

  it("minimum habit earns minimum points times the level multiplier, and minimum credits", () => {
    const { state } = day(SAMPLE_STATE, minimum("run"));
    expect(state.score).toBe(SAMPLE_STATE.score + Math.round(R.points.habitMinimum * mult));
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.habitMinimum);
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

  it("health and strength stay within 0 to 100", () => {
    const top = day(withCharacter({ health: 100, strength: 100 }), full("run")).state.character;
    expect(top.health).toBe(100);
    expect(top.strength).toBe(100);
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
    expect(events).toEqual([{ type: "grace_used", habitId: "run" }]);
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

  it("double miss: a done day in between breaks the streak", () => {
    const missedOnce = day(noGrace, missed("run")).state;
    const done = closeDay(missedOnce, { date: "2026-11-28", entries: [minimum("run")] }).state;
    const { state } = closeDay(done, { date: "2026-11-29", entries: [missed("run")] });
    expect(state.character.health).toBe(done.character.health - R.health.missCost);
  });

  it("grace absorbs a double miss before a single miss", () => {
    const habits = SAMPLE_STATE.habits.map((h): HabitWithLastResult => (h.id === "run" ? { ...h, lastResult: "missed" } : h));
    const { state, events } = day({ ...withCharacter({ graceDaysLeft: 1 }), habits }, missed("meditate"), missed("run"));
    expect(events).toContainEqual({ type: "grace_used", habitId: "run" });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost);
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
