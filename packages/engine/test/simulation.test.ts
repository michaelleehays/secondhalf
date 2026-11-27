import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type GameState, type GoalStatus } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { PROFILES, simulate, summary, type Step } from "./sim";

const STATUSES: GoalStatus[] = ["hidden", "open", "in_progress", "locked_in", "at_risk", "lost"];
const SEEDS = [1, 7, 42];

function checkInvariants(step: Step) {
  const s: GameState = step.state;
  const where = `${step.kind} ${step.date}`;
  expect(s.character.health, where).toBeGreaterThanOrEqual(0);
  expect(s.character.health, where).toBeLessThanOrEqual(R.health.max);
  expect(s.character.strength, where).toBeGreaterThanOrEqual(0);
  expect(s.character.strength, where).toBeLessThanOrEqual(R.strength.max);
  expect(s.credits, where).toBeGreaterThanOrEqual(0);
  expect(s.score, where).toBeGreaterThanOrEqual(step.before.score);
  expect([1, 2, 3, 4, 5], where).toContain(s.level);
  if (s.recovery) {
    expect(["auto", "life_event"], where).toContain(s.recovery.cause);
    expect(s.recovery.day, where).toBeGreaterThanOrEqual(1);
    expect(s.recovery.day, where).toBeLessThanOrEqual(R.recovery.days);
    expect(s.recovery.daysDone, where).toBeLessThan(R.recovery.daysNeeded);
  }
  expect(step.events.filter((e) => e.type === "recovery_started").length, where).toBeLessThanOrEqual(1);
  for (const g of s.goals) {
    expect(STATUSES, `${where} ${g.id}`).toContain(g.status);
    expect(g.risk, `${where} ${g.id}`).toBeGreaterThanOrEqual(0);
    expect(g.risk, `${where} ${g.id}`).toBeLessThanOrEqual(100);
    expect(g.progress, `${where} ${g.id}`).toBeGreaterThanOrEqual(0);
    expect(g.progress, `${where} ${g.id}`).toBeLessThanOrEqual(1);
  }
  for (const h of s.habits) {
    expect(h.history.length, `${where} ${h.id}`).toBeLessThanOrEqual(R.history.days);
  }
  for (const r of Object.values(s.resistance)) {
    expect(r.strength, `${where} ${r.id}`).toBeGreaterThanOrEqual(1);
    expect(r.strength, `${where} ${r.id}`).toBeLessThanOrEqual(R.resistance.max);
  }
}

const runs = Object.fromEntries(
  (Object.keys(PROFILES) as (keyof typeof PROFILES)[]).map((name) => [name, SEEDS.map((seed) => simulate(PROFILES[name], seed))]),
) as Record<keyof typeof PROFILES, Step[][]>;


describe("52-week simulation", () => {
  for (const [name, list] of Object.entries(runs)) {
    it(`invariants hold every day for the ${name} player`, () => {
      for (const steps of list) {
        expect(steps.filter((s) => s.kind === "day")).toHaveLength(364);
        steps.forEach(checkInvariants);
      }
    });
  }

  it("consistent player ends the year at a higher level than they started", () => {
    for (const steps of runs.consistent) expect(steps.at(-1)!.state.level).toBeGreaterThan(SAMPLE_STATE.level);
  });

  it("collapse player triggers Recovery, then gets back above 30 health", () => {
    for (const steps of runs.collapse) {
      const started = steps.findIndex((s) => s.events.some((e) => e.type === "recovery_started"));
      expect(started).toBeGreaterThan(-1);
      expect(steps.slice(started).some((s) => s.state.character.health > 30)).toBe(true);
    }
  });

  it("struggling player never takes a setback from the same Resistance two days running", () => {
    for (const steps of runs.struggling) {
      const days = steps.filter((s) => s.kind === "day");
      for (let i = 1; i < days.length; i++) {
        const today = days[i]!.events.flatMap((e) => (e.type === "setback" ? [e.resistance] : []));
        const yesterday = days[i - 1]!.events.flatMap((e) => (e.type === "setback" ? [e.resistance] : []));
        for (const id of today) expect(yesterday, `${days[i]!.date} ${id}`).not.toContain(id);
      }
    }
  });

  it("the simulation is deterministic for a seed", () => {
    expect(summary(simulate(PROFILES.struggling, 7))).toEqual(summary(runs.struggling[1]!));
  });
});
