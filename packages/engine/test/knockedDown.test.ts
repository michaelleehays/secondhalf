import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState, type Habit } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeWeek, toWorldView } from "../src/index";

const DATE = "2026-11-27";
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string): CheckInEntry => ({ habitId, result: "missed", reason: "stress" });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
/** Auto Recovery off (already used this season) so these tests see the knocked-down rules on their own. */
const season = { ...SAMPLE_STATE.season, autoRecoveryUsed: true };
/** Health one miss away from knocked down, whatever the tuning. */
const ONE_MISS_FROM_DOWN = R.health.knockedDownAt + R.health.missCost - 1;
const at = (health: number, knockedDown?: { since: string; plays: number }): GameState => ({
  ...SAMPLE_STATE,
  season,
  character: { ...SAMPLE_STATE.character, health, graceDaysLeft: 0, ...(knockedDown ? { knockedDown } : {}) },
});

describe("Knocked down", () => {
  it("knocked down: reaching knockedDownAt sets character.knockedDown and emits knocked_down", () => {
    const { state, events } = closeDay(at(ONE_MISS_FROM_DOWN), { date: DATE, entries: [missed("run")] });
    expect(state.character.health).toBe(0);
    expect(state.character.knockedDown).toEqual({ since: DATE, plays: 0 });
    expect(events).toContainEqual({ type: "knocked_down" });
    expect(toWorldView(state).athlete.knockedDown).toBe(true);
  });

  it("while down, habits restore no health but points and credits still score", () => {
    const { state, events } = closeDay(at(0, { since: "2026-11-26", plays: 0 }), { date: DATE, entries: [full("run")] });
    expect(state.character.health).toBe(0);
    expect(state.score).toBe(SAMPLE_STATE.score + 19);
    expect(state.character.knockedDown).toEqual({ since: "2026-11-26", plays: 1 });
    expect(events.some((e) => e.type === "health_changed")).toBe(false);
    expect(events).not.toContainEqual({ type: "knocked_down" });
  });

  it("getting up: getUpAfterPlays done or minimum entries get the athlete up at getUpHealth", () => {
    let state = at(0, { since: "2026-11-26", plays: 0 });
    for (let i = 0; i < R.health.getUpAfterPlays; i++) {
      state = closeDay(state, { date: addDays(DATE, i), entries: [minimum("meditate")] }).state;
    }
    expect(state.character.knockedDown).toBeUndefined();
    expect("knockedDown" in state.character).toBe(false);
    expect(state.character.health).toBe(R.health.getUpHealth);
    expect(toWorldView(state).athlete.knockedDown).toBe(false);
  });

  it("getting up: several plays in one night count, and a miss that night does not stop it", () => {
    const start = at(0, { since: "2026-11-26", plays: R.health.getUpAfterPlays - 2 });
    const { state, events } = closeDay(start, { date: DATE, entries: [full("run"), minimum("meditate"), missed("deep-work")] });
    expect(state.character.health).toBe(R.health.getUpHealth);
    expect(events.filter((e) => e.type === "health_changed")).toEqual([{ type: "health_changed", delta: R.health.getUpHealth, reason: "habit" }]);
  });

  it("misses while down cost nothing more and are not plays", () => {
    const { state } = closeDay(at(0, { since: "2026-11-26", plays: 1 }), { date: DATE, entries: [missed("run")] });
    expect(state.character.health).toBe(0);
    expect(state.character.knockedDown?.plays).toBe(1);
  });

  it("knocked down at 0 health starts auto Recovery when it is still available this season", () => {
    const fresh = { ...at(ONE_MISS_FROM_DOWN), season: SAMPLE_STATE.season };
    const { state, events } = closeDay(fresh, { date: DATE, entries: [missed("run")] });
    expect(state.character.knockedDown).toBeDefined();
    expect(state.recovery?.cause).toBe("auto");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["knocked_down", "recovery_started"]));
  });

  it("in Recovery, done entries still count as plays, and completing Recovery gets the athlete up", () => {
    const recovering: GameState = {
      ...at(0, { since: "2026-11-26", plays: 0 }),
      recovery: { cause: "auto", startedOn: "2026-11-26", day: 1, daysDone: 0, habitTitle: "Meditate: Three slow breaths" },
    };
    const one = closeDay(recovering, { date: DATE, entries: [minimum("meditate")] }).state;
    expect(one.character.knockedDown?.plays).toBe(1);
    const nearlyDone = { ...recovering, recovery: { ...recovering.recovery!, daysDone: R.recovery.daysNeeded - 1 } };
    const done = closeDay(nearlyDone, { date: DATE, entries: [minimum("meditate")] }).state;
    expect(done.character.knockedDown).toBeUndefined();
    expect(done.character.health).toBe(R.recovery.restoreHealth);
  });
});

describe("Maintenance cap", () => {
  // Maintenance habits on the sample's locked-in system goal mind-101.
  const maint = (n: number, goalId = "mind-101"): Habit[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${i + 1}`, goalId, area: "mind", title: `Maintain ${i + 1}`, fullDose: "x", minimumDose: "y",
      weeklyTarget: { focus: 1, maintain: 1, rest: 0 }, maintenance: true, history: [],
    }));
  const withMaint = (habits: Habit[], state: GameState = SAMPLE_STATE): GameState => ({ ...state, habits: [...state.habits, ...habits] });

  it("maintenance cap: closeWeek emits maintenance_cap when maintenance habits pass maxWeeklyHabits", () => {
    const n = R.maintenance.maxWeeklyHabits + 1;
    const { events } = closeWeek(withMaint(maint(n)), "2026-11-29");
    expect(events).toContainEqual({
      type: "maintenance_cap", count: n, max: R.maintenance.maxWeeklyHabits, habitIds: maint(n).map((h) => h.id),
    });
  });

  it("maintenance cap: at the cap, or for goals not held, there is no event", () => {
    expect(closeWeek(withMaint(maint(R.maintenance.maxWeeklyHabits)), "2026-11-29").events.some((e) => e.type === "maintenance_cap")).toBe(false);
    const lost = withMaint(maint(R.maintenance.maxWeeklyHabits + 1, "people-101")); // people-101 is in progress, not held
    expect(closeWeek(lost, "2026-11-29").events.some((e) => e.type === "maintenance_cap")).toBe(false);
  });

  it("maintenance cap: closeDay emits it on a night a system goal locks in past the cap", () => {
    // people-101 is a system goal in progress at 0.5; it locks in tonight and brings its maintenance habits into the count.
    const start: GameState = {
      ...withMaint(maint(R.maintenance.maxWeeklyHabits + 1, "people-101")),
      goals: SAMPLE_STATE.goals.map((g) => (g.id === "people-101" ? { ...g, progress: 1 - R.progress.perFull } : g)),
    };
    const { events } = closeDay(start, { date: DATE, entries: [full("reach-out")] });
    expect(events).toContainEqual(expect.objectContaining({ type: "maintenance_cap", count: R.maintenance.maxWeeklyHabits + 1 }));
    // A normal night over the cap does not repeat it.
    expect(closeDay(withMaint(maint(R.maintenance.maxWeeklyHabits + 1)), { date: DATE, entries: [full("run")] }).events.some((e) => e.type === "maintenance_cap")).toBe(false);
  });
});
