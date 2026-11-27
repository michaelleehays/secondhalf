import { describe, expect, it } from "vitest";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createEngine, toWorldView } from "../src/index";

describe("toWorldView", () => {
  it("maps the sample player for the scene", () => {
    const view = toWorldView(SAMPLE_STATE);
    expect(view.level).toBe(2);
    expect(view.cells).toHaveLength(20);
    expect(view.cells.find((c) => c.area === "money" && c.level === 1)?.status).toBe("at_risk");
    expect(view.resistance.find((r) => r.id === "temptation")?.attackingGoalId).toBe("money-101");
    expect(view.athlete.slump).toBe(0);
  });

  it("slumps the athlete below 35 health", () => {
    const view = toWorldView({ ...SAMPLE_STATE, character: { ...SAMPLE_STATE.character, health: 20 } });
    expect(view.athlete.slump).toBe(1);
  });
});

describe("projectedFinalScore", () => {
  it("adds weekly dividends on locked-in goals for the rest of the game", () => {
    const engine = createEngine();
    expect(engine.projectedFinalScore(SAMPLE_STATE)).toBeGreaterThan(SAMPLE_STATE.score);
  });
});

describe("rules not yet implemented", () => {
  it("closeDay throws until workstream A lands", () => {
    expect(() => createEngine().closeDay(SAMPLE_STATE, { date: "2026-11-26", entries: [] })).toThrow(/workstream A/);
  });
});
