import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type Goal, type HabitDay, type JournalEntry } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeWeek, createEngine, quarterlyCheck, startLifeEvent, toWorldView, verifyAchievement } from "../src/index";

// Sample: Level 201. Body and Work in Focus. body-201 milestone in progress 0.4; people-101 system in progress 0.5;
// work-101 locked-in milestone; money-101 milestone at risk 60; temptation at 5, targets money.
const DATE = "2026-11-27";
const SUNDAY = "2026-11-29";
const moved = { body: true, mind: true, work: true, people: true, money: true };
const set = (state: GameState, patches: Record<string, Partial<Goal>>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (patches[g.id] ? { ...g, ...patches[g.id] } : g)),
});
const withHistory = (state: GameState, habitId: string, history: HabitDay[]): GameState => ({
  ...state,
  habits: state.habits.map((h) => (h.id === habitId ? { ...h, history } : h)),
});
const full = (n: number): HabitDay[] => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${23 + i}`, result: "full" as const }));
const kinds = (state: GameState) => (state.journal ?? []).map((e) => e.kind);

describe("Journal", () => {
  it("locked_in: a lock-in is journalled with its area, goal and a coach-voice label", () => {
    const start = withHistory({ ...set(SAMPLE_STATE, { "people-101": { progress: 1 - 1 / R.progress.weeksToLockIn[1] } }), weekProgress: moved }, "reach-out", full(2));
    const { state } = closeWeek(start, SUNDAY);
    expect(state.journal).toContainEqual({ date: SUNDAY, kind: "locked_in", area: "people", goalId: "people-101", label: "People 101 locked in: Host dinner 6 times." });
  });

  it("ready_to_verify, verified and level_up are journalled", () => {
    const verifyAt = R.progress.milestoneVerifyAt;
    const ready = withHistory({ ...set(SAMPLE_STATE, { "body-201": { progress: verifyAt - 0.01 } }), weekProgress: moved }, "run", full(4));
    const week = closeWeek(ready, SUNDAY).state;
    expect(week.journal).toContainEqual({ date: SUNDAY, kind: "ready_to_verify", area: "body", goalId: "body-201", label: "Run a 10K is ready to verify." });
    const ring = set(week, Object.fromEntries(["mind-201", "work-201", "money-201"].map((id) => [id, { status: "locked_in" as const, progress: 1 }])));
    const { state } = verifyAchievement(ring, "body-201", "2026-11-30", "58:12");
    const added = state.journal!.slice(week.journal!.length);
    expect(added.map((e) => e.kind)).toEqual(["verified", "locked_in", "level_up"]);
    expect(added[0]!.label).toBe("Verified: Run a 10K (58:12).");
    expect(added[2]).toEqual({ date: "2026-11-30", kind: "level_up", label: "Reached 301 · Mastery." });
  });

  it("level names: the player's own name is used in level entries", () => {
    const named = { ...SAMPLE_STATE, levelNames: { 1: "Base camp" } };
    const { state } = closeDay(set(named, { "money-101": { risk: 100 - R.risk.setbackPressure } }), { date: DATE, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] });
    expect(state.journal!.find((e) => e.kind === "level_lost")!.label).toBe("Back to 101 · Base camp. Retake the ground to climb again.");
  });

  it("setback, ground_lost and level_lost are journalled from a closeDay", () => {
    const start = set(SAMPLE_STATE, { "money-101": { risk: 100 - R.risk.setbackPressure } });
    const { state } = closeDay(start, { date: DATE, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] });
    expect(kinds(state)).toEqual(["setback", "ground_lost", "level_lost"]);
    expect(state.journal![0]).toEqual({ date: DATE, kind: "setback", area: "money", label: `Temptation setback: −${R.health.setbackDamage} health.` });
    expect(state.journal![1]).toMatchObject({ area: "money", goalId: "money-101", label: "Money 101 lost ground. Win it back from 50%." });
  });

  it("at_risk is journalled when a goal goes at risk, not each time its meter moves", () => {
    const failed = quarterlyCheck(SAMPLE_STATE, "work-101", false, DATE).state;
    expect(failed.journal).toEqual([{ date: DATE, kind: "at_risk", area: "work", goalId: "work-101", label: `Work 101 at ${R.risk.onTrigger}% risk.` }]);
    // A clean day moves money-101's meter from 60 down: no journal entry.
    const clean = closeDay(SAMPLE_STATE, { date: DATE, entries: [{ habitId: "no-impulse", result: "full" }] });
    expect(clean.events.some((e) => e.type === "at_risk")).toBe(true);
    expect(clean.state.journal ?? []).toEqual([]);
  });

  it("risk_cleared is journalled", () => {
    const { state } = quarterlyCheck(SAMPLE_STATE, "money-101", true, DATE);
    expect(state.journal).toEqual([{ date: DATE, kind: "risk_cleared", area: "money", goalId: "money-101", label: "Money 101 is safe again." }]);
  });

  it("recovery_started and recovery_ended are journalled", () => {
    const on = startLifeEvent(SAMPLE_STATE, DATE).state;
    expect(on.journal).toEqual([{ date: DATE, kind: "recovery_started", label: `Life event logged. Recovery on: ${R.recovery.days} days, one habit.` }]);
    const last = { ...on, recovery: { ...on.recovery!, daysDone: R.recovery.daysNeeded - 1 } };
    const done = closeDay(last, { date: "2026-11-28", entries: [{ habitId: "run", result: "minimum" }] }).state;
    expect(done.journal!.at(-1)).toEqual({ date: "2026-11-28", kind: "recovery_ended", label: `Recovery done. Health back to at least ${R.recovery.restoreHealth}.` });
  });

  it("the journal is kept oldest first and trimmed to journal.maxEntries", () => {
    const old: JournalEntry[] = [
      { date: "2026-11-01", kind: "level_up", label: "a" },
      { date: "2026-11-02", kind: "level_up", label: "b" },
    ];
    const config = { ...R, journal: { maxEntries: 2 } };
    const { state } = quarterlyCheck({ ...SAMPLE_STATE, journal: old }, "work-101", false, DATE, config);
    expect(state.journal!.map((e) => e.label)).toEqual(["b", `Work 101 at ${R.risk.onTrigger}% risk.`]);
  });

  it("a step with nothing notable leaves the journal as it was", () => {
    const { state } = closeDay(SAMPLE_STATE, { date: DATE, entries: [{ habitId: "run", result: "full" }] });
    expect(state.journal).toBeUndefined();
  });

  it("is wired into the engine, and does not mutate its input", () => {
    const input = structuredClone({ ...SAMPLE_STATE, journal: [{ date: "2026-11-01", kind: "level_up" as const, label: "a" }] });
    const before = structuredClone(input);
    const r = createEngine().closeDay(input, { date: DATE, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] });
    expect(kinds(r.state)).toEqual(["level_up", "setback"]);
    expect(input).toEqual(before);
  });
});

describe("toWorldView: level names and the trail", () => {
  it("levelNames: the player's names over the defaults", () => {
    expect(toWorldView(SAMPLE_STATE).levelNames).toEqual({ 1: "Foundations", 2: "Momentum", 3: "Mastery", 4: "Legacy", 5: "The Vision" });
    expect(toWorldView({ ...SAMPLE_STATE, levelNames: { 5: "Strong at 84" } }).levelNames![5]).toBe("Strong at 84");
  });

  it("trail: the Focus area whose lowest in-progress goal is lowest, with its four stops and its moments", () => {
    // Body (Focus) has body-201 in progress; Work (Focus) has nothing in progress.
    const journal: JournalEntry[] = [
      { date: "2026-11-20", kind: "setback", area: "body", label: "Fatigue setback: −7 health." },
      { date: "2026-11-21", kind: "setback", area: "money", label: "Temptation setback: −7 health." },
    ];
    const trail = toWorldView({ ...SAMPLE_STATE, journal }).trail!;
    expect(trail.area).toBe("body");
    expect(trail.stops.map((s) => s.goalId)).toEqual(["body-101", "body-201", "body-301", "body-401"]);
    expect(trail.stops[1]).toEqual({ goalId: "body-201", level: 2, title: "Run a 10K", status: "in_progress", progress: 0.4, frozen: false });
    expect(trail.stops[2]!.frozen).toBe(true);
    expect(trail.moments).toEqual([journal[0]]);
  });

  it("trail: a lower in-progress goal wins; ties go to AREAS order; no Focus area in progress falls back to body", () => {
    const peopleFocus = { ...SAMPLE_STATE, modes: { ...SAMPLE_STATE.modes, people: "focus" as const } }; // people-101 in progress
    expect(toWorldView(peopleFocus).trail!.area).toBe("people");
    const tie = set(SAMPLE_STATE, { "work-201": { status: "in_progress", progress: 0.1 } });
    expect(toWorldView(tie).trail!.area).toBe("body");
    const workOnly = { ...set(SAMPLE_STATE, { "work-201": { status: "in_progress", progress: 0.1 } }), modes: { ...SAMPLE_STATE.modes, body: "maintain" as const } };
    expect(toWorldView(workOnly).trail!.area).toBe("work");
    const none = { ...SAMPLE_STATE, modes: { body: "maintain" as const, mind: "maintain" as const, work: "rest" as const, people: "maintain" as const, money: "maintain" as const } };
    expect(toWorldView(none).trail!.area).toBe("body");
  });
});
