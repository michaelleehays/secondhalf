import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type CheckIn, type GameState, type PlanEdit } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createEngine } from "@second-half/engine";
import { ComingSoonError, createLocalAdapter } from "../src/lib/adapter";
import { STORAGE_KEY, readSaved } from "../src/lib/storage";
import { memoryStore } from "./fakeStore";

const TODAY = "2026-11-27"; // a Friday, the day after the sample's last check-in
const allFull = (date: string): CheckIn => ({ date, entries: SAMPLE_STATE.habits.map((h) => ({ habitId: h.id, result: "full" })) });

describe("local engine adapter", () => {
  it("starts from the sample player, closed for its last day and open tonight", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const g = await a.load(TODAY);
    expect(g.state).toEqual(SAMPLE_STATE);
    expect(g.state).not.toBe(SAMPLE_STATE);
    expect(g.closedOn).toBe(SAMPLE_STATE.today);
    expect(g.date).toBe(TODAY);
  });

  it("closes the day with the real engine and saves the result", async () => {
    const store = memoryStore();
    const a = createLocalAdapter({ store });
    const g = await a.load(TODAY);
    const step = await a.closeDay(g, allFull(TODAY));
    const expected = createEngine(DEFAULT_RULES).closeDay(SAMPLE_STATE, allFull(TODAY));
    expect(step.game.state).toEqual(expected.state);
    expect(step.events).toEqual(expected.events);
    expect(step.game.closedOn).toBe(TODAY);
    expect(readSaved(store)).toEqual(step.game);
  });

  it("picks up a saved game, and never moves the date backwards", async () => {
    const store = memoryStore();
    const a = createLocalAdapter({ store });
    const first = await a.closeDay(await a.load(TODAY), allFull(TODAY));
    const again = await createLocalAdapter({ store }).load("2026-11-20");
    expect(again.state).toEqual(first.game.state);
    expect(again.date).toBe(TODAY);
    expect((await createLocalAdapter({ store }).load("2026-11-29")).date).toBe("2026-11-29");
  });

  it("falls back to the sample player when the save is unreadable", async () => {
    for (const bad of ["{not json", JSON.stringify({ state: { userId: 1 } }), JSON.stringify({ date: "x" })]) {
      const g = await createLocalAdapter({ store: memoryStore({ [STORAGE_KEY]: bad }) }).load(TODAY);
      expect(g.state.userId).toBe(SAMPLE_STATE.userId);
    }
  });

  it("keeps working in memory when storage throws", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const a = createLocalAdapter({ store: throwing });
    const g = await a.load(TODAY);
    const step = await a.closeDay(g, allFull(TODAY));
    expect(step.game.closedOn).toBe(TODAY);
    await expect(a.reset(TODAY)).resolves.toMatchObject({ closedOn: SAMPLE_STATE.today });
  });

  it("lets a week pass: closes the week on Sunday and moves to Monday", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const g = await a.load(TODAY);
    const step = await a.passWeek(g);
    expect(step.game.state.today).toBe("2026-11-29");
    expect(step.game.date).toBe("2026-11-30");
    expect(step.events).toEqual(createEngine(DEFAULT_RULES).closeWeek(SAMPLE_STATE, "2026-11-29").events);
  });

  it("skips to tomorrow without touching the game state", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const g = await a.load(TODAY);
    const next = await a.nextDay(g);
    expect(next.date).toBe("2026-11-28");
    expect(next.state).toBe(g.state);
  });

  it("restarts from the sample player and clears the old save", async () => {
    const store = memoryStore();
    const a = createLocalAdapter({ store });
    await a.closeDay(await a.load(TODAY), allFull(TODAY));
    const fresh = await a.reset(TODAY);
    expect(fresh.state).toEqual(SAMPLE_STATE);
    expect(readSaved(store)?.state).toEqual(SAMPLE_STATE);
  });

  it("equips a game plan through the engine", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const g = await a.load(TODAY);
    const step = await a.equipGamePlan(g, "gp-temptation", true);
    expect(step.game.state.gamePlans.find((p) => p.id === "gp-temptation")?.equipped).toBe(true);
  });

  it("starts Recovery for a life event on the app's date", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const step = await a.startLifeEvent(await a.load(TODAY));
    expect(step.game.state.recovery?.startedOn).toBe(TODAY);
    expect(step.events.some((e) => e.type === "recovery_started")).toBe(true);
  });
});

describe("plan edits and verification", () => {
  it("reports the engine's plan-edit stub as coming soon", async () => {
    const stub = { ...createEngine(DEFAULT_RULES), applyPlanEdit: () => { throw new Error("engine.applyPlanEdit is not implemented yet (workstream A)"); } };
    const a = createLocalAdapter({ store: memoryStore(), engine: stub });
    const g = await a.load(TODAY);
    expect(a.canEditPlan(g.state)).toBe(false);
    await expect(a.applyPlanEdit(g, { kind: "rename_level", level: 2, name: "Engine room" })).rejects.toBeInstanceOf(ComingSoonError);
  });

  it("passes real failures through, not as coming soon", async () => {
    const broken = { ...createEngine(DEFAULT_RULES), applyPlanEdit: () => { throw new Error("boom"); } };
    const a = createLocalAdapter({ store: memoryStore(), engine: broken });
    const g = await a.load(TODAY);
    expect(a.canEditPlan(g.state)).toBe(true);
    await expect(a.applyPlanEdit(g, { kind: "retire_habit", habitId: "run" })).rejects.toThrow("boom");
  });

  it("applies and saves an edit when the engine supports it", async () => {
    const store = memoryStore();
    const engine = {
      ...createEngine(DEFAULT_RULES),
      applyPlanEdit: (state: GameState, edit: PlanEdit) =>
        edit.kind === "rename_level"
          ? { state: { ...state, levelNames: { ...state.levelNames, [edit.level]: edit.name } }, events: [] }
          : { state, events: [{ type: "plan_rejected" as const, edit: edit.kind, reason: "Not that one." }] },
    };
    const a = createLocalAdapter({ store, engine });
    const g = await a.load(TODAY);
    expect(a.canEditPlan(g.state)).toBe(true);
    const renamed = await a.applyPlanEdit(g, { kind: "rename_level", level: 2, name: "Engine room" });
    expect(renamed.game.state.levelNames?.[2]).toBe("Engine room");
    expect(readSaved(store)?.state.levelNames?.[2]).toBe("Engine room");
    const refused = await a.applyPlanEdit(renamed.game, { kind: "retire_habit", habitId: "run" });
    expect(refused.events).toEqual([{ type: "plan_rejected", edit: "retire_habit", reason: "Not that one." }]);
  });

  it("verifies a ready milestone with the real engine on the app's date", async () => {
    const at = DEFAULT_RULES.progress.milestoneVerifyAt;
    const ready = { ...SAMPLE_STATE, goals: SAMPLE_STATE.goals.map((x) => (x.id === "body-201" ? { ...x, progress: at } : x)) };
    const a = createLocalAdapter({ store: memoryStore(), initial: ready });
    const step = await a.verifyAchievement(await a.load(TODAY), "body-201", "47:10 on the river loop");
    expect(step.events[0]).toEqual({ type: "verified", goalId: "body-201", note: "47:10 on the river loop" });
    const g = step.game.state.goals.find((x) => x.id === "body-201")!;
    expect(g.verifiedOn).toBe(TODAY);
    expect(g.status).toBe("locked_in");
  });
});

describe("plan edits with the real engine", () => {
  it("renames a level, and turns down a kind change on at-risk ground with a reason", async () => {
    const a = createLocalAdapter({ store: memoryStore() });
    const g = await a.load(TODAY);
    expect(a.canEditPlan(g.state)).toBe(true);
    const renamed = await a.applyPlanEdit(g, { kind: "rename_level", level: 2, name: "Engine room" });
    expect(renamed.game.state.levelNames?.[2]).toBe("Engine room");
    const refused = await a.applyPlanEdit(renamed.game, { kind: "set_goal", goalId: "money-101", goalKind: "system" });
    expect(refused.events[0]?.type).toBe("plan_rejected");
    expect(refused.game.state).toEqual(renamed.game.state);
  });
});
