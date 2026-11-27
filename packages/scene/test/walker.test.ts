import { describe, expect, it } from "vitest";
import { WALK_SPEED, Walker } from "../src/walker";

describe("Walker", () => {
  it("walks to a new goal at walking pace, then stops and turns back to the camera", () => {
    const w = new Walker();
    w.place(0, 15.4);
    w.setGoal(0, 10.9);
    w.step(0.05);
    expect(w.moving).toBe(true);
    let t = 0.05;
    while (w.moving && t < 20) {
      w.step(0.05);
      t += 0.05;
      if (t > 1) {
        expect(w.walk).toBeGreaterThan(0.9);
        // Facing uphill (toward -z) while walking there.
        expect(Math.abs(Math.abs(w.facing) - Math.PI)).toBeLessThan(0.4);
      }
    }
    expect(t).toBeGreaterThan(4.5 / WALK_SPEED);
    expect(w.z).toBeCloseTo(10.9);
    for (let i = 0; i < 100; i++) w.step(0.05);
    expect(w.walk).toBe(0);
    expect(Math.abs(w.facing)).toBeLessThan(0.05);
  });

  it("place jumps without walking", () => {
    const w = new Walker();
    w.place(1, 2);
    w.step(0.05);
    expect([w.x, w.z, w.walk]).toEqual([1, 2, 0]);
  });
});
