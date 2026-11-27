import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, type CheckIn } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createMockAdapter } from "../src/lib/adapter";
import { mockCloseDay } from "../src/lib/mockEngine";
import { toastsForDay } from "../src/lib/messages";

const date = SAMPLE_STATE.today;
const all = (result: "full" | "minimum"): CheckIn => ({ date, entries: SAMPLE_STATE.habits.map((h) => ({ habitId: h.id, result })) });

describe("mock adapter", () => {
  it("loads a copy of SAMPLE_STATE", async () => {
    const a = createMockAdapter();
    const s = await a.load();
    expect(s).toEqual(SAMPLE_STATE);
    expect(s).not.toBe(SAMPLE_STATE);
  });

  it("scores a full day with the level multiplier from the rules", () => {
    const { state, events } = mockCloseDay(SAMPLE_STATE, all("full"), DEFAULT_RULES);
    const n = SAMPLE_STATE.habits.length;
    const pts = Math.round(n * DEFAULT_RULES.points.habitFull * DEFAULT_RULES.levelMultiplier[2]);
    expect(state.score).toBe(SAMPLE_STATE.score + pts);
    expect(state.credits).toBe(SAMPLE_STATE.credits + n * DEFAULT_RULES.credits.habitFull);
    expect(events[0]).toEqual({ type: "points", score: pts, credits: n * DEFAULT_RULES.credits.habitFull, reason: "habit" });
  });

  it("spends grace first, then health, and a reason feeds Resistance to a setback", () => {
    const checkIn: CheckIn = {
      date,
      entries: [
        { habitId: "run", result: "missed", reason: "fatigue" },
        { habitId: "meditate", result: "missed", reason: "stress" },
        { habitId: "deep-work", result: "missed", reason: "no_time" },
        { habitId: "no-impulse", result: "missed", reason: "temptation" },
        { habitId: "reach-out", result: "full" },
      ],
    };
    const { state, events } = mockCloseDay(SAMPLE_STATE, checkIn, DEFAULT_RULES);
    expect(events.filter((e) => e.type === "grace_used")).toHaveLength(2);
    expect(state.character.graceDaysLeft).toBe(0);
    // Temptation is already at 5 in the sample, so a Tempted miss is a setback.
    expect(events).toContainEqual({ type: "setback", resistance: "temptation", damage: DEFAULT_RULES.health.setbackDamage });
    const expected =
      SAMPLE_STATE.character.health + DEFAULT_RULES.health.fullRestore - 2 * DEFAULT_RULES.health.missCost - DEFAULT_RULES.health.setbackDamage;
    expect(state.character.health).toBe(expected);
    expect(state.resistance.fatigue.strength).toBe(SAMPLE_STATE.resistance.fatigue.strength + 1);
  });

  it("never mutates the input state", () => {
    const before = structuredClone(SAMPLE_STATE);
    mockCloseDay(SAMPLE_STATE, all("minimum"), DEFAULT_RULES);
    expect(SAMPLE_STATE).toEqual(before);
  });
});

describe("day-closed messages", () => {
  it("summarises points, credits and grace in one line", () => {
    const checkIn: CheckIn = { date, entries: [{ habitId: "run", result: "full" }, { habitId: "meditate", result: "missed", reason: "stress" }] };
    const { state, events } = mockCloseDay(SAMPLE_STATE, checkIn, DEFAULT_RULES);
    const [summary] = toastsForDay(events, state, DEFAULT_RULES);
    expect(summary).toEqual({ title: "Day closed", body: "+19 points · +10 credits · 1 miss covered by grace.", kind: "good" });
  });

  it("names the Resistance and the health cost on a setback, in coach voice", () => {
    const { state, events } = mockCloseDay(SAMPLE_STATE, { date, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] }, DEFAULT_RULES);
    const setback = toastsForDay(events, state, DEFAULT_RULES).find((t) => t.title === "Setback");
    expect(setback?.body).toMatch(/^Temptation hit strength 5\. That cost you 12 health\./);
  });

  it("uses no castle or fantasy words", () => {
    const banned = /conquer|siege|fallen|enem|attack|counter|shield|armor|gear|gold|party|raid|vanguard|squire|quest|knight/i;
    const { state, events } = mockCloseDay(SAMPLE_STATE, { date, entries: [{ habitId: "no-impulse", result: "missed", reason: "temptation" }] }, DEFAULT_RULES);
    const extra = [
      { type: "locked_in", goalId: "body-101" },
      { type: "at_risk", goalId: "money-101", risk: 60 },
      { type: "ground_lost", goalId: "money-101" },
      { type: "level_lost", level: 1 },
      { type: "level_up", level: 2 },
      { type: "recovery_started", cause: "auto" },
      { type: "knocked_down" },
    ] as const;
    for (const t of toastsForDay([...events, ...extra], state, DEFAULT_RULES)) expect(`${t.title} ${t.body}`).not.toMatch(banned);
  });
});
