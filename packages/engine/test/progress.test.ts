import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type Goal, type HabitDay, type Program } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeWeek, createEngine, verifyAchievement, weeklyShare } from "../src/index";

// Sample: Level 201. run -> body-201 (milestone, in progress 0.4, Body in Focus: target 4 a week).
// reach-out -> people-101 (system, in progress 0.5, People in Maintain: target 2 a week).
const SUNDAY = "2026-11-29";
const moved = { body: true, mind: true, work: true, people: true, money: true };
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const days = (n: number, result: HabitDay["result"] = "full"): HabitDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-11-${23 + i}`, result }));
function setup(history: Record<string, HabitDay[]>, goals: Record<string, Partial<Goal>> = {}, extra: Partial<GameState> = {}): GameState {
  return {
    ...SAMPLE_STATE,
    weekProgress: moved,
    habits: SAMPLE_STATE.habits.map((h) => (history[h.id] ? { ...h, history: history[h.id]! } : h)),
    goals: SAMPLE_STATE.goals.map((g) => (goals[g.id] ? { ...g, ...goals[g.id] } : g)),
    ...extra,
  };
}
const verifyAt = R.progress.milestoneVerifyAt;
/** One consistent week: a milestone moves verifyAt / weeks (body-201, level 2); a system goal 1 / weeks (people-101, level 1). */
const step2 = verifyAt / R.progress.weeksToLockIn[2];
const step1 = 1 / R.progress.weeksToLockIn[1];

describe("Consistent weeks", () => {
  it("consistent week: habits reaching consistentWeekShare of their weekly target move the goal 1 / weeksToLockIn[level] of the way", () => {
    const { state, events } = closeWeek(setup({ run: days(4) }), SUNDAY);
    expect(goal(state, "body-201").progress).toBeCloseTo(0.4 + step2);
    expect(events).toContainEqual({ type: "progress", goalId: "body-201", from: 0.4, to: goal(state, "body-201").progress });
  });

  it("consistent week: a minimum counts minimumWeight of a full one", () => {
    // 4 minimums = 2 of 4: short. 3 full + 2 minimum = 4 of 4: consistent.
    expect(weeklyShare(goal(SAMPLE_STATE, "body-201"), SAMPLE_STATE, setup({ run: days(4, "minimum") }).habits, SUNDAY, R)).toBeCloseTo(4 * R.progress.minimumWeight / 4);
    expect(goal(closeWeek(setup({ run: days(4, "minimum") }), SUNDAY).state, "body-201").progress).toBe(0.4);
    const mixed = [...days(3), { date: "2026-11-27", result: "minimum" as const }, { date: "2026-11-28", result: "minimum" as const }];
    expect(goal(closeWeek(setup({ run: mixed }), SUNDAY).state, "body-201").progress).toBeCloseTo(0.4 + step2);
  });

  it("consistent week: short of the share, the goal does not move", () => {
    // 2 of 4 = 0.5, below consistentWeekShare.
    expect(2 / 4).toBeLessThan(R.progress.consistentWeekShare);
    expect(goal(closeWeek(setup({ run: days(2) }), SUNDAY).state, "body-201").progress).toBe(0.4);
  });

  it("consistent week: only the 7 days ending weekEnding count", () => {
    const lastWeek = days(4).map((d) => ({ ...d, date: d.date.replace("2026-11-2", "2026-11-1") }));
    expect(goal(closeWeek(setup({ run: lastWeek }), SUNDAY).state, "body-201").progress).toBe(0.4);
  });

  it("Rest-mode areas neither gain nor lose", () => {
    const resting = setup({ run: days(7) }, {}, { modes: { ...SAMPLE_STATE.modes, body: "rest" }, weekProgress: {} });
    expect(goal(closeWeek(resting, SUNDAY).state, "body-201").progress).toBe(0.4);
  });

  it("weeksToLockIn is the real time for both kinds: a milestone reaches the verify point, a system goal 1", () => {
    let milestone = setup({ run: days(4) }, { "body-201": { progress: 0, status: "open" } });
    for (let w = 0; w < R.progress.weeksToLockIn[2]; w++) milestone = { ...closeWeek(milestone, SUNDAY).state, weekProgress: moved, habits: milestone.habits };
    expect(goal(milestone, "body-201").progress).toBeCloseTo(verifyAt);
    let system = setup({ "reach-out": days(2) }, { "people-101": { progress: 0, status: "open" } });
    for (let w = 0; w < R.progress.weeksToLockIn[1] - 1; w++) system = { ...closeWeek(system, SUNDAY).state, weekProgress: moved, habits: system.habits };
    expect(goal(system, "people-101").status).toBe("in_progress");
    system = closeWeek(system, SUNDAY).state;
    expect(goal(system, "people-101").status).toBe("locked_in");
  });

  it("system goals lock in at 1, with the lock-in bonus", () => {
    const start = setup({ "reach-out": days(2) }, { "people-101": { progress: 1 - step1 } });
    const { state, events } = closeWeek(start, SUNDAY);
    expect(goal(state, "people-101").status).toBe("locked_in");
    const bonus = Math.round(R.points.goalLockedInPerLevel * 1 * R.levelMultiplier[2]);
    expect(events).toContainEqual({ type: "points", score: bonus, credits: R.credits.goalLockedInPerLevel, reason: "goal_locked_in", sourceId: "people-101" });
  });

  it("milestone goals stop at milestoneVerifyAt and emit ready_to_verify once", () => {
    const first = closeWeek(setup({ run: days(4) }, { "body-201": { progress: verifyAt - step2 / 2 } }), SUNDAY);
    expect(goal(first.state, "body-201").progress).toBe(verifyAt);
    expect(goal(first.state, "body-201").status).toBe("in_progress");
    expect(first.events).toContainEqual({ type: "ready_to_verify", goalId: "body-201" });
    const again = closeWeek(setup({ run: days(4) }, { "body-201": { progress: verifyAt } }), SUNDAY);
    expect(again.events.some((e) => e.type === "ready_to_verify" || (e.type === "progress" && e.goalId === "body-201"))).toBe(false);
  });

  it("goals in Recovery do not move by consistent weeks", () => {
    const recovering = setup({ run: days(4) }, {}, {
      recovery: { cause: "life_event", startedOn: "2026-11-23", day: 3, daysDone: 2, habitTitle: "Tempo run: 15-minute easy jog" },
    });
    expect(goal(closeWeek(recovering, SUNDAY).state, "body-201").progress).toBe(0.4);
  });
});

describe("verifyAchievement", () => {
  it("verified at the verify point: emits verified, then locks the milestone in with its bonus", () => {
    const start = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((g) => (g.id === "body-201" ? { ...g, progress: verifyAt } : g)) };
    const { state, events } = verifyAchievement(start, "body-201", "2026-11-30", "Ran 10K in 58:12");
    expect(goal(state, "body-201")).toMatchObject({ status: "locked_in", progress: 1, verifiedOn: "2026-11-30", lockedInOn: "2026-11-30" });
    const types = events.map((e) => e.type);
    expect(events[0]).toEqual({ type: "verified", goalId: "body-201", note: "Ran 10K in 58:12" });
    expect(types.indexOf("locked_in")).toBeGreaterThan(types.indexOf("verified"));
    expect(state.score).toBe(SAMPLE_STATE.score + Math.round(R.points.goalLockedInPerLevel * 2 * R.levelMultiplier[2]));
  });

  it("verified early: records verifiedOn, and the goal locks in the moment consistency reaches the verify point", () => {
    const early = verifyAchievement(SAMPLE_STATE, "body-201", "2026-11-25");
    expect(goal(early.state, "body-201")).toMatchObject({ status: "in_progress", progress: 0.4, verifiedOn: "2026-11-25" });
    expect(early.events).toEqual([{ type: "verified", goalId: "body-201" }]);
    const start = setup({ run: days(4) }, { "body-201": { progress: verifyAt - step2 / 2, verifiedOn: "2026-11-25" } });
    const { state, events } = closeWeek(start, SUNDAY);
    expect(goal(state, "body-201").status).toBe("locked_in");
    expect(events.some((e) => e.type === "ready_to_verify")).toBe(false);
  });

  it("does nothing for system goals, held or hidden goals, already verified goals and unknown ids", () => {
    const verified = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((g) => (g.id === "body-201" ? { ...g, verifiedOn: "2026-11-01" } : g)) };
    for (const [state, id] of [[SAMPLE_STATE, "people-101"], [SAMPLE_STATE, "work-101"], [SAMPLE_STATE, "money-101"], [SAMPLE_STATE, "body-301"], [verified, "body-201"], [SAMPLE_STATE, "nope"]] as const) {
      const r = verifyAchievement(state, id, "2026-11-30");
      expect(r.state).toBe(state);
      expect(r.events).toEqual([]);
    }
  });

  it("is wired into the engine", () => {
    expect(createEngine().verifyAchievement(SAMPLE_STATE, "body-201", "2026-11-30").events[0]?.type).toBe("verified");
  });
});

describe("Programs and verification", () => {
  const program = (patch: Partial<Program>): Program => ({
    id: "10k", goalId: "body-201", weeks: Array.from({ length: 10 }, (_, i) => ({ index: i + 1, sessions: ["a", "b", "c", "d"] })),
    currentWeek: 1, done: [false, false, false, false], threshold: 3, ...patch,
  });
  const withProgram = (p: Program): GameState => ({ ...SAMPLE_STATE, programs: [p] });

  it("a milestone run by a program waits at the verify point until its last week", () => {
    const { state } = closeDay(withProgram(program({ currentWeek: 9, done: [true, true, false, false] })), { date: "2026-11-27", entries: [{ habitId: "run", result: "full" }] });
    expect(goal(state, "body-201").progress).toBe(verifyAt); // 9 of 10 weeks = 0.9, held at the verify point
  });

  it("finishing the program counts as verification: the milestone locks in", () => {
    const { state, events } = closeDay(withProgram(program({ currentWeek: 10, done: [true, true, false, false] })), { date: "2026-11-27", entries: [{ habitId: "run", result: "full" }] });
    expect(goal(state, "body-201")).toMatchObject({ status: "locked_in", verifiedOn: "2026-11-27" });
    expect(events.some((e) => e.type === "ready_to_verify")).toBe(false);
  });

  it("program goals do not also move by consistent weeks", () => {
    const start = { ...setup({ run: days(4) }), programs: [program({})] };
    expect(goal(closeWeek(start, SUNDAY).state, "body-201").progress).toBe(0.4);
  });
});

describe("no mutation", () => {
  it("closeWeek and verifyAchievement do not mutate their input", () => {
    const input = structuredClone(setup({ run: days(4), "reach-out": days(2) }, { "people-101": { progress: 1 - step1 } }));
    const before = structuredClone(input);
    closeWeek(input, SUNDAY);
    verifyAchievement(input, "body-201", "2026-11-30");
    expect(input).toEqual(before);
  });
});
