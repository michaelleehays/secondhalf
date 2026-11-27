import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { activeHabits, daysLeft, hudModel } from "../src/lib/hud";

describe("HUD model", () => {
  it("reads the sample player", () => {
    const hud = hudModel(SAMPLE_STATE, DEFAULT_RULES);
    expect(hud.levelCode).toBe("201");
    expect(hud.levelName).toBe("Momentum");
    expect(hud.score).toBe(61840);
    expect(hud.credits).toBe(1240);
    expect(hud.health).toBe(72);
    expect(hud.healthTone).toBe("ok");
    expect(hud.strength).toBe(64);
    expect(hud.atRisk).toEqual([{ goalId: "money-101", label: "Money 101", risk: 60 }]);
    expect(hud.recovery).toBeNull();
  });

  it("counts days to the start of the year the player turns 84", () => {
    // 2026-11-26 to 2068-01-01.
    expect(daysLeft(SAMPLE_STATE)).toBe(15011);
    expect(daysLeft({ ...SAMPLE_STATE, today: "2067-12-31" })).toBe(1);
    expect(daysLeft({ ...SAMPLE_STATE, today: "2070-01-01" })).toBe(0);
  });

  it("flags low health from the recovery threshold in the rules", () => {
    const low = { ...SAMPLE_STATE, character: { ...SAMPLE_STATE.character, health: DEFAULT_RULES.recovery.healthBelow - 1 } };
    expect(hudModel(low, DEFAULT_RULES).healthTone).toBe("bad");
  });

  it("shows the recovery pill instead of risk while in recovery", () => {
    const s = { ...SAMPLE_STATE, recovery: { cause: "auto" as const, startedOn: "2026-11-24", day: 3, daysDone: 2, habitTitle: "Meditate" } };
    const hud = hudModel(s, DEFAULT_RULES);
    expect(hud.recovery).toEqual({ day: 3, of: DEFAULT_RULES.recovery.days });
    expect(activeHabits(s).map((h) => h.id)).toEqual(["meditate"]);
  });

  it("skips habits in Rest areas", () => {
    const s = { ...SAMPLE_STATE, modes: { ...SAMPLE_STATE.modes, people: "rest" as const } };
    expect(activeHabits(s).map((h) => h.id)).not.toContain("reach-out");
    expect(activeHabits(SAMPLE_STATE)).toHaveLength(5);
  });
});
