import { describe, expect, it } from "vitest";
import { AREAS, DEFAULT_RULES, type CheckIn, type GameState, type StepResult } from "@second-half/contracts";
import { createEngine } from "@second-half/engine";
import { GameApiError, STALE_SAVE, toSaveArgs, type GameApi } from "@second-half/api";
import { StaleGameError } from "../src/lib/adapter";
import { newPlayerState } from "../src/lib/newPlayer";
import { closedOnFor, createRemoteAdapter } from "../src/lib/remoteAdapter";
import { supabaseConfig } from "../src/lib/supabase";

const USER = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-11-27";

/** Lets other pending calls run, like a network round trip. */
const tick = () => new Promise((r) => setTimeout(r, 1));

/** An in-memory stand-in for the api client: one game per user, with save_step_result's version check. */
function fakeApi(initial?: GameState) {
  const saves: { result: StepResult; expectedVersion: number | undefined }[] = [];
  let stored: { state: GameState; version: number } | null = initial ? { state: structuredClone(initial), version: 1 } : null;
  let loads = 0;
  const api: GameApi & { saves: typeof saves; bump: (s: GameState) => void; loads: () => number; stored: () => typeof stored } = {
    saves,
    loads: () => loads,
    stored: () => stored,
    bump: (s) => {
      stored = { state: structuredClone(s), version: (stored?.version ?? 0) + 1 };
    },
    async loadVersioned() {
      await tick();
      loads += 1;
      return stored ? { state: structuredClone(stored.state), version: stored.version } : null;
    },
    async loadGameState() {
      return stored ? structuredClone(stored.state) : null;
    },
    async saveStepResult(userId, result, options = {}) {
      await tick();
      if (result.state.userId !== userId) throw new GameApiError("wrong user", "22023");
      const current = stored?.version ?? 0;
      if (options.expectedVersion !== undefined && options.expectedVersion !== current) throw new GameApiError("stale", STALE_SAVE);
      saves.push({ result, expectedVersion: options.expectedVersion });
      stored = { state: structuredClone(result.state), version: current + 1 };
      return current + 1;
    },
  };
  return api;
}

const adapterFor = (api: GameApi) => createRemoteAdapter({ api, userId: USER, timezone: "America/Chicago" });

describe("new player", () => {
  const s = newPlayerState({ userId: USER, today: TODAY, timezone: "America/Chicago" });

  it("starts at Level 101 with nothing locked in and tonight's check-in open", () => {
    expect(s.level).toBe(1);
    expect(s.score).toBe(0);
    expect(s.birthYear).toBe(2026 - DEFAULT_RULES.life.startAge);
    expect(s.character.strength).toBe(DEFAULT_RULES.strength.start);
    expect(s.today).toBe("2026-11-26");
    expect(s.character.health).toBe(DEFAULT_RULES.health.start);
    expect(s.goals.filter((g) => g.level === 1).map((g) => g.status)).toEqual(["open", "open", "open", "open", "open"]);
    expect(s.goals.filter((g) => g.level > 1).every((g) => g.status === "hidden")).toBe(true);
    expect(s.goals.some((g) => g.lockedInOn || g.verifiedOn)).toBe(false);
    expect(Object.values(s.resistance).every((r) => r.strength === 1 && r.reports14d === 0)).toBe(true);
  });

  it("has habits that feed its open 101 goals, one per area", () => {
    expect(s.habits.map((h) => h.goalId).sort()).toEqual(AREAS.map((a) => `${a}-101`).sort());
    expect(s.habits.every((h) => h.history.length === 0)).toBe(true);
  });

  it("plays a day on the real engine and makes a valid save", () => {
    const checkIn: CheckIn = { date: TODAY, entries: s.habits.map((h) => ({ habitId: h.id, result: "full" })) };
    const result = createEngine(DEFAULT_RULES).closeDay(s, checkIn);
    expect(result.state.score).toBeGreaterThan(0);
    const args = toSaveArgs(USER, result, 0);
    expect(args.p_state.userId).toBe(USER);
    expect(args.p_expected_version).toBe(0);
  });
});

describe("remote adapter", () => {
  it("creates and saves a new game on first load", async () => {
    const api = fakeApi();
    const g = await adapterFor(api).load(TODAY);
    expect(g.state.userId).toBe(USER);
    expect(g.date).toBe(TODAY);
    expect(g.closedOn).toBeNull();
    expect(api.saves).toHaveLength(1);
    expect(api.saves[0]?.expectedVersion).toBe(0);
  });

  it("loads an existing game and saves each step against the version it holds", async () => {
    const start = newPlayerState({ userId: USER, today: TODAY, timezone: "UTC" });
    const api = fakeApi(start);
    const a = adapterFor(api);
    const g = await a.load(TODAY);
    expect(api.saves).toHaveLength(0);
    const day = await a.closeDay(g, { date: TODAY, entries: g.state.habits.map((h) => ({ habitId: h.id, result: "full" })) });
    expect(api.saves[0]?.expectedVersion).toBe(1);
    expect(day.game.closedOn).toBe(TODAY);
    expect(closedOnFor(day.game.state)).toBe(TODAY);
    const plan = await a.equipGamePlan(day.game, day.game.state.gamePlans[0]!.id, true);
    expect(api.saves[1]?.expectedVersion).toBe(2);
    expect(plan.game.state.gamePlans[0]?.equipped).toBe(true);
  });

  it("refuses a save made from an old copy and hands back the latest game", async () => {
    const start = newPlayerState({ userId: USER, today: TODAY, timezone: "UTC" });
    const api = fakeApi(start);
    const a = adapterFor(api);
    const g = await a.load(TODAY);
    api.bump({ ...start, score: 999 }); // another device saved meanwhile
    const err = await a.closeDay(g, { date: TODAY, entries: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(StaleGameError);
    expect((err as StaleGameError).game.state.score).toBe(999);
    // With the latest version loaded, the next save goes through.
    await expect(a.setVision((err as StaleGameError).game, "Strong at 84.")).resolves.toMatchObject({ state: { vision: "Strong at 84." } });
  });

  it("doesn't save an edit the engine turned down", async () => {
    const api = fakeApi(newPlayerState({ userId: USER, today: TODAY, timezone: "UTC" }));
    const a = adapterFor(api);
    const g = await a.load(TODAY);
    const step = await a.applyPlanEdit(g, { kind: "rename_level", level: 1, name: "" });
    expect(step.events[0]?.type).toBe("plan_rejected");
    expect(api.saves).toHaveLength(0);
    await a.applyPlanEdit(g, { kind: "rename_level", level: 1, name: "Base camp" });
    expect(api.saves).toHaveLength(1);
  });

  it("has no demo controls", async () => {
    const a = adapterFor(fakeApi(newPlayerState({ userId: USER, today: TODAY, timezone: "UTC" })));
    const g = await a.load(TODAY);
    expect(a.mode).toBe("remote");
    await expect(a.passWeek(g)).rejects.toThrow(/demo control/);
    await expect(a.reset(TODAY)).rejects.toThrow(/demo control/);
  });
});

describe("Supabase config", () => {
  it("needs both the URL and the publishable key", () => {
    expect(supabaseConfig({ url: "https://x.supabase.co/", key: "sb_publishable_x" })).toEqual({ url: "https://x.supabase.co", publishableKey: "sb_publishable_x" });
    expect(supabaseConfig({ url: "https://x.supabase.co" })).toBeNull();
    expect(supabaseConfig({ key: "k" })).toBeNull();
    expect(supabaseConfig({ url: " ", key: " " })).toBeNull();
  });
});

describe("first sign-in, opened twice at once", () => {
  it("one tab asking twice creates the game once", async () => {
    const api = fakeApi();
    const a = adapterFor(api);
    const [g1, g2] = await Promise.all([a.load(TODAY), a.load(TODAY)]);
    expect(api.saves).toHaveLength(1);
    expect(g1.state).toEqual(g2.state);
    // And the adapter holds the right version: the next save goes through.
    await expect(a.setVision(g1, "Strong at 84.")).resolves.toMatchObject({ state: { vision: "Strong at 84." } });
    expect(api.saves.map((s) => s.expectedVersion)).toEqual([0, 1]);
  });

  it("two tabs creating at once: the second uses the first's game instead of failing", async () => {
    const api = fakeApi();
    // Each tab has its own api client over the same database.
    const tab1 = adapterFor(api);
    const tab2 = adapterFor({ ...api });
    const [g1, g2] = await Promise.all([tab1.load(TODAY), tab2.load(TODAY)]);
    // Both found no game; one create was saved, the other was refused and loaded that game instead.
    expect(api.loads()).toBe(3);
    expect(api.saves).toHaveLength(1);
    expect(g2.state).toEqual(g1.state);
    // Both tabs can save afterwards; the one that's behind is told, gets the latest, and saves on retry.
    await tab1.applyPlanEdit(g1, { kind: "rename_level", level: 2, name: "Engine room" });
    const stale = await tab2.applyPlanEdit(g2, { kind: "rename_level", level: 3, name: "Deep water" }).catch((e) => e);
    expect(stale).toBeInstanceOf(StaleGameError);
    const latest = (stale as StaleGameError).game;
    expect(latest.state.levelNames?.[2]).toBe("Engine room");
    await tab2.applyPlanEdit(latest, { kind: "rename_level", level: 3, name: "Deep water" });
    expect(api.stored()?.state.levelNames).toEqual({ 2: "Engine room", 3: "Deep water" });
  });
});

describe("plan edits at every level reach save_step_result", () => {
  it("renames all five levels and edits goals and habits on hidden, future ground", async () => {
    const api = fakeApi();
    const a = adapterFor(api);
    let g = await a.load(TODAY);
    expect(g.state.goals.find((x) => x.id === "body-401")?.status).toBe("hidden");
    for (const level of [1, 2, 3, 4, 5] as const) g = (await a.applyPlanEdit(g, { kind: "rename_level", level, name: `Level ${level}` })).game;
    g = (await a.applyPlanEdit(g, { kind: "set_goal", goalId: "body-401", title: "Strong at 84", verification: "Deadlift bodyweight" })).game;
    g = (await a.applyPlanEdit(g, { kind: "set_goal", goalId: "money-301", goalKind: "system" })).game;
    g = (
      await a.applyPlanEdit(g, {
        kind: "add_habit",
        habit: { id: "body-301-long-run", goalId: "body-301", area: "body", title: "Long run", fullDose: "60 minutes", minimumDose: "20 minutes", weeklyTarget: { focus: 1, maintain: 1, rest: 0 }, maintenance: false },
      })
    ).game;
    g = await a.setVision(g, "Free with my time.");
    // One create plus nine edits, each saved against the version before it.
    expect(api.saves.map((s) => s.expectedVersion)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const stored = api.stored()!.state;
    expect(stored.levelNames).toEqual({ 1: "Level 1", 2: "Level 2", 3: "Level 3", 4: "Level 4", 5: "Level 5" });
    expect(stored.goals.find((x) => x.id === "body-401")).toMatchObject({ title: "Strong at 84", verification: "Deadlift bodyweight", status: "hidden" });
    expect(stored.goals.find((x) => x.id === "money-301")?.kind).toBe("system");
    expect(stored.habits.some((h) => h.id === "body-301-long-run")).toBe(true);
    expect(stored.vision).toBe("Free with my time.");
    expect(g.state).toEqual(stored);
  });
});

describe("refresh", () => {
  it("returns the latest game only when it changed elsewhere", async () => {
    const api = fakeApi();
    const a = adapterFor(api);
    const g = await a.load(TODAY);
    expect(await a.refresh!(g)).toBeNull();
    api.bump({ ...g.state, score: 321 });
    const latest = await a.refresh!(g);
    expect(latest?.state.score).toBe(321);
    // The adapter now holds that version, so a save goes through.
    await expect(a.setVision(latest!, "x")).resolves.toBeTruthy();
  });
});
