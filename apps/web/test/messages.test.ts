import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type CheckIn, type GameEvent } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createEngine } from "@second-half/engine";
import { eventToast, summarize, toastsForDay, toastsForWeek } from "../src/lib/messages";
import { signed } from "../src/lib/labels";

const engine = createEngine(DEFAULT_RULES);
const date = "2026-11-27";
const BANNED = /conquer|siege|fallen|enem|attack|counter|shield|armor|gear|gold|party|raid|vanguard|squire|quest|knight/i;

describe("coach messages", () => {
  it("sums a real closed day into one line, numbers from the events", () => {
    const checkIn: CheckIn = { date, entries: SAMPLE_STATE.habits.map((h) => ({ habitId: h.id, result: "full" })) };
    const { state, events } = engine.closeDay(SAMPLE_STATE, checkIn);
    const [summary] = toastsForDay(events, state, DEFAULT_RULES);
    const score = events.reduce((n, e) => n + (e.type === "points" ? e.score : 0), 0);
    const credits = events.reduce((n, e) => n + (e.type === "points" ? e.credits : 0), 0);
    expect(summary?.title).toBe("Day closed");
    expect(summary?.body.startsWith(`${signed(score)} points · ${signed(credits)} credits`)).toBe(true);
    expect(summary?.kind).toBe("good");
  });

  it("names the Resistance and the health cost of a setback", () => {
    const e: GameEvent = { type: "setback", resistance: "temptation", damage: DEFAULT_RULES.health.setbackDamage };
    expect(eventToast(e, SAMPLE_STATE, DEFAULT_RULES)?.body).toBe(
      `Temptation hit strength ${DEFAULT_RULES.resistance.setbackAt}. That cost you ${DEFAULT_RULES.health.setbackDamage} health. A game plan against it softens the next one.`,
    );
  });

  it("covers grace, health and strength in the summary", () => {
    const s = summarize([
      { type: "grace_used", habitId: "run" },
      { type: "health_changed", delta: -DEFAULT_RULES.health.missCost, reason: "miss" },
      { type: "strength_changed", delta: -DEFAULT_RULES.strength.idleWeekCost },
    ]);
    expect(s).toEqual({ body: `1 miss covered by grace · ${signed(-DEFAULT_RULES.health.missCost)} health · ${signed(-DEFAULT_RULES.strength.idleWeekCost)} strength.`, kind: "bad" });
    expect(summarize([])).toBeNull();
  });

  it("closes a week with a summary even when nothing happened", () => {
    const { state, events } = engine.closeWeek(SAMPLE_STATE, "2026-11-29");
    expect(toastsForWeek(events, state, DEFAULT_RULES)[0]?.title).toBe("Week closed");
  });

  it("uses no castle or fantasy words for any event", () => {
    const all: GameEvent[] = [
      { type: "setback", resistance: "fatigue", damage: 7 },
      { type: "locked_in", goalId: "body-101" },
      { type: "at_risk", goalId: "money-101", risk: 60 },
      { type: "risk_cleared", goalId: "money-101" },
      { type: "ground_lost", goalId: "money-101" },
      { type: "level_lost", level: 1 },
      { type: "level_up", level: 2 },
      { type: "recovery_started", cause: "auto" },
      { type: "recovery_ended", completed: true },
      { type: "recovery_ended", completed: false },
      { type: "knocked_down" },
      { type: "ready_to_verify", goalId: "body-201" },
      { type: "verified", goalId: "body-201" },
      { type: "plan_rejected", edit: "set_goal", reason: "A locked-in goal keeps its kind." },
      { type: "game_plan_refused", gamePlanId: "gp-fatigue", max: 3 },
      { type: "maintenance_cap", count: 7, max: 6, habitIds: [] },
    ];
    for (const e of all) {
      const t = eventToast(e, SAMPLE_STATE, DEFAULT_RULES);
      expect(t, e.type).not.toBeNull();
      expect(`${t!.title} ${t!.body}`).not.toMatch(BANNED);
    }
  });
});
