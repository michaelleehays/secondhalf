import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { areaView, athleteView, goalStatusText, resistanceView, visionView } from "../src/lib/coach";

const R = DEFAULT_RULES;
const BANNED = /conquer|siege|fallen|enem|attack|counter|shield|armor|gear|gold|party|raid|vanguard|squire|quest|knight/i;

describe("area sheet", () => {
  it("talks about the at-risk goal, with clean days from the rules", () => {
    const v = areaView(SAMPLE_STATE, "money", R, []);
    const days = Math.ceil(60 / R.risk.fullCleanDay);
    expect(v.coach).toContain("Money 101 is at 60% risk");
    expect(v.coach).toContain(`About ${days} clean days`);
    expect(v.coach).toContain("Temptation has beaten you 6 times");
    expect(v.rows.map((r) => r.status)).toEqual(["At risk · 60%", "Open", "Not yet visible", "Not yet visible"]);
    expect(v.rows[0]?.tone).toBe("risk");
  });

  it("leads with what just happened in that area", () => {
    const v = areaView(SAMPLE_STATE, "money", R, [{ type: "setback", resistance: "temptation", damage: R.health.setbackDamage }]);
    expect(v.coach).toBe(`Temptation landed a setback here: ${R.health.setbackDamage} health. Equip a game plan against it.`);
    // An event elsewhere doesn't change this area's line.
    expect(areaView(SAMPLE_STATE, "body", R, [{ type: "setback", resistance: "temptation", damage: 7 }]).coach).not.toContain("setback");
  });

  it("marks the level you tapped, and hides goals behind the ring below", () => {
    const v = areaView(SAMPLE_STATE, "body", R, [], 2);
    expect(v.rows.find((r) => r.current)?.goal.id).toBe("body-201");
    expect(v.rows[2]?.title).toBe("Shows once Body 201 is locked in");
    expect(v.rows[2]?.fill).toBeNull();
    expect(v.habits.map((h) => h.id)).toEqual(["run"]);
  });

  it("calls a milestone at the verify mark ready", () => {
    const g = { ...SAMPLE_STATE.goals.find((x) => x.id === "body-201")!, progress: R.progress.milestoneVerifyAt };
    expect(goalStatusText(g, R)).toBe("Ready to verify");
  });
});

describe("athlete, Vision and Resistance sheets", () => {
  it("reads the sample athlete", () => {
    const v = athleteView(SAMPLE_STATE, R, []);
    expect(v.condition).toBe("Strong");
    expect(v.graceText).toBe("2 grace days left this month");
    expect(v.canLogLifeEvent).toBe(true);
  });

  it("explains getting up while knocked down, from the rules", () => {
    const s = { ...SAMPLE_STATE, character: { ...SAMPLE_STATE.character, health: 0, knockedDown: { since: "2026-11-25", plays: 1 } } };
    const v = athleteView(s, R, []);
    expect(v.condition).toBe("Knocked down");
    expect(v.coach).toBe(`1 of ${R.health.getUpAfterPlays} habits logged since you went down. ${R.health.getUpAfterPlays - 1} more and you're up.`);
  });

  it("shows the projected score and the rings", () => {
    const v = visionView(SAMPLE_STATE, 123456);
    expect(v.projected).toBe("123,456");
    expect(v.name).toBe("The Vision");
    expect(v.rings[0]).toEqual({ level: 1, name: "Foundations", held: 3 });
    expect(visionView({ ...SAMPLE_STATE, levelNames: { 5: "Strong at 84" } }, 0).name).toBe("Strong at 84");
  });

  it("warns when a Resistance is at full strength", () => {
    const v = resistanceView(SAMPLE_STATE, "temptation", R, []);
    expect(v.strength).toBe(5);
    expect(v.coach).toContain('The next "Tempted" miss is a setback');
    expect(v.attacking).toBe("Pressing on Money 101 (60% risk)");
    expect(v.plans.map((p) => p.id)).toEqual(["gp-temptation"]);
  });

  it("keeps all sheet copy free of castle words", () => {
    const lines = [
      ...(["body", "mind", "work", "people", "money"] as const).map((a) => areaView(SAMPLE_STATE, a, R, []).coach),
      athleteView(SAMPLE_STATE, R, []).coach,
      visionView(SAMPLE_STATE, 1).coach,
      ...(["fatigue", "no_time", "temptation", "stress", "avoidance"] as const).map((id) => resistanceView(SAMPLE_STATE, id, R, []).coach),
    ];
    for (const l of lines) expect(l).not.toMatch(BANNED);
  });
});
