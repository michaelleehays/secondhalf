import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type Habit, type PlanEdit } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { applyPlanEdit, createEngine } from "../src/index";

// Sample goals: body-201 milestone in progress 0.4; people-101 system in progress 0.5; body-101 locked in;
// money-101 at risk; body-301 hidden. Habits: run -> body-201 (with history in some tests), meditate -> mind-101.
const DATE = "2026-11-27";
const edit = (state: GameState, e: PlanEdit) => applyPlanEdit(state, e, DATE);
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const habit = (state: GameState, id: string) => state.habits.find((h) => h.id === id);
const rejected = (r: ReturnType<typeof edit>, state: GameState, kind: PlanEdit["kind"]) => {
  expect(r.state).toBe(state);
  expect(r.events).toHaveLength(1);
  expect(r.events[0]).toMatchObject({ type: "plan_rejected", edit: kind, reason: expect.any(String) });
  return (r.events[0] as { reason: string }).reason;
};
const newHabit = (patch: Partial<Omit<Habit, "history">> = {}): Omit<Habit, "history"> => ({
  id: "stretch", goalId: "body-201", area: "body", title: "Stretch", fullDose: "15 minutes", minimumDose: "One stretch",
  weeklyTarget: { focus: 5, maintain: 3, rest: 0 }, maintenance: false, ...patch,
});

describe("applyPlanEdit", () => {
  it("rename_level: sets the level's name, 1 to 40 characters", () => {
    const { state, events } = edit(SAMPLE_STATE, { kind: "rename_level", level: 2, name: "  Getting serious " });
    expect(state.levelNames).toEqual({ 2: "Getting serious" });
    expect(events).toEqual([]);
    rejected(edit(SAMPLE_STATE, { kind: "rename_level", level: 2, name: "  " }), SAMPLE_STATE, "rename_level");
    rejected(edit(SAMPLE_STATE, { kind: "rename_level", level: 2, name: "x".repeat(41) }), SAMPLE_STATE, "rename_level");
    expect(edit(SAMPLE_STATE, { kind: "rename_level", level: 5, name: "x".repeat(40) }).events).toEqual([]);
  });

  it("set_goal: title (1 to 80) and verification can change at any status", () => {
    const { state } = edit(SAMPLE_STATE, { kind: "set_goal", goalId: "body-101", title: "Run a 5K under 30", verification: "Timed 5K, chip time" });
    expect(goal(state, "body-101")).toMatchObject({ title: "Run a 5K under 30", verification: "Timed 5K, chip time", status: "locked_in" });
    rejected(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "body-101", title: "" }), SAMPLE_STATE, "set_goal");
    rejected(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "body-101", title: "x".repeat(81) }), SAMPLE_STATE, "set_goal");
    const cleared = edit(state, { kind: "set_goal", goalId: "body-101", verification: "" }).state;
    expect("verification" in goal(cleared, "body-101")).toBe(false);
  });

  it("set_goal: the kind can change while hidden, open or in progress", () => {
    expect(goal(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "body-301", goalKind: "system" }).state, "body-301").kind).toBe("system");
    expect(goal(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "people-101", goalKind: "milestone" }).state, "people-101").kind).toBe("milestone");
  });

  it("set_goal: becoming a milestone caps progress at milestoneVerifyAt", () => {
    const far = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((g) => (g.id === "people-101" ? { ...g, progress: 0.95 } : g)) };
    const { state } = edit(far, { kind: "set_goal", goalId: "people-101", goalKind: "milestone" });
    expect(goal(state, "people-101").progress).toBe(R.progress.milestoneVerifyAt);
  });

  it("set_goal: the kind can't change once the goal is locked in, at risk or lost", () => {
    const lost = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((g) => (g.id === "people-101" ? { ...g, status: "lost" as const } : g)) };
    for (const [state, id] of [[SAMPLE_STATE, "body-101"], [SAMPLE_STATE, "money-101"], [lost, "people-101"]] as const) {
      const other = goal(state, id).kind === "system" ? "milestone" : "system";
      const reason = rejected(edit(state, { kind: "set_goal", goalId: id, goalKind: other }), state, "set_goal");
      expect(reason).toBe("That goal's already been earned as it stands.");
    }
    // Setting the same kind is not a change.
    expect(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "body-101", goalKind: "milestone" }).events).toEqual([]);
  });

  it("set_goal: an unknown goal is rejected", () => {
    rejected(edit(SAMPLE_STATE, { kind: "set_goal", goalId: "nope", title: "x" }), SAMPLE_STATE, "set_goal");
  });

  it("add_habit: adds the habit with empty history", () => {
    const { state, events } = edit(SAMPLE_STATE, { kind: "add_habit", habit: newHabit() });
    expect(habit(state, "stretch")).toEqual({ ...newHabit(), history: [] });
    expect(events).toEqual([]);
  });

  it("add_habit: needs an existing goal in its area, a unique id, names of 1 to 80 and weekly targets of 0 to 7", () => {
    const bad: Partial<Omit<Habit, "history">>[] = [
      { goalId: "nope" },
      { goalId: "mind-201" },
      { id: "run" },
      { title: "" },
      { title: "x".repeat(81) },
      { minimumDose: " " },
      { weeklyTarget: { focus: 8, maintain: 3, rest: 0 } },
      { weeklyTarget: { focus: -1, maintain: 3, rest: 0 } },
      { weeklyTarget: { focus: 2.5, maintain: 3, rest: 0 } },
    ];
    for (const patch of bad) rejected(edit(SAMPLE_STATE, { kind: "add_habit", habit: newHabit(patch) }), SAMPLE_STATE, "add_habit");
    expect(edit(SAMPLE_STATE, { kind: "add_habit", habit: newHabit({ weeklyTarget: { focus: 7, maintain: 0, rest: 0 } }) }).events).toEqual([]);
  });

  it("update_habit: changes what's given, may move the habit to another goal, and keeps its history", () => {
    const history = [{ date: "2026-11-26", result: "full" as const }];
    const start = { ...SAMPLE_STATE, habits: SAMPLE_STATE.habits.map((h) => (h.id === "run" ? { ...h, history } : h)) };
    const { state, events } = edit(start, { kind: "update_habit", habitId: "run", title: "Easy run", goalId: "body-301", weeklyTarget: { focus: 3, maintain: 2, rest: 0 } });
    expect(habit(state, "run")).toMatchObject({ title: "Easy run", goalId: "body-301", weeklyTarget: { focus: 3, maintain: 2, rest: 0 }, fullDose: "25 minutes", history });
    expect(events).toEqual([]);
  });

  it("update_habit: unknown habits, unknown goals, goals in another area and bad values are rejected", () => {
    rejected(edit(SAMPLE_STATE, { kind: "update_habit", habitId: "nope", title: "x" }), SAMPLE_STATE, "update_habit");
    rejected(edit(SAMPLE_STATE, { kind: "update_habit", habitId: "run", goalId: "nope" }), SAMPLE_STATE, "update_habit");
    rejected(edit(SAMPLE_STATE, { kind: "update_habit", habitId: "run", goalId: "mind-201" }), SAMPLE_STATE, "update_habit");
    rejected(edit(SAMPLE_STATE, { kind: "update_habit", habitId: "run", fullDose: "" }), SAMPLE_STATE, "update_habit");
    rejected(edit(SAMPLE_STATE, { kind: "update_habit", habitId: "run", weeklyTarget: { focus: 9, maintain: 0, rest: 0 } }), SAMPLE_STATE, "update_habit");
  });

  it("retire_habit: removes the habit from state.habits; an unknown habit is rejected", () => {
    const { state, events } = edit(SAMPLE_STATE, { kind: "retire_habit", habitId: "run" });
    expect(habit(state, "run")).toBeUndefined();
    expect(state.habits).toHaveLength(SAMPLE_STATE.habits.length - 1);
    expect(events).toEqual([]);
    rejected(edit(SAMPLE_STATE, { kind: "retire_habit", habitId: "nope" }), SAMPLE_STATE, "retire_habit");
  });

  it("rejection reasons are in coach voice: plain, specific, no shaming", () => {
    const reasons = [
      rejected(edit(SAMPLE_STATE, { kind: "rename_level", level: 1, name: "" }), SAMPLE_STATE, "rename_level"),
      rejected(edit(SAMPLE_STATE, { kind: "add_habit", habit: newHabit({ id: "run" }) }), SAMPLE_STATE, "add_habit"),
      rejected(edit(SAMPLE_STATE, { kind: "retire_habit", habitId: "nope" }), SAMPLE_STATE, "retire_habit"),
    ];
    for (const r of reasons) {
      expect(r).toMatch(/\.$/);
      expect(r).not.toMatch(/invalid|error|fail|must|cannot/i);
    }
  });

  it("is wired into the engine, and does not mutate its input", () => {
    const input = structuredClone(SAMPLE_STATE);
    const before = structuredClone(input);
    createEngine().applyPlanEdit(input, { kind: "rename_level", level: 1, name: "Base camp" }, DATE);
    createEngine().applyPlanEdit(input, { kind: "set_goal", goalId: "people-101", goalKind: "milestone", title: "Dinners" }, DATE);
    createEngine().applyPlanEdit(input, { kind: "update_habit", habitId: "run", title: "Jog" }, DATE);
    createEngine().applyPlanEdit(input, { kind: "retire_habit", habitId: "run" }, DATE);
    expect(input).toEqual(before);
  });
});
