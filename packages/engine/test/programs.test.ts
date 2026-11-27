import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState, type Program } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeWeek } from "../src/index";

// run -> body-201 (milestone, in progress 0.4, level 2). Level 201 multiplier 1.25: program week = 50 x 1.25 = 63 (62.5).
const DATE = "2026-11-27";
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string): CheckInEntry => ({ habitId, result: "missed", reason: "fatigue" });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const week = (index: number) => ({ index, sessions: ["Easy 3K", "Intervals", "Easy 3K", "Long 5K"] });
const program = (patch: Partial<Program> = {}): Program => ({
  id: "10k-plan", goalId: "body-201", weeks: [week(1), week(2), week(3)], currentWeek: 1, done: [false, false, false, false], threshold: 3, ...patch,
});
const withProgram = (p: Program = program()): GameState => ({ ...SAMPLE_STATE, programs: [p] });
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
/** Close `n` nights in a row with one entry for `habitId` each. */
function nights(state: GameState, n: number, entry: (id: string) => CheckInEntry, from = DATE) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const r = closeDay(state, { date: addDays(from, i), entries: [entry("run")] });
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe("Programs", () => {
  it("a done entry on a program goal's habit fills one session of the current week", () => {
    const { state } = closeDay(withProgram(), { date: DATE, entries: [full("run")] });
    expect(state.programs[0]!.done).toEqual([true, false, false, false]);
    expect(state.programs[0]!.currentWeek).toBe(1);
  });

  it("minimum entries count as sessions; misses do not", () => {
    expect(closeDay(withProgram(), { date: DATE, entries: [minimum("run")] }).state.programs[0]!.done[0]).toBe(true);
    expect(closeDay(withProgram(), { date: DATE, entries: [missed("run")] }).state.programs[0]!.done).toEqual([false, false, false, false]);
  });

  it("program week: reaching the threshold pays points.programWeek x level multiplier and credits.programWeek, and advances", () => {
    const { state, events } = nights(withProgram(), 3, full);
    const p = state.programs[0]!;
    expect(p.currentWeek).toBe(2);
    expect(p.done).toEqual([false, false, false, false]);
    expect(events).toContainEqual({
      type: "points", score: Math.round(R.points.programWeek * 1.25), credits: R.credits.programWeek, reason: "program_week", sourceId: "10k-plan",
    });
  });

  it("program goals move only by finished weeks: progress = weeks finished / total weeks", () => {
    const two = nights(withProgram(), 2, full).state;
    expect(goal(two, "body-201").progress).toBe(0.4);
    const { state, events } = nights(withProgram(), 3, full);
    expect(goal(state, "body-201").progress).toBeCloseTo(1 / 3);
    expect(events).toContainEqual({ type: "progress", goalId: "body-201", from: 0.4, to: goal(state, "body-201").progress });
  });

  it("finishing the last week sets progress to 1 and locks the goal in with its bonus", () => {
    const lastWeek = withProgram(program({ currentWeek: 3, done: [true, true, false, false] }));
    const { state, events } = closeDay(lastWeek, { date: DATE, entries: [full("run")] });
    expect(goal(state, "body-201").status).toBe("locked_in");
    expect(goal(state, "body-201").progress).toBe(1);
    expect(state.programs[0]!.currentWeek).toBe(4);
    expect(events).toContainEqual({ type: "locked_in", goalId: "body-201" });
    expect(events).toContainEqual(expect.objectContaining({ reason: "goal_locked_in", sourceId: "body-201" }));
  });

  it("threshold 0 falls back to program.defaultThreshold", () => {
    const { state } = nights(withProgram(program({ threshold: 0 })), R.program.defaultThreshold, full);
    expect(state.programs[0]!.currentWeek).toBe(2);
  });

  it("falling short means repeating the week: closeWeek resets an unfinished week's sessions", () => {
    const started = nights(withProgram(), 2, full).state;
    const { state } = closeWeek(started, "2026-11-29");
    expect(state.programs[0]!.currentWeek).toBe(1);
    expect(state.programs[0]!.done).toEqual([false, false, false, false]);
  });

  it("sessions on a frozen program goal do not count", () => {
    const frozen: GameState = { ...withProgram(), goals: SAMPLE_STATE.goals.map((g) => (g.id === "body-201" ? { ...g, frozen: true } : g)) };
    expect(closeDay(frozen, { date: DATE, entries: [full("run")] }).state.programs[0]!.done[0]).toBe(false);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(withProgram(program({ done: [true, true, false, false] })));
    const before = structuredClone(input);
    closeDay(input, { date: DATE, entries: [full("run")] });
    closeWeek(input, "2026-11-29");
    expect(input).toEqual(before);
  });
});
