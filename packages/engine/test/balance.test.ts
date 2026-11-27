/**
 * Balance targets: a separate, tunable suite. It checks a candidate rule set against the design targets
 * using the seeded 52-week harness from a fresh 101 start. Change PROPOSED_RULES, not these targets.
 */
import { describe, expect, it } from "vitest";
import { PROFILES, FRESH_START, balance, simulate } from "./sim";
import { PROPOSED_RULES } from "./tuning";

const SEEDS = [1, 7, 42];
const b = balance(PROPOSED_RULES, { seeds: SEEDS });

describe("balance targets (PROPOSED_RULES)", () => {
  it("health: the consistent player (90%) stays above 70", () => {
    for (const s of b.consistent) expect(s.healthMin).toBeGreaterThan(70);
  });

  it("health: the struggling player (50%) hovers roughly between 35 and 70 after week 12", () => {
    for (const s of b.struggling) {
      expect(s.healthMeanLate).toBeGreaterThanOrEqual(35);
      expect(s.healthMeanLate).toBeLessThanOrEqual(75);
    }
  });

  it("health: the struggling player is knocked down at most 3 times a year", () => {
    for (const s of b.struggling) expect(s.knockedDown).toBeLessThanOrEqual(3);
  });

  it("health: the collapse player enters Recovery and gets back out above 30 health", () => {
    for (const seed of SEEDS) {
      const days = simulate(PROFILES.collapse, seed, { config: PROPOSED_RULES, start: FRESH_START }).filter((s) => s.kind === "day");
      const started = days.findIndex((s) => s.events.some((e) => e.type === "recovery_started"));
      expect(started).toBeGreaterThan(-1);
      expect(days.slice(started).some((s) => s.state.recovery === null && s.state.character.health > 30)).toBe(true);
    }
  });

  it("setbacks: the struggling player takes at most about 1 a week", () => {
    for (const s of b.struggling) expect(s.setbacksPerWeek).toBeLessThanOrEqual(1);
  });

  it("strength: the consistent player reaches about 85 after 12 weeks, not before week 6", () => {
    for (const s of b.consistent) {
      expect(s.strengthDay42!).toBeLessThan(85);
      expect(s.strengthDay84!).toBeGreaterThanOrEqual(80);
      expect(s.strengthDay84!).toBeLessThanOrEqual(90);
    }
  });

  it("strength: the struggling player sits around 45 to 60", () => {
    for (const s of b.struggling) {
      expect(s.strengthMeanLate).toBeGreaterThanOrEqual(45);
      expect(s.strengthMeanLate).toBeLessThanOrEqual(60);
    }
  });

  it("strength: a month of misses drops it by at least 20", () => {
    for (const s of b.collapse) expect(s.strengthDrop61to91).toBeGreaterThanOrEqual(20);
  });
  it("pacing: 101 takes about 3 to 4 months at 90%, and each later level takes longer than the one before", () => {
    // Two years, so the consistent player can reach 501.
    for (const s of balance(PROPOSED_RULES, { seeds: SEEDS, days: 728 }).consistent) {
      const at = [1, s.reached[2], s.reached[3], s.reached[4], s.reached[5]];
      expect(at.every((d) => d !== null)).toBe(true);
      const spans = at.slice(1).map((d, i) => d! - at[i]!);
      expect(spans[0]).toBeGreaterThanOrEqual(80);
      expect(spans[0]).toBeLessThanOrEqual(125);
      for (let i = 1; i < spans.length; i++) expect(spans[i]!).toBeGreaterThan(spans[i - 1]!);
    }
  });
});
