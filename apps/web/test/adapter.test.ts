import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type CheckIn } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createEngine } from "@second-half/engine";
import { createLocalAdapter } from "../src/lib/adapter";
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
