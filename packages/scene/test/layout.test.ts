import { describe, expect, it } from "vitest";
import { AREAS } from "@second-half/contracts";
import { CELL_COUNT, RING_OUTER, SECTOR_SPAN_DEG, SECTOR_START_DEG, athleteSpot, cellIndex, heightAt, ringAt, sectorAt } from "../src/layout";

describe("layout", () => {
  it("maps radii to rings from 101 outside to The Vision at the summit", () => {
    expect(ringAt(25)).toBe(0);
    expect(ringAt(20)).toBe(1);
    expect(ringAt(12)).toBe(2);
    expect(ringAt(8)).toBe(3);
    expect(ringAt(5)).toBe(4);
    expect(ringAt(1)).toBe(5);
  });

  it("finds each area in the middle of its own sector", () => {
    for (const area of AREAS) {
      const a = ((SECTOR_START_DEG[area] + SECTOR_SPAN_DEG / 2) * Math.PI) / 180;
      const hit = sectorAt(Math.sin(a) * 10, Math.cos(a) * 10);
      expect(hit.area).toBe(area);
      expect(hit.frac).toBeCloseTo(0.5);
    }
  });

  it("puts Body straight in front of the home camera", () => {
    expect(sectorAt(0, 10).area).toBe("body");
  });

  it("gives every area and level its own cell index", () => {
    const seen = new Set<number>();
    for (const area of AREAS) for (const level of [1, 2, 3, 4] as const) seen.add(cellIndex(area, level));
    expect(seen.size).toBe(CELL_COUNT);
    expect(Math.max(...seen)).toBe(CELL_COUNT - 1);
  });

  it("rises toward the summit", () => {
    expect(heightAt(0, 0)).toBeGreaterThan(heightAt(0, 10));
    expect(heightAt(0, 10)).toBeGreaterThan(heightAt(0, 20));
  });

  it("stands the athlete just outside the current level's ring", () => {
    const [x, , z] = athleteSpot(2);
    expect(ringAt(Math.hypot(x, z))).toBe(1);
    expect(Math.hypot(x, z)).toBeGreaterThan(RING_OUTER[1]);
  });
});
