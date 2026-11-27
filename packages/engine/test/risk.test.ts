import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState, type Goal, type HabitDay, type ResistanceId } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, createEngine, quarterlyCheck } from "../src/index";

// Sample: meditate -> mind-101 (system, locked in); no-impulse -> money-101 (milestone, at risk 60);
// run -> body-201 (in progress 0.4); work-101 is a locked-in milestone; temptation is at 5 and targets money.
const DATE = "2026-11-27";
const day = (state: GameState, ...entries: CheckInEntry[]) => closeDay(state, { date: DATE, entries });
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string, reason: ResistanceId = "stress"): CheckInEntry => ({ habitId, result: "missed", reason });

const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const withGoal = (state: GameState, id: string, patch: Partial<Goal>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
});
const withHistory = (state: GameState, habitId: string, history: HabitDay[]): GameState => ({
  ...state,
  habits: state.habits.map((h) => (h.id === habitId ? { ...h, history } : h)),
});
const noGrace: GameState = { ...SAMPLE_STATE, character: { ...SAMPLE_STATE.character, graceDaysLeft: 0 } };
const miss = (date: string, graced = false): HabitDay => ({ date, result: "missed", reason: "stress", ...(graced ? { graced } : {}) });

describe("At risk and lost ground", () => {
  it("miss pattern: missesToTrigger misses beyond grace in 7 days put a locked-in system goal at risk at onTrigger", () => {
    const start = withHistory(noGrace, "meditate", [miss("2026-11-24"), miss("2026-11-25")]);
    const { state, events } = day(start, missed("meditate"));
    expect(goal(state, "mind-101").status).toBe("at_risk");
    expect(goal(state, "mind-101").risk).toBe(R.risk.onTrigger);
    expect(events).toContainEqual({ type: "at_risk", goalId: "mind-101", risk: R.risk.onTrigger });
  });

  it("miss pattern: fewer than missesToTrigger misses leaves the goal locked in", () => {
    const start = withHistory(noGrace, "meditate", [miss("2026-11-25")]);
    expect(goal(day(start, missed("meditate")).state, "mind-101").status).toBe("locked_in");
  });

  it("miss pattern: misses older than 7 days do not count", () => {
    const start = withHistory(noGrace, "meditate", [miss("2026-11-19"), miss("2026-11-20")]);
    expect(goal(day(start, missed("meditate")).state, "mind-101").status).toBe("locked_in");
  });

  it("miss pattern: misses a grace day covered do not count, and are marked graced in history", () => {
    const start = withHistory(SAMPLE_STATE, "meditate", [miss("2026-11-24"), miss("2026-11-25")]);
    const { state } = day(start, missed("meditate"));
    expect(state.habits.find((h) => h.id === "meditate")!.history.at(-1)?.graced).toBe(true);
    expect(goal(state, "mind-101").status).toBe("locked_in");
    const graced = withHistory(noGrace, "meditate", [miss("2026-11-24", true), miss("2026-11-25", true)]);
    expect(goal(day(graced, missed("meditate")).state, "mind-101").status).toBe("locked_in");
  });

  it("miss pattern: it takes a miss today, so a goal just made safe is not put back at risk by old misses", () => {
    const start = withGoal(withHistory(noGrace, "meditate", [miss("2026-11-24"), miss("2026-11-25"), miss("2026-11-26")]), "mind-101", {});
    expect(goal(day(start, full("meditate")).state, "mind-101").status).toBe("locked_in");
  });

  it("milestone goals never go at risk from the daily miss pattern", () => {
    // deep-work serves work-201 in the sample; point a habit at the locked-in milestone work-101 instead.
    const habits = noGrace.habits.map((h) => (h.id === "deep-work" ? { ...h, goalId: "work-101", history: [miss("2026-11-24"), miss("2026-11-25")] } : h));
    expect(goal(day({ ...noGrace, habits }, missed("deep-work")).state, "work-101").status).toBe("locked_in");
  });

  it("clean day: all full lowers risk by fullCleanDay", () => {
    const { state, events } = day(SAMPLE_STATE, full("no-impulse"));
    expect(goal(state, "money-101").risk).toBe(60 - R.risk.fullCleanDay);
    expect(events).toContainEqual({ type: "at_risk", goalId: "money-101", risk: 60 - R.risk.fullCleanDay });
  });

  it("clean day: a minimum lowers risk by minimumCleanDay", () => {
    expect(goal(day(SAMPLE_STATE, minimum("no-impulse")).state, "money-101").risk).toBe(60 - R.risk.minimumCleanDay);
  });

  it("clean day: a miss or no check-in on the goal's habits leaves risk where it is", () => {
    expect(goal(day(SAMPLE_STATE, missed("no-impulse", "stress")).state, "money-101").risk).toBe(60);
    expect(goal(day(SAMPLE_STATE, full("run")).state, "money-101").risk).toBe(60);
  });

  it("risk at 0 is safe again: the goal is locked in and risk_cleared is emitted", () => {
    const start = withGoal(SAMPLE_STATE, "money-101", { risk: R.risk.fullCleanDay });
    const { state, events } = day(start, full("no-impulse"));
    expect(goal(state, "money-101").status).toBe("locked_in");
    expect(goal(state, "money-101").risk).toBe(0);
    expect(events).toContainEqual({ type: "risk_cleared", goalId: "money-101" });
  });

  it("setback pressure: a setback adds setbackPressure risk to an at-risk goal in the area it targets", () => {
    const { state } = day(SAMPLE_STATE, missed("no-impulse", "temptation"));
    expect(goal(state, "money-101").risk).toBe(60 + R.risk.setbackPressure);
  });

  it("setback pressure: with nothing at risk there, the area's in-progress goal loses setbackLoss progress", () => {
    // fatigue targets body; body-201 is in progress at 0.4.
    const start = { ...SAMPLE_STATE, resistance: { ...SAMPLE_STATE.resistance, fatigue: { ...SAMPLE_STATE.resistance.fatigue, strength: 5 } } };
    const { state, events } = day(start, missed("run", "fatigue"));
    expect(goal(state, "body-201").progress).toBeCloseTo(0.4 - R.progress.setbackLoss);
    expect(events).toContainEqual({ type: "progress", goalId: "body-201", from: 0.4, to: goal(state, "body-201").progress });
  });

  it("lost ground: at 100 risk the goal is lost, restarts from lostRestartProgress and emits ground_lost", () => {
    const start = withGoal(SAMPLE_STATE, "money-101", { risk: 100 - R.risk.setbackPressure });
    const { state, events } = day(start, missed("no-impulse", "temptation"));
    const g = goal(state, "money-101");
    expect(g.status).toBe("lost");
    expect(g.progress).toBe(R.risk.lostRestartProgress);
    expect(g.risk).toBe(0);
    expect(events).toContainEqual({ type: "ground_lost", goalId: "money-101" });
  });

  it("lost ground is won back with check-ins from lostRestartProgress", () => {
    const start = withGoal(SAMPLE_STATE, "mind-101", { status: "lost", progress: R.risk.lostRestartProgress, risk: 0 });
    const { state } = day(start, full("meditate"));
    expect(goal(state, "mind-101").progress).toBeCloseTo(R.risk.lostRestartProgress + R.progress.perFull);
  });

  it("frozen goals do not move on risk", () => {
    const start = withGoal(SAMPLE_STATE, "money-101", { frozen: true });
    expect(goal(day(start, full("no-impulse")).state, "money-101").risk).toBe(60);
  });
});

describe("quarterlyCheck", () => {
  it("quarterly check failed: a locked-in milestone goes at risk at onTrigger", () => {
    const { state, events } = quarterlyCheck(SAMPLE_STATE, "work-101", false, DATE);
    expect(goal(state, "work-101").status).toBe("at_risk");
    expect(goal(state, "work-101").risk).toBe(R.risk.onTrigger);
    expect(events).toEqual([{ type: "at_risk", goalId: "work-101", risk: R.risk.onTrigger }]);
  });

  it("quarterly check passed: records lastQuarterlyCheck", () => {
    const { state, events } = quarterlyCheck(SAMPLE_STATE, "work-101", true, DATE);
    expect(goal(state, "work-101").lastQuarterlyCheck).toBe(DATE);
    expect(goal(state, "work-101").status).toBe("locked_in");
    expect(events).toEqual([]);
  });

  it("quarterly check passed on an at-risk milestone takes it off the board", () => {
    const { state, events } = quarterlyCheck(SAMPLE_STATE, "money-101", true, DATE);
    expect(goal(state, "money-101").status).toBe("locked_in");
    expect(events).toEqual([{ type: "risk_cleared", goalId: "money-101" }]);
  });

  it("quarterly check does nothing to system goals, goals not locked in, or unknown goals", () => {
    for (const id of ["mind-101", "body-201", "nope"]) {
      const { state, events } = quarterlyCheck(SAMPLE_STATE, id, false, DATE);
      expect(state).toBe(SAMPLE_STATE);
      expect(events).toEqual([]);
    }
  });

  it("is wired into the engine with its config", () => {
    const config = { ...R, risk: { ...R.risk, onTrigger: 40 } };
    expect(goal(createEngine(config).quarterlyCheck(SAMPLE_STATE, "work-101", false, DATE).state, "work-101").risk).toBe(40);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(SAMPLE_STATE);
    const before = structuredClone(input);
    quarterlyCheck(input, "work-101", false, DATE);
    day(withGoal(input, "money-101", { risk: 95 }), missed("no-impulse", "temptation"), full("meditate"));
    expect(input).toEqual(before);
  });
});
