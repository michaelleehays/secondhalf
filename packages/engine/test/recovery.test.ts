import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState, type Goal, type RecoveryState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeWeek, createEngine, recoveryHabit, startLifeEvent } from "../src/index";

const DATE = "2026-11-27";
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string, reason: CheckInEntry["reason"] = "fatigue"): CheckInEntry => ({ habitId, result: "missed", reason });
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const set = (state: GameState, patches: Record<string, Partial<Goal>>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (patches[g.id] ? { ...g, ...patches[g.id] } : g)),
});
const withHealth = (health: number, graceDaysLeft = SAMPLE_STATE.character.graceDaysLeft): GameState => ({
  ...SAMPLE_STATE,
  character: { ...SAMPLE_STATE.character, health, graceDaysLeft },
});
const recovering = (patch: Partial<RecoveryState> = {}, state: GameState = SAMPLE_STATE): GameState => ({
  ...state,
  recovery: { cause: "life_event", startedOn: "2026-11-26", day: 1, daysDone: 0, habitTitle: "Meditate: Three slow breaths", ...patch },
  season: { ...state.season, lifeEventPauseUsed: true },
});

describe("Recovery mode", () => {
  it("auto trigger: health below recovery.healthBelow starts Recovery at the end of closeDay", () => {
    const { state, events } = closeDay(withHealth(R.recovery.healthBelow + 2, 0), { date: DATE, entries: [missed("run")] });
    expect(state.character.health).toBeLessThan(R.recovery.healthBelow);
    expect(state.recovery).toEqual({ cause: "auto", startedOn: DATE, day: 1, daysDone: 0, habitTitle: expect.any(String) });
    expect(state.season.autoRecoveryUsed).toBe(true);
    expect(events.at(-1)).toEqual({ type: "recovery_started", cause: "auto" });
  });

  it("auto trigger: recovery.atRiskGoals or more goals at risk start Recovery", () => {
    // The sample already has money-101 at risk; put a second goal at risk.
    const start = set(SAMPLE_STATE, { "mind-101": { status: "at_risk", risk: 25 } });
    const { state, events } = closeDay(start, { date: DATE, entries: [] });
    expect(state.recovery?.cause).toBe("auto");
    expect(events).toContainEqual({ type: "recovery_started", cause: "auto" });
  });

  it("auto trigger: at most once per season", () => {
    const used = { ...withHealth(10), season: { ...SAMPLE_STATE.season, autoRecoveryUsed: true } };
    const { state, events } = closeDay(used, { date: DATE, entries: [] });
    expect(state.recovery).toBeNull();
    expect(events.some((e) => e.type === "recovery_started")).toBe(false);
  });

  it("auto trigger: also runs at the end of closeWeek", () => {
    const { state } = closeWeek(withHealth(10), "2026-11-29");
    expect(state.recovery?.cause).toBe("auto");
    expect(state.recovery?.startedOn).toBe("2026-11-29");
  });

  it("life event: startLifeEvent starts Recovery once per season", () => {
    const { state, events } = startLifeEvent(SAMPLE_STATE, DATE);
    expect(state.recovery?.cause).toBe("life_event");
    expect(state.season.lifeEventPauseUsed).toBe(true);
    expect(events).toEqual([{ type: "recovery_started", cause: "life_event" }]);
    const again = startLifeEvent({ ...state, recovery: null }, "2026-12-10");
    expect(again.state.recovery).toBeNull();
    expect(again.events).toEqual([]);
  });

  it("life event: does nothing while Recovery is already on", () => {
    const on = { ...recovering({ cause: "auto" }), season: SAMPLE_STATE.season };
    const { state, events } = startLifeEvent(on, DATE);
    expect(state).toBe(on);
    expect(events).toEqual([]);
  });

  it("the recovery habit is the active habit done most often, at its minimum dose", () => {
    const habits = SAMPLE_STATE.habits.map((h) =>
      h.id === "reach-out" ? { ...h, history: [{ date: "2026-11-25", result: "minimum" as const }] } : h,
    );
    expect(recoveryHabit({ ...SAMPLE_STATE, habits })?.id).toBe("reach-out");
    expect(startLifeEvent({ ...SAMPLE_STATE, habits }, DATE).state.recovery?.habitTitle).toBe("Reach out to a friend: Send one message");
    const resting = { ...SAMPLE_STATE, habits, modes: { ...SAMPLE_STATE.modes, people: "rest" as const } };
    expect(recoveryHabit(resting)?.id).toBe("run");
  });

  it("in Recovery a done or minimum entry on any habit counts as the recovery day, and only one habit scores", () => {
    const { state, events } = closeDay(recovering(), { date: DATE, entries: [minimum("reach-out"), full("run"), full("meditate")] });
    expect(state.recovery).toMatchObject({ day: 2, daysDone: 1 });
    const points = events.filter((e) => e.type === "points");
    expect(points).toEqual([{ type: "points", score: 19, credits: 10, reason: "habit", sourceId: "run" }]);
    expect(state.score).toBe(SAMPLE_STATE.score + 19);
  });

  it("in Recovery misses cost nothing: no health, grace, Resistance, setback or risk changes", () => {
    const start = recovering({}, withHealth(30, 1));
    const { state, events } = closeDay(start, { date: DATE, entries: [missed("no-impulse", "temptation"), missed("run")] });
    expect(state.character).toEqual(start.character);
    expect(state.resistance).toEqual(start.resistance);
    expect(goal(state, "money-101")).toEqual(goal(start, "money-101"));
    expect(events).toEqual([]);
    expect(state.recovery).toMatchObject({ day: 2, daysDone: 0 });
  });

  it("in Recovery goal progress and at-risk meters are frozen", () => {
    const { state } = closeDay(recovering(), { date: DATE, entries: [full("run"), full("no-impulse")] });
    expect(goal(state, "body-201").progress).toBe(0.4);
    expect(goal(state, "money-101").risk).toBe(60);
  });

  it("Recovery misses are recorded as covered, so they never count toward the at-risk pattern later", () => {
    const { state } = closeDay(recovering(), { date: DATE, entries: [missed("meditate")] });
    expect(state.habits.find((h) => h.id === "meditate")!.history.at(-1)).toMatchObject({ result: "missed", graced: true });
  });

  it("daysNeeded done within recovery.days ends Recovery and restores health to restoreHealth", () => {
    let state = recovering({}, withHealth(12));
    const events = [];
    for (let i = 0; i < R.recovery.daysNeeded; i++) {
      const r = closeDay(state, { date: addDays(DATE, i), entries: [minimum("meditate")] });
      state = r.state;
      events.push(...r.events);
    }
    expect(state.recovery).toBeNull();
    expect(state.character.health).toBe(R.recovery.restoreHealth);
    expect(events).toContainEqual({ type: "health_changed", delta: R.recovery.restoreHealth - 12, reason: "recovery" });
    expect(events.at(-1)).toEqual({ type: "recovery_ended", completed: true });
  });

  it("finishing Recovery never lowers health above restoreHealth", () => {
    const { state } = closeDay(recovering({ daysDone: R.recovery.daysNeeded - 1 }, withHealth(70)), { date: DATE, entries: [full("run")] });
    expect(state.character.health).toBe(70);
    expect(state.recovery).toBeNull();
  });

  it("running past recovery.days without enough days done ends Recovery without the boost", () => {
    const start = recovering({ day: R.recovery.days, daysDone: R.recovery.daysNeeded - 2 }, withHealth(20));
    const { state, events } = closeDay(start, { date: DATE, entries: [full("run")] });
    expect(state.recovery).toBeNull();
    expect(state.character.health).toBe(20);
    expect(events.at(-1)).toEqual({ type: "recovery_ended", completed: false });
  });

  it("in Recovery closeWeek freezes idle penalties and risk escalation but still pays dividends", () => {
    const start = recovering({}, {
      ...SAMPLE_STATE,
      habits: SAMPLE_STATE.habits.map((h) => (h.id === "no-impulse" ? { ...h, history: [{ date: "2026-11-25", result: "missed" as const }] } : h)),
    });
    const { state, events } = closeWeek(start, "2026-11-29");
    expect(state.character.strength).toBe(SAMPLE_STATE.character.strength);
    expect(goal(state, "body-201").progress).toBe(0.4);
    expect(state.resistance).toEqual(start.resistance);
    expect(goal(state, "money-101").risk).toBe(60);
    expect(events.some((e) => e.type === "points" && e.reason === "dividend")).toBe(true);
  });

  it("knocked down: reaching health.knockedDownAt emits knocked_down", () => {
    const { events } = closeDay(withHealth(R.health.knockedDownAt + R.health.missCost - 1, 0), { date: DATE, entries: [missed("run")] });
    expect(events).toContainEqual({ type: "knocked_down" });
    expect(closeDay(withHealth(R.health.knockedDownAt + R.health.missCost + 1, 0), { date: DATE, entries: [missed("run")] }).events).not.toContainEqual({ type: "knocked_down" });
  });

  it("is wired into the engine", () => {
    expect(createEngine().startLifeEvent(SAMPLE_STATE, DATE).state.recovery?.cause).toBe("life_event");
  });

  it("does not mutate its input", () => {
    const input = structuredClone(recovering());
    const before = structuredClone(input);
    closeDay(input, { date: DATE, entries: [full("run"), missed("meditate")] });
    closeWeek(input, "2026-11-29");
    startLifeEvent(structuredClone(SAMPLE_STATE), DATE);
    expect(input).toEqual(before);
  });
});
