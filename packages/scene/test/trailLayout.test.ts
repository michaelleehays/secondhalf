import { describe, expect, it } from "vitest";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { AREAS } from "@second-half/contracts";
import { RING_OUTER, ringAt, sectorAt } from "../src/layout";
import { band, climbedDistance, distAtRadius, markerFor, placeMoments, pointAt, stopDistance, trailPath, TRAIL_END_R, TRAIL_START_R } from "../src/trailLayout";
import { sampleTrail } from "../demo/trailFixture";

describe("trailPath", () => {
  it("climbs every section from the base to the Vision without leaving its slice", () => {
    for (const area of AREAS) {
      const p = trailPath(area);
      const n = p.radius.length;
      expect(p.radius[0]).toBeCloseTo(TRAIL_START_R, 5);
      expect(p.radius[n - 1]).toBeCloseTo(TRAIL_END_R, 5);
      for (let i = 0; i < n; i++) {
        const x = p.points[i * 3]!;
        const z = p.points[i * 3 + 2]!;
        expect(sectorAt(x, z).area).toBe(area);
        if (i > 0) expect(p.dist[i]!).toBeGreaterThan(p.dist[i - 1]!);
      }
      // Switchbacks make it longer than a straight line up.
      expect(p.length).toBeGreaterThan(TRAIL_START_R - TRAIL_END_R);
    }
  });

  it("maps radius to distance and back", () => {
    const p = trailPath("mind");
    expect(distAtRadius(p, 99)).toBe(0);
    expect(distAtRadius(p, 0)).toBe(p.length);
    const s = distAtRadius(p, 12);
    const [x, , z] = pointAt(p, s);
    expect(Math.hypot(x, z)).toBeCloseTo(12, 1);
    expect(ringAt(Math.hypot(...pointAt(p, stopDistance(p, 2)).filter((_, i) => i !== 1) as [number, number]))).toBe(2);
  });
});

describe("climbedDistance", () => {
  const trail = sampleTrail(SAMPLE_STATE, "body");
  const p = trailPath("body");

  it("stops part-way up the first level not locked in (sample: Body 201 at 40%)", () => {
    const s = climbedDistance(trail, p);
    const { bottom, top } = band(2);
    expect(s).toBeCloseTo(distAtRadius(p, bottom - (bottom - top) * 0.4), 5);
  });

  it("covers the whole trail once every level is locked in, and none before 101 starts", () => {
    expect(climbedDistance({ ...trail, stops: trail.stops.map((s) => ({ ...s, status: "locked_in" as const })) }, p)).toBe(p.length);
    const fresh = { ...trail, stops: trail.stops.map((s) => ({ ...s, status: "open" as const, progress: 0 })) };
    expect(climbedDistance(fresh, p)).toBeCloseTo(distAtRadius(p, RING_OUTER[0]), 5);
  });
});

describe("placeMoments", () => {
  const trail = sampleTrail(SAMPLE_STATE, "body");
  const p = trailPath("body");
  const placed = placeMoments(trail, p);

  it("puts each moment in its goal's band, oldest lowest, never above the climbed point", () => {
    expect(placed).toHaveLength(trail.moments.length);
    const climbed = climbedDistance(trail, p);
    for (const m of placed) expect(m.s).toBeLessThanOrEqual(climbed + 1e-6);
    const in101 = placed.filter((m) => m.s < distAtRadius(p, RING_OUTER[1]));
    expect(in101.map((m) => m.date)).toEqual([...in101.map((m) => m.date)].sort());
  });

  it("marks locked in and verified with flags, setbacks in red", () => {
    expect(markerFor("locked_in")).toBe("flag");
    expect(markerFor("verified")).toBe("flag");
    expect(markerFor("setback")).toBe("setback");
    expect(markerFor("ground_lost")).toBe("ground_lost");
    expect(placed.filter((m) => m.kind === "setback")).toHaveLength(2);
  });

  it("leaves off moments without a goal on this trail", () => {
    const extra = { ...trail, moments: [...trail.moments, { date: "2026-11-20", kind: "level_up" as const, label: "Level 201" }] };
    expect(placeMoments(extra, p)).toHaveLength(trail.moments.length);
  });
});
