import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type Goal } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { checkLevels, closeDay, closeWeek, quarterlyCheck } from "../src/index";

// Sample: Level 2 (201). Ring 1 holds 4 of 5 (body, mind, work locked in; money at risk; people in progress).
// Ring 2: body 0.4, mind 0.2 in progress; work, money open; people hidden. Rings 3 and 4 hidden.
const DATE = "2026-11-27";
const goal = (state: GameState, id: string) => state.goals.find((g) => g.id === id)!;
const set = (state: GameState, patches: Record<string, Partial<Goal>>): GameState => ({
  ...state,
  goals: state.goals.map((g) => (patches[g.id] ? { ...g, ...patches[g.id] } : g)),
});
const lockRing2 = (state: GameState, ...areas: string[]) =>
  set(state, Object.fromEntries(areas.map((a) => [`${a}-201`, { status: "locked_in" as const, progress: 1 }])));

describe("Levels", () => {
  it("the sample player is stable at Level 201", () => {
    const { state, events } = checkLevels(SAMPLE_STATE);
    expect(state).toBe(SAMPLE_STATE);
    expect(events).toEqual([]);
  });

  it("level clears when goalsToClear of its 5 goals are locked in: level_up and credits.levelCleared", () => {
    const start = lockRing2(SAMPLE_STATE, "body", "mind", "work", "money");
    const { state, events } = checkLevels(start);
    expect(state.level).toBe(3);
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.levelCleared);
    expect(events).toEqual([
      { type: "level_up", level: 3 },
      { type: "points", score: 0, credits: R.credits.levelCleared, reason: "level_cleared" },
    ]);
  });

  it("at-risk goals still count as held for clearing a level", () => {
    const start = set(lockRing2(SAMPLE_STATE, "body", "mind", "work"), { "money-201": { status: "at_risk", progress: 1, risk: 50 } });
    expect(checkLevels(start).state.level).toBe(3);
  });

  it("3 of 5 does not clear a level", () => {
    expect(checkLevels(lockRing2(SAMPLE_STATE, "body", "mind", "work")).state.level).toBe(2);
  });

  it("clearing a level opens the next ring's goals in the areas held, and only there", () => {
    const { state } = checkLevels(lockRing2(SAMPLE_STATE, "body", "mind", "work", "money"));
    for (const id of ["body-301", "mind-301", "work-301", "money-301"]) expect(goal(state, id).status).toBe("open");
    expect(goal(state, "people-301").status).toBe("hidden");
  });

  it("an area taken after the level-up opens its next goal at the following level check", () => {
    // Level 201 with people-101 still in progress: people-201 stays hidden until people-101 is held.
    expect(goal(checkLevels(SAMPLE_STATE).state, "people-201").status).toBe("hidden");
    const taken = set(SAMPLE_STATE, { "people-101": { status: "locked_in", progress: 1 } });
    const { state, events } = checkLevels(taken);
    expect(goal(state, "people-201").status).toBe("open");
    expect(state.level).toBe(2);
    expect(events).toEqual([]);
  });

  it("dropping a level: lost ground leaves ring below with fewer than goalsToClear and the player drops", () => {
    const start = set(SAMPLE_STATE, { "money-101": { status: "lost", progress: R.risk.lostRestartProgress, risk: 0 } });
    const { state, events } = checkLevels(start);
    expect(state.level).toBe(1);
    expect(events).toEqual([{ type: "level_lost", level: 1 }]);
  });

  it("dropping a level freezes the goals above the new level, progress kept", () => {
    const start = set(SAMPLE_STATE, { "money-101": { status: "lost", progress: 0.5 } });
    const { state } = checkLevels(start);
    expect(goal(state, "body-201").frozen).toBe(true);
    expect(goal(state, "body-201").progress).toBe(0.4);
    expect(goal(state, "body-201").status).toBe("in_progress");
    expect(goal(state, "body-101").frozen).toBe(false);
    expect(goal(state, "body-301").frozen).toBe(false); // hidden ground is not marked frozen
  });

  it("retaking the ground brings the level back and unfreezes the goals on it", () => {
    const dropped = checkLevels(set(SAMPLE_STATE, { "money-101": { status: "lost", progress: 0.5 } })).state;
    const retaken = set(dropped, { "money-101": { status: "locked_in", progress: 1 } });
    const { state, events } = checkLevels(retaken);
    expect(state.level).toBe(2);
    expect(goal(state, "body-201").frozen).toBe(false);
    expect(goal(state, "body-201").progress).toBe(0.4);
    expect(events).toContainEqual({ type: "level_up", level: 2 });
  });

  it("frozen goals that are still locked in count again on retaking, so the player can climb more than one level", () => {
    const at3 = { ...lockRing2(SAMPLE_STATE, "body", "mind", "work", "money"), level: 3 as const };
    const dropped = checkLevels(set(at3, { "money-101": { status: "lost" } })).state;
    expect(dropped.level).toBe(1);
    const { state } = checkLevels(set(dropped, { "money-101": { status: "locked_in", progress: 1 } }));
    expect(state.level).toBe(3);
  });

  it("Level 501 is the top: ring 4 cleared reaches 5 and goes no further", () => {
    const all = SAMPLE_STATE.goals.map((g): Goal => ({ ...g, status: "locked_in", progress: 1, frozen: false }));
    const { state, events } = checkLevels({ ...SAMPLE_STATE, goals: all });
    expect(state.level).toBe(5);
    expect(events.filter((e) => e.type === "level_up").map((e) => (e.type === "level_up" ? e.level : 0))).toEqual([3, 4, 5]);
  });

  it("dropping a level: ground lost two rings down drops the player to that ring, in one level_lost", () => {
    const at3 = { ...lockRing2(SAMPLE_STATE, "body", "mind", "work", "money"), level: 3 as const };
    const { state, events } = checkLevels(set(at3, { "money-101": { status: "lost" } }));
    expect(state.level).toBe(1);
    expect(events).toEqual([{ type: "level_lost", level: 1 }]);
    expect(goal(state, "body-201").frozen).toBe(true);
  });

  it("re-clearing a level pays nothing: credits.levelCleared only above bestLevel", () => {
    const dropped = checkLevels(set(SAMPLE_STATE, { "money-101": { status: "lost", progress: 0.5 } })).state;
    expect(dropped.bestLevel).toBe(2);
    const { state, events } = checkLevels(set(dropped, { "money-101": { status: "locked_in", progress: 1 } }));
    expect(state.level).toBe(2);
    expect(state.credits).toBe(SAMPLE_STATE.credits);
    expect(events).toEqual([{ type: "level_up", level: 2 }]);
  });

  it("bestLevel undefined counts as the current level, and is set to the highest level reached", () => {
    const noBest: GameState = { ...SAMPLE_STATE };
    delete noBest.bestLevel;
    const up = checkLevels(lockRing2(noBest, "body", "mind", "work", "money")).state;
    expect(up.bestLevel).toBe(3);
    expect(up.credits).toBe(SAMPLE_STATE.credits + R.credits.levelCleared);
    // At Level 201 with bestLevel unset, retaking 201 after a drop pays nothing.
    const at1 = { ...set(SAMPLE_STATE, { "money-101": { status: "lost" } }), level: 1 as const, bestLevel: 2 as const };
    const back = checkLevels(set(at1, { "money-101": { status: "locked_in", progress: 1 } })).state;
    expect(back.credits).toBe(SAMPLE_STATE.credits);
  });

  it("clearing past bestLevel pays again for each new level", () => {
    const start = { ...lockRing2(SAMPLE_STATE, "body", "mind", "work", "money"), bestLevel: 2 as const };
    const { state } = checkLevels(start);
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.levelCleared);
    expect(state.bestLevel).toBe(3);
  });

  it("reads goalsToClear from config", () => {
    const config = { ...R, levels: { goalsToClear: 3 } };
    expect(checkLevels(lockRing2(SAMPLE_STATE, "body", "mind", "work"), config).state.level).toBe(3);
  });

  it("runs at the end of closeWeek: a lock-in that clears the ring levels up the same night", () => {
    // body-201 is a verified milestone one consistent week short of the verify point; run (Focus target 4) hits it.
    const verifyAt = R.progress.milestoneVerifyAt;
    const week = Array.from({ length: 4 }, (_, i) => ({ date: `2026-11-${24 + i}`, result: "full" as const }));
    const start = set(lockRing2(SAMPLE_STATE, "mind", "work", "money"), {
      "body-201": { progress: verifyAt - 1 / R.progress.weeksToLockIn[2], verifiedOn: "2026-11-20" },
    });
    const withRuns = {
      ...start,
      habits: start.habits.map((h) => (h.id === "run" ? { ...h, history: week } : h)),
      weekProgress: { body: true, mind: true, work: true, people: true, money: true },
    };
    const { state, events } = closeWeek(withRuns, "2026-11-29");
    expect(goal(state, "body-201").status).toBe("locked_in");
    expect(state.level).toBe(3);
    const types = events.map((e) => e.type);
    expect(types.indexOf("level_up")).toBeGreaterThan(types.indexOf("locked_in"));
  });

  it("runs at the end of closeDay: ground lost to a setback drops the level the same night", () => {
    const start = set(SAMPLE_STATE, { "money-101": { risk: 100 - R.risk.setbackPressure } });
    const { state, events } = closeDay(start, { date: DATE, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] });
    expect(state.level).toBe(1);
    expect(events).toContainEqual({ type: "level_lost", level: 1 });
  });

  it("runs at the end of quarterlyCheck", () => {
    // Ring 1 holds 3 with money-101 lost, but the player still shows Level 201: the check settles it.
    const stale = set(SAMPLE_STATE, { "money-101": { status: "lost" } });
    const { state, events } = quarterlyCheck(stale, "work-101", true, DATE);
    expect(state.level).toBe(1);
    expect(events).toContainEqual({ type: "level_lost", level: 1 });
  });

  it("does not mutate its input", () => {
    const input = structuredClone(lockRing2(SAMPLE_STATE, "body", "mind", "work", "money"));
    const before = structuredClone(input);
    checkLevels(input);
    checkLevels(set(input, { "money-101": { status: "lost" } }));
    expect(input).toEqual(before);
  });
});
