import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type CheckInEntry, type GameState, type HabitDay, type ResistanceId, type RuleAdjustment } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay } from "../src/index";

// 2026-11-27 is a Friday; 2026-11-20 is the Friday before.
const DATE = "2026-11-27";
const day = (state: GameState, ...entries: CheckInEntry[]) => closeDay(state, { date: DATE, entries });
const full = (habitId: string): CheckInEntry => ({ habitId, result: "full" });
const minimum = (habitId: string): CheckInEntry => ({ habitId, result: "minimum" });
const missed = (habitId: string, reason: ResistanceId): CheckInEntry => ({ habitId, result: "missed", reason });

const withResistance = (state: GameState, id: ResistanceId, strength: number): GameState => ({
  ...state,
  resistance: { ...state.resistance, [id]: { ...state.resistance[id], strength } },
});
const withHistory = (state: GameState, habitId: string, history: HabitDay[]): GameState => ({
  ...state,
  habits: state.habits.map((h) => (h.id === habitId ? { ...h, history } : h)),
});
const noGrace: GameState = { ...SAMPLE_STATE, character: { ...SAMPLE_STATE.character, graceDaysLeft: 0 } };
const healthEvents = (events: ReturnType<typeof day>["events"]) => events.filter((e) => e.type === "health_changed");

describe("Resistance", () => {
  it("a reported reason raises that Resistance's strength by 1", () => {
    // Sample: fatigue at 2.
    const { state, events } = day(SAMPLE_STATE, missed("run", "fatigue"));
    expect(state.resistance.fatigue.strength).toBe(3);
    expect(events).toContainEqual({ type: "resistance_changed", id: "fatigue", strength: 3 });
  });

  it("a reason given counts also on misses a grace day absorbs", () => {
    const { state } = day(SAMPLE_STATE, missed("run", "fatigue"));
    expect(state.character.graceDaysLeft).toBe(SAMPLE_STATE.character.graceDaysLeft - 1);
    expect(state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength + 1);
  });

  it("a Resistance gains at most 1 a night, however many habits report it", () => {
    const { state, events } = day(SAMPLE_STATE, missed("run", "fatigue"), missed("meditate", "fatigue"), missed("deep-work", "fatigue"));
    expect(state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength + 1);
    expect(events.filter((e) => e.type === "resistance_changed" && e.id === "fatigue")).toHaveLength(1);
  });

  it("after a setback, the next night cannot set back again, however many habits report the reason", () => {
    const first = day(SAMPLE_STATE, missed("no-impulse", "temptation"));
    const second = closeDay(first.state, { date: "2026-11-28", entries: [missed("no-impulse", "temptation"), missed("run", "temptation"), missed("meditate", "temptation")] });
    expect(second.events.some((e) => e.type === "setback")).toBe(false);
    expect(second.state.resistance.temptation.strength).toBe(R.resistance.afterSetback + 1);
  });

  it("strength is capped at resistance.max", () => {
    // Setbacks off (setbackAt above max) so the cap is seen on its own.
    const config = { ...R, resistance: { ...R.resistance, setbackAt: R.resistance.max + 1 } };
    const start = withResistance(SAMPLE_STATE, "stress", R.resistance.max);
    const { state } = closeDay(start, { date: DATE, entries: [missed("meditate", "stress")] }, config);
    expect(state.resistance.stress.strength).toBe(R.resistance.max);
  });

  it("reports14d counts that reason across all habits in the kept history", () => {
    const start = withHistory(SAMPLE_STATE, "run", [{ date: "2026-11-20", result: "missed", reason: "fatigue" }]);
    const { state } = day(start, missed("run", "fatigue"), missed("deep-work", "fatigue"), missed("meditate", "stress"));
    expect(state.resistance.fatigue.reports14d).toBe(3);
    expect(state.resistance.stress.reports14d).toBe(1);
    expect(state.resistance.avoidance.reports14d).toBe(0);
  });

  it("setback: a Resistance reported at setbackAt costs setbackDamage health", () => {
    // Sample: temptation at 5, game plan not equipped.
    const { state, events } = day(noGrace, missed("no-impulse", "temptation"));
    expect(events).toContainEqual({ type: "setback", resistance: "temptation", damage: R.health.setbackDamage });
    expect(healthEvents(events)).toContainEqual({ type: "health_changed", delta: -R.health.setbackDamage, reason: "setback" });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - R.health.missCost - R.health.setbackDamage);
  });

  it("setback: the reaching report causes it (4 to 5)", () => {
    const { events } = day(withResistance(SAMPLE_STATE, "fatigue", R.resistance.setbackAt - 1), missed("run", "fatigue"));
    expect(events).toContainEqual({ type: "setback", resistance: "fatigue", damage: R.health.setbackDamage });
  });

  it("setback: none while the Resistance is below setbackAt, and none without a report that day", () => {
    expect(day(SAMPLE_STATE, missed("run", "fatigue")).events.some((e) => e.type === "setback")).toBe(false);
    expect(day(SAMPLE_STATE, full("run")).events.some((e) => e.type === "setback")).toBe(false);
  });

  it("setback: an equipped game plan for that Resistance halves the damage", () => {
    const equipped: GameState = { ...SAMPLE_STATE, gamePlans: SAMPLE_STATE.gamePlans.map((p) => ({ ...p, equipped: true })) };
    const { state, events } = day(equipped, missed("no-impulse", "temptation"));
    const damage = R.health.setbackDamage * R.resistance.gamePlanDamageFactor;
    expect(events).toContainEqual({ type: "setback", resistance: "temptation", damage });
    expect(state.character.health).toBe(SAMPLE_STATE.character.health - damage);
  });

  it("setback: one per Resistance per day, however many misses report it", () => {
    const { events } = day(noGrace, missed("no-impulse", "temptation"), missed("run", "temptation"));
    expect(events.filter((e) => e.type === "setback")).toHaveLength(1);
  });

  it("doing the habit on a day you'd usually miss knocks that Resistance down by 1", () => {
    const start = withHistory(SAMPLE_STATE, "run", [{ date: "2026-11-20", result: "missed", reason: "fatigue" }]);
    const { state, events } = day(start, minimum("run"));
    expect(state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength - 1);
    expect(events).toContainEqual({ type: "resistance_changed", id: "fatigue", strength: 1 });
  });

  it("doing the habit on another weekday does not knock Resistance down", () => {
    const start = withHistory(SAMPLE_STATE, "run", [{ date: "2026-11-21", result: "missed", reason: "fatigue" }]);
    expect(day(start, full("run")).state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength);
  });

  it("strength never drops below 1", () => {
    const start = withHistory(withResistance(SAMPLE_STATE, "stress", 1), "meditate", [{ date: "2026-11-20", result: "missed", reason: "stress" }]);
    expect(day(start, full("meditate")).state.resistance.stress.strength).toBe(1);
  });

  it("rule adjustment: a setback with no rule in force for that Resistance adjusts the rules for 2 weeks", () => {
    const start = withHistory(SAMPLE_STATE, "no-impulse", [{ date: "2026-11-20", result: "missed", reason: "temptation" }]);
    const { state, events } = day(start, missed("no-impulse", "temptation"));
    const rule: RuleAdjustment = {
      id: "rule-temptation-2026-11-27",
      trigger: "temptation",
      message:
        "Temptation beat you 2 times in 14 days. For the next 2 weeks, the minimum no impulse purchases (logged every purchase) counts as a full one.",
      effect: { kind: "minimum_counts_as_full", habitId: "no-impulse" },
      startsOn: DATE,
      endsOn: "2026-12-11",
    };
    expect(state.rules).toEqual([rule]);
    expect(events).toContainEqual({ type: "rule_adjusted", rule });
  });

  it("rule adjustment message: 1 time, 2 times", () => {
    // Sample temptation is at 5 with no history: tonight's report is its only one.
    const once = day(SAMPLE_STATE, missed("no-impulse", "temptation")).state.rules[0]!.message;
    expect(once).toMatch(/^Temptation beat you 1 time in /);
    const twice = withHistory(SAMPLE_STATE, "no-impulse", [{ date: "2026-11-20", result: "missed", reason: "temptation" }]);
    expect(day(twice, missed("no-impulse", "temptation")).state.rules[0]!.message).toMatch(/^Temptation beat you 2 times in /);
  });

  it("rule adjustment: endsOn is adaptation.ruleWeeks weeks after the check-in", () => {
    const config = { ...R, adaptation: { ...R.adaptation, ruleWeeks: 3 } };
    const { state } = closeDay(SAMPLE_STATE, { date: DATE, entries: [missed("no-impulse", "temptation")] }, config);
    expect(state.rules[0]?.endsOn).toBe("2026-12-18");
    expect(state.rules[0]?.message).toContain("For the next 3 weeks");
  });

  it("after a setback the Resistance drops to afterSetback", () => {
    const { state, events } = day(SAMPLE_STATE, missed("no-impulse", "temptation"));
    expect(state.resistance.temptation.strength).toBe(R.resistance.afterSetback);
    expect(events).toContainEqual({ type: "resistance_changed", id: "temptation", strength: R.resistance.afterSetback });
  });

  it("setbacks do not repeat daily: two days of the same reason at setbackAt cause one setback", () => {
    const first = day(SAMPLE_STATE, missed("no-impulse", "temptation"));
    const second = closeDay(first.state, { date: "2026-11-28", entries: [missed("no-impulse", "temptation")] });
    const setbacks = [...first.events, ...second.events].filter((e) => e.type === "setback");
    expect(setbacks).toHaveLength(1);
    expect(second.state.resistance.temptation.strength).toBe(R.resistance.afterSetback + 1);
  });

  it("rule adjustment: no second rule while one for that Resistance is in force", () => {
    // Setback, then climb back to setbackAt and set back again, all inside the rule's 2 weeks.
    let state = day(SAMPLE_STATE, missed("no-impulse", "temptation")).state;
    const events = [];
    for (const date of ["2026-11-28", "2026-11-29"]) {
      const r = closeDay(state, { date, entries: [missed("no-impulse", "temptation")] });
      state = r.state;
      events.push(...r.events);
    }
    expect(events.some((e) => e.type === "setback")).toBe(true);
    expect(events.some((e) => e.type === "rule_adjusted")).toBe(false);
    expect(state.rules).toHaveLength(1);
  });

  it("rule effect minimum_counts_as_full: a minimum on that habit scores as a full one while the rule is in force", () => {
    const rule: RuleAdjustment = {
      id: "r", trigger: "fatigue", message: "", effect: { kind: "minimum_counts_as_full", habitId: "run" }, startsOn: "2026-11-20", endsOn: "2026-12-04",
    };
    const during = day({ ...SAMPLE_STATE, rules: [rule] }, minimum("run"));
    expect(during.state.score).toBe(SAMPLE_STATE.score + 19);
    expect(during.state.credits).toBe(SAMPLE_STATE.credits + R.credits.habitFull);
    expect(during.state.habits.find((h) => h.id === "run")!.history.at(-1)?.result).toBe("minimum");
    const after = closeDay({ ...SAMPLE_STATE, rules: [rule] }, { date: "2026-12-04", entries: [minimum("run")] });
    expect(after.state.score).toBe(SAMPLE_STATE.score + 8);
  });

  it("rule effect credit_multiplier: credits on that habit are multiplied", () => {
    const rule: RuleAdjustment = {
      id: "r", trigger: "temptation", message: "", effect: { kind: "credit_multiplier", habitId: "no-impulse", multiplier: 2 }, startsOn: DATE, endsOn: "2026-12-11",
    };
    const { state } = day({ ...SAMPLE_STATE, rules: [rule] }, full("no-impulse"));
    expect(state.credits).toBe(SAMPLE_STATE.credits + R.credits.habitFull * 2);
  });

  it("rule effect no_health_loss_on_miss: a miss on that habit costs no health and uses no grace", () => {
    const rule: RuleAdjustment = {
      id: "r", trigger: "fatigue", message: "", effect: { kind: "no_health_loss_on_miss", habitId: "run" }, startsOn: DATE, endsOn: "2026-12-11",
    };
    const { state, events } = day({ ...SAMPLE_STATE, rules: [rule] }, missed("run", "fatigue"));
    expect(state.character.health).toBe(SAMPLE_STATE.character.health);
    expect(state.character.graceDaysLeft).toBe(SAMPLE_STATE.character.graceDaysLeft);
    expect(state.resistance.fatigue.strength).toBe(3);
    expect(events.some((e) => e.type === "grace_used")).toBe(false);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(SAMPLE_STATE);
    const before = structuredClone(input);
    day(input, missed("no-impulse", "temptation"), missed("run", "fatigue"), full("meditate"));
    expect(input).toEqual(before);
  });
});
