import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GamePlan, type GameState } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeReview, createEngine, equipGamePlan } from "../src/index";

// Sample: Level 201 (x1.25); game plans gp-fatigue and gp-temptation, neither equipped.
const plan = (id: string, equipped: boolean): GamePlan => ({ id, resistance: "stress", text: "If stressed, three slow breaths.", equipped });
const withPlans = (plans: GamePlan[]): GameState => ({ ...SAMPLE_STATE, gamePlans: plans });
const full = () => Array.from({ length: R.resistance.maxEquippedPlans }, (_, i) => plan(`gp${i}`, true));

describe("equipGamePlan", () => {
  it("equips and takes off a game plan", () => {
    const on = equipGamePlan(SAMPLE_STATE, "gp-fatigue", true);
    expect(on.state.gamePlans.find((p) => p.id === "gp-fatigue")!.equipped).toBe(true);
    expect(on.events).toEqual([]);
    const off = equipGamePlan(on.state, "gp-fatigue", false);
    expect(off.state.gamePlans.find((p) => p.id === "gp-fatigue")!.equipped).toBe(false);
  });

  it("game plan cap: equipping past maxEquippedPlans is refused with game_plan_refused and no change", () => {
    const start = withPlans([...full(), plan("extra", false)]);
    const { state, events } = equipGamePlan(start, "extra", true);
    expect(state).toBe(start);
    expect(events).toEqual([{ type: "game_plan_refused", gamePlanId: "extra", max: R.resistance.maxEquippedPlans }]);
  });

  it("taking a plan off always works, even at the cap", () => {
    const { state } = equipGamePlan(withPlans(full()), "gp0", false);
    expect(state.gamePlans.filter((p) => p.equipped)).toHaveLength(R.resistance.maxEquippedPlans - 1);
  });

  it("unknown ids and toggles that change nothing leave the state untouched", () => {
    for (const [id, eq] of [["nope", true], ["gp-fatigue", false]] as const) {
      const r = equipGamePlan(SAMPLE_STATE, id, eq);
      expect(r.state).toBe(SAMPLE_STATE);
      expect(r.events).toEqual([]);
    }
  });

  it("reads maxEquippedPlans from the engine's config", () => {
    const config = { ...R, resistance: { ...R.resistance, maxEquippedPlans: 1 } };
    const once = createEngine(config).equipGamePlan(SAMPLE_STATE, "gp-fatigue", true).state;
    expect(createEngine(config).equipGamePlan(once, "gp-temptation", true).events[0]?.type).toBe("game_plan_refused");
  });
});

describe("closeReview", () => {
  it("weekly review pays points.weeklyReview x level multiplier and credits.weeklyReview", () => {
    const { state, events } = closeReview(SAMPLE_STATE, "2026-11-29");
    const score = Math.round(R.points.weeklyReview * 1.25); // 31.25 -> 31
    expect(state.score).toBe(SAMPLE_STATE.score + score);
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.weeklyReview);
    expect(state.lastReviewOn).toBe("2026-11-29");
    expect(events).toEqual([{ type: "points", score, credits: R.credits.weeklyReview, reason: "weekly_review" }]);
  });

  it("weekly review pays once per Monday-Sunday week", () => {
    // 2026-11-23 is a Monday, 2026-11-29 the Sunday after it, 2026-11-30 the next Monday.
    const done = { ...SAMPLE_STATE, lastReviewOn: "2026-11-23" };
    const again = closeReview(done, "2026-11-29");
    expect(again.state).toBe(done);
    expect(again.events).toEqual([]);
    expect(closeReview({ ...SAMPLE_STATE, lastReviewOn: "2026-11-29" }, "2026-11-30").events).toHaveLength(1);
  });

  it("is wired into the engine, and neither function mutates its input", () => {
    const input = structuredClone(SAMPLE_STATE);
    const before = structuredClone(input);
    createEngine().closeReview(input, "2026-11-29");
    createEngine().equipGamePlan(input, "gp-fatigue", true);
    expect(input).toEqual(before);
  });
});
