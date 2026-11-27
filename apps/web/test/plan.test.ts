import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import {
  addHabitEdit,
  emptyHabitForm,
  goalForm,
  habitForm,
  ladder,
  newHabitId,
  readyToVerify,
  rejection,
  renameLevelEdit,
  setGoalEdit,
  updateHabitEdit,
} from "../src/lib/plan";

const goal = (id: string) => SAMPLE_STATE.goals.find((g) => g.id === id)!;
const habit = (id: string) => SAMPLE_STATE.habits.find((h) => h.id === id)!;

describe("ladder", () => {
  it("runs from 501 down to 101 with five goals per ring", () => {
    const l = ladder(SAMPLE_STATE);
    expect(l.map((r) => r.code)).toEqual(["501", "401", "301", "201", "101"]);
    expect(l[0]?.goals).toEqual([]);
    expect(l[4]?.goals.map((g) => g.area)).toEqual(["body", "mind", "work", "people", "money"]);
    expect(l.find((r) => r.current)?.code).toBe("201");
    expect(l[4]?.held).toBe(3);
  });

  it("uses the player's level names", () => {
    expect(ladder({ ...SAMPLE_STATE, levelNames: { 2: "Build the engine" } })[3]?.name).toBe("Build the engine");
  });
});

describe("plan edits from forms", () => {
  it("renames a level, ignoring an unchanged name and refusing an empty one", () => {
    expect(renameLevelEdit(SAMPLE_STATE, 2, "  Engine room ")).toEqual({ ok: true, value: { kind: "rename_level", level: 2, name: "Engine room" } });
    expect(renameLevelEdit(SAMPLE_STATE, 2, "Momentum")).toEqual({ ok: true, value: null });
    expect(renameLevelEdit(SAMPLE_STATE, 2, "  ").ok).toBe(false);
  });

  it("sends only the goal fields that changed", () => {
    const g = goal("body-201");
    expect(setGoalEdit(g, { ...goalForm(g), verification: "Run a timed 10K" })).toEqual({
      ok: true,
      value: { kind: "set_goal", goalId: "body-201", verification: "Run a timed 10K" },
    });
    expect(setGoalEdit(g, goalForm(g))).toEqual({ ok: true, value: null });
    expect(setGoalEdit(g, { ...goalForm(g), title: " " }).ok).toBe(false);
  });

  it("keeps a locked-in goal's kind but lets its title change", () => {
    const g = goal("body-101");
    expect(setGoalEdit(g, { ...goalForm(g), kind: "system" })).toEqual({ ok: false, error: "A locked-in goal keeps its kind." });
    expect(setGoalEdit(g, { ...goalForm(g), title: "Run a 5K under 30" }).ok).toBe(true);
    expect(addHabitEdit(SAMPLE_STATE, g, { ...emptyHabitForm(), title: "x", fullDose: "y", minimumDose: "z" }).ok).toBe(false);
  });

  it("updates a habit's doses and weekly targets", () => {
    const h = habit("run");
    expect(updateHabitEdit(h, { ...habitForm(h), minimumDose: "10-minute jog", focus: 3 })).toEqual({
      ok: true,
      value: { kind: "update_habit", habitId: "run", minimumDose: "10-minute jog", weeklyTarget: { focus: 3, maintain: 2, rest: 0 } },
    });
    expect(updateHabitEdit(h, habitForm(h))).toEqual({ ok: true, value: null });
    expect(updateHabitEdit(h, { ...habitForm(h), focus: 8 }).ok).toBe(false);
    expect(updateHabitEdit(h, { ...habitForm(h), maintain: Number.NaN }).ok).toBe(false);
    expect(updateHabitEdit(h, { ...habitForm(h), minimumDose: "" })).toEqual({
      ok: false,
      error: "Say what the minimum is. It's what keeps a bad day from being a zero.",
    });
  });

  it("adds a habit with a fresh id on the goal's area", () => {
    const g = goal("body-201");
    const r = addHabitEdit(SAMPLE_STATE, g, { title: "Long run", fullDose: "60 minutes", minimumDose: "20 minutes", focus: 1, maintain: 1 });
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "add_habit",
        habit: {
          id: "body-201-long-run",
          goalId: "body-201",
          area: "body",
          title: "Long run",
          fullDose: "60 minutes",
          minimumDose: "20 minutes",
          weeklyTarget: { focus: 1, maintain: 1, rest: 0 },
          maintenance: false,
        },
      },
    });
  });

  it("never reuses a habit id", () => {
    const g = goal("body-201");
    const taken = { ...SAMPLE_STATE, habits: [...SAMPLE_STATE.habits, { ...habit("run"), id: "body-201-long-run" }] };
    expect(newHabitId(taken, g, "Long run!")).toBe("body-201-long-run-2");
    expect(newHabitId(SAMPLE_STATE, g, "!!!")).toBe("body-201-habit");
  });
});

describe("engine answers", () => {
  it("reads a plan_rejected reason", () => {
    expect(rejection([{ type: "plan_rejected", edit: "set_goal", reason: "A locked-in goal keeps its kind." }])).toBe("A locked-in goal keeps its kind.");
    expect(rejection([])).toBeNull();
  });

  it("offers 'I did it' only on an unverified milestone at the verify mark", () => {
    const at = DEFAULT_RULES.progress.milestoneVerifyAt;
    const g = goal("body-201");
    expect(readyToVerify({ ...g, progress: at }, at)).toBe(true);
    expect(readyToVerify({ ...g, progress: at - 0.01 }, at)).toBe(false);
    expect(readyToVerify({ ...g, progress: at, verifiedOn: "2026-11-20" }, at)).toBe(false);
    expect(readyToVerify({ ...goal("mind-201"), kind: "system", progress: at }, at)).toBe(false);
  });
});
