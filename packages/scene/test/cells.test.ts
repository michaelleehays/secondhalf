import { describe, expect, it } from "vitest";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import type { CellView } from "@second-half/contracts";
import { toWorldView } from "@second-half/engine";
import { cellLook, cellLooks } from "../src/cells";
import { cellIndex } from "../src/layout";

const cell = (over: Partial<CellView>): CellView => ({ goalId: "body-101", area: "body", level: 1, status: "open", progress: 0, risk: 0, frozen: false, ...over });

describe("cellLook", () => {
  it("fills locked-in cells fully", () => {
    const look = cellLook(cell({ status: "locked_in", progress: 1 }));
    expect(look.progress).toBe(1);
    expect(look.fill).toBeGreaterThan(0.5);
    expect(look.riskPulse).toBe(0);
  });

  it("sweeps in-progress cells by progress", () => {
    expect(cellLook(cell({ status: "in_progress", progress: 0.4 })).progress).toBe(0.4);
    expect(cellLook(cell({ status: "in_progress", progress: 3 })).progress).toBe(1);
  });

  it("pulses harder the higher the risk", () => {
    const low = cellLook(cell({ status: "at_risk", risk: 10 })).riskPulse;
    const high = cellLook(cell({ status: "at_risk", risk: 90 })).riskPulse;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it("dims frozen and hidden cells", () => {
    const open = cellLook(cell({ status: "open" })).brightness;
    expect(cellLook(cell({ status: "open", frozen: true })).brightness).toBeLessThan(open);
    expect(cellLook(cell({ status: "hidden" })).brightness).toBeLessThan(open);
    expect(cellLook(cell({ status: "hidden" })).fill).toBe(0);
  });

  it("uses the lost tint for lost ground", () => {
    expect(cellLook(cell({ status: "lost" })).tint).toBe("lost");
  });
});

describe("cellLooks from the sample player", () => {
  const looks = cellLooks(toWorldView(SAMPLE_STATE).cells);

  it("returns all 20 cells in shader order", () => {
    expect(looks).toHaveLength(20);
    expect(looks[cellIndex("money", 1)]!.riskPulse).toBeGreaterThan(0);
    expect(looks[cellIndex("body", 1)]!.progress).toBe(1);
    expect(looks[cellIndex("body", 2)]!.progress).toBe(0.4);
  });

  it("draws cells missing from the view as hidden", () => {
    const sparse = cellLooks([cell({ status: "locked_in" })]);
    expect(sparse[cellIndex("mind", 3)]).toEqual(cellLook(cell({ status: "hidden" })));
  });
});
