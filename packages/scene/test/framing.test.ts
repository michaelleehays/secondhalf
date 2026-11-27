import { describe, expect, it } from "vitest";
import { ASSUMED_SHEET, NO_INSETS, athleteDistance, freeRect, subjectRect, viewOffset } from "../src/framing";

describe("framing", () => {
  it("finds the free area beside a right-side sheet and centres the subject in it", () => {
    const r = freeRect(1280, 800, { top: 0, right: 480, bottom: 0, left: 0 });
    expect(r).toEqual({ x: 0, y: 0, w: 800, h: 800 });
    const off = viewOffset(1280, 800, r);
    expect(off).toEqual({ x: 240, y: 0 }); // image moves left by 240 px: subject at x = 400
  });

  it("finds the free area above a bottom sheet", () => {
    const r = freeRect(390, 844, { top: 0, right: 0, bottom: 500, left: 0 });
    expect(r.h).toBe(344);
    expect(viewOffset(390, 844, r).y).toBe(844 / 2 - 172);
  });

  it("keeps at least a quarter of the screen free", () => {
    const r = freeRect(400, 800, { top: 0, right: 0, bottom: 800, left: 0 });
    expect(r.h).toBeCloseTo(200);
  });

  it("assumes a bottom sheet for focused shots when the app reports no insets; home is whole-screen", () => {
    expect(subjectRect(390, 844, NO_INSETS, true).h).toBeCloseTo(844 * (1 - ASSUMED_SHEET));
    expect(subjectRect(390, 844, NO_INSETS, false)).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(subjectRect(1280, 800, { top: 0, right: 480, bottom: 0, left: 0 }, true).w).toBe(800);
  });

  it("pulls the athlete in to fill the free area, and backs off when it's small", () => {
    const full = athleteDistance(42, 16 / 9, 1, 1, false);
    const small = athleteDistance(42, 390 / 844, 0.4, 1, false);
    expect(full).toBeLessThan(4);
    expect(small).toBeGreaterThan(full * 2);
    // The figure (2.3 m) fits the free height at that distance.
    const visibleH = 2 * Math.tan((21 * Math.PI) / 180) * 0.4 * small;
    expect(visibleH).toBeGreaterThanOrEqual(2.3 - 1e-6);
  });
});
