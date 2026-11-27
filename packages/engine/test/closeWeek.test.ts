import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type Goal, type HabitDay } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeWeek, createEngine } from "../src/index";

// Sample: Level 201 (x1.25), today 2026-11-26, weekProgress empty, every habit history empty.
// body/work Focus, mind/people/money Maintain. body-201 in progress 0.4, mind-201 0.2.
// Locked in: body-101, work-101 (milestones), mind-101 (system, habit meditate). money-101 milestone at risk 60.
const SUNDAY = "2026-11-29";
const allMoved: GameState["weekProgress"] = { body: true, mind: true, work: true, people: true, money: true };
const moved = { ...SAMPLE_STATE, weekProgress: allMoved };
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const set = (state: GameState, patches: Record<string, Partial<Goal>>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (patches[g.id] ? { ...g, ...patches[g.id] } : g)),
});
const withHistory = (state: GameState, habitId: string, history: HabitDay[]): GameState => ({
  ...state,
  habits: state.habits.map((h) => (h.id === habitId ? { ...h, history } : h)),
});
const dividends = (events: ReturnType<typeof closeWeek>["events"]) =>
  Object.fromEntries(events.flatMap((e) => (e.type === "points" && e.reason === "dividend" ? [[e.sourceId, e.score]] : [])));

describe("closeWeek", () => {
  it("idle area costs strength.idleWeekCost strength, per idle area", () => {
    const oneIdle = { ...SAMPLE_STATE, weekProgress: { ...allMoved, people: false } };
    expect(closeWeek(oneIdle, SUNDAY).state.character.strength).toBe(SAMPLE_STATE.character.strength - R.strength.idleWeekCost);
    const { state, events } = closeWeek(SAMPLE_STATE, SUNDAY);
    expect(state.character.strength).toBe(SAMPLE_STATE.character.strength - 5 * R.strength.idleWeekCost);
    expect(events).toContainEqual({ type: "strength_changed", delta: -5 * R.strength.idleWeekCost });
  });

  it("idle area: its in-progress goal on the current level loses progress.idleWeekDecay", () => {
    const { state, events } = closeWeek(SAMPLE_STATE, SUNDAY);
    expect(goal(state, "body-201").progress).toBeCloseTo(0.4 - R.progress.idleWeekDecay);
    expect(goal(state, "mind-201").progress).toBeCloseTo(0.2 - R.progress.idleWeekDecay);
    expect(goal(state, "people-101").progress).toBe(0.5); // ring below the current level is not decayed
    expect(events).toContainEqual({ type: "progress", goalId: "body-201", from: 0.4, to: goal(state, "body-201").progress });
  });

  it("idle area: the Resistance targeting it gains 1, capped at resistance.max", () => {
    const { state, events } = closeWeek(SAMPLE_STATE, SUNDAY);
    expect(state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength + 1);
    expect(state.resistance.temptation.strength).toBe(R.resistance.max);
    expect(events).toContainEqual({ type: "resistance_changed", id: "fatigue", strength: 3 });
    expect(events.some((e) => e.type === "resistance_changed" && e.id === "temptation")).toBe(false);
  });

  it("areas that moved this week, or in Rest mode, are not idle", () => {
    const { state } = closeWeek(moved, SUNDAY);
    expect(state.character.strength).toBe(SAMPLE_STATE.character.strength);
    expect(goal(state, "body-201").progress).toBe(0.4);
    const resting = { ...moved, modes: { ...moved.modes, people: "rest" as const }, weekProgress: { ...allMoved, people: false } };
    expect(closeWeek(resting, SUNDAY).state.resistance.avoidance.strength).toBe(SAMPLE_STATE.resistance.avoidance.strength);
  });

  it("dividends: a locked-in milestone pays dividendPerLevel x goal level x level multiplier", () => {
    const d = dividends(closeWeek(moved, SUNDAY).events);
    expect(d["body-101"]).toBe(19); // 15 x 1 x 1.25 = 18.75
    expect(d["work-101"]).toBe(19);
  });

  it("dividends: an at-risk milestone pays only its vested share", () => {
    expect(dividends(closeWeek(moved, SUNDAY).events)["money-101"]).toBe(9); // 18.75 x 0.5 = 9.375
  });

  it("dividends: a system goal pays in full only if its habits made progress that week", () => {
    expect(dividends(closeWeek(moved, SUNDAY).events)["mind-101"]).toBeUndefined();
    const meditated = withHistory(moved, "meditate", [{ date: "2026-11-24", result: "minimum" }]);
    expect(dividends(closeWeek(meditated, SUNDAY).events)["mind-101"]).toBe(19);
    const lastWeek = withHistory(moved, "meditate", [{ date: "2026-11-22", result: "full" }]);
    expect(dividends(closeWeek(lastWeek, SUNDAY).events)["mind-101"]).toBeUndefined();
  });

  it("dividends: frozen, lost and not-yet-locked goals pay nothing; dividends add to score, not credits", () => {
    const start = set(moved, { "body-101": { frozen: true }, "work-101": { status: "lost", progress: 0.5 } });
    const { state, events } = closeWeek(start, SUNDAY);
    const d = dividends(events);
    expect(Object.keys(d)).toEqual(["money-101"]);
    expect(state.score).toBe(SAMPLE_STATE.score + 9);
    expect(state.credits).toBe(SAMPLE_STATE.credits);
    expect(events).toContainEqual({ type: "points", score: 9, credits: 0, reason: "dividend", sourceId: "money-101" });
  });

  it("risk escalation: an at-risk goal whose habits missed beyond grace that week gains risk.perBadWeek", () => {
    const start = withHistory(moved, "no-impulse", [{ date: "2026-11-25", result: "missed", reason: "temptation" }]);
    const { state, events } = closeWeek(start, SUNDAY);
    expect(goal(state, "money-101").risk).toBe(60 + R.risk.perBadWeek);
    expect(events).toContainEqual({ type: "at_risk", goalId: "money-101", risk: 60 + R.risk.perBadWeek });
  });

  it("risk escalation: graced misses and clean weeks do not raise risk", () => {
    const graced = withHistory(moved, "no-impulse", [{ date: "2026-11-25", result: "missed", graced: true }]);
    expect(goal(closeWeek(graced, SUNDAY).state, "money-101").risk).toBe(60);
    expect(goal(closeWeek(moved, SUNDAY).state, "money-101").risk).toBe(60);
  });

  it("risk escalation to 100 is lost ground, and the level check runs after it", () => {
    const start = withHistory(set(moved, { "money-101": { risk: 100 - R.risk.perBadWeek } }), "no-impulse", [
      { date: "2026-11-25", result: "missed", reason: "temptation" },
    ]);
    const { state, events } = closeWeek(start, SUNDAY);
    expect(goal(state, "money-101").status).toBe("lost");
    expect(goal(state, "money-101").progress).toBe(R.risk.lostRestartProgress);
    expect(events).toContainEqual({ type: "ground_lost", goalId: "money-101" });
    expect(state.level).toBe(1);
    expect(events).toContainEqual({ type: "level_lost", level: 1 });
  });

  it("grace refills to grace.perMonth when the week ends in a new month", () => {
    const empty = { ...moved, character: { ...moved.character, graceDaysLeft: 0 } };
    expect(closeWeek(empty, SUNDAY).state.character.graceDaysLeft).toBe(0);
    expect(closeWeek(empty, "2026-12-06").state.character.graceDaysLeft).toBe(R.grace.perMonth);
  });

  it("grace refill never takes away bought grace days", () => {
    const bought = { ...moved, character: { ...moved.character, graceDaysLeft: R.grace.maxHeld } };
    expect(closeWeek(bought, "2026-12-06").state.character.graceDaysLeft).toBe(R.grace.maxHeld);
  });

  it("resets weekProgress and moves today to weekEnding", () => {
    const { state } = closeWeek(moved, SUNDAY);
    expect(state.weekProgress).toEqual({});
    expect(state.today).toBe(SUNDAY);
  });

  it("is wired into the engine with its config", () => {
    const config = { ...R, strength: { ...R.strength, idleWeekCost: 1 } };
    expect(createEngine(config).closeWeek(SAMPLE_STATE, SUNDAY).state.character.strength).toBe(SAMPLE_STATE.character.strength - 5);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(withHistory(SAMPLE_STATE, "no-impulse", [{ date: "2026-11-25", result: "missed" }]));
    const before = structuredClone(input);
    closeWeek(input, "2026-12-06");
    expect(input).toEqual(before);
  });
});
