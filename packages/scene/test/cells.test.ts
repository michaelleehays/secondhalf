import { describe, expect, it } from "vitest";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import type { CellView } from "@second-half/contracts";
import { toWorldView } from "@second-half/engine";
import { cellLook, cellLooks } from "../src/cells";
import { cellIndex } from "../src/layout";

const cell = (over: Partial<CellView>): CellView => ({ goalId: "body-101", area: "body", level: 1, status: "open", progress: 0, risk: 0, frozen: false, ...over });

describe("cellLook (monochrome)", () => {
  it("reads claimed ground as brighter, with brighter lines and a flag", () => {
    const open = cellLook(cell({ status: "open" }));
    const claimed = cellLook(cell({ status: "locked_in", progress: 1 }));
    expect(claimed.claimed).toBe(true);
    expect(claimed.brightness).toBeGreaterThan(open.brightness);
    expect(claimed.lines).toBeGreaterThan(open.lines);
    expect(open.claimed).toBe(false);
  });

  it("brightens the worked share of an in-progress slice", () => {
    const look = cellLook(cell({ status: "in_progress", progress: 0.4 }));
    expect(look.progress).toBe(0.4);
    expect(look.doneLift).toBeGreaterThan(1);
    expect(cellLook(cell({ status: "in_progress", progress: 3 })).progress).toBe(1);
  });

  it("keeps the red pulse for at risk, stronger with risk", () => {
    const low = cellLook(cell({ status: "at_risk", risk: 10 })).riskPulse;
    const high = cellLook(cell({ status: "at_risk", risk: 90 })).riskPulse;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
    expect(cellLook(cell({ status: "locked_in" })).riskPulse).toBe(0);
  });

  it("hazes unexplored ground (hidden or frozen) and fades its lines", () => {
    const open = cellLook(cell({ status: "open" }));
    const hidden = cellLook(cell({ status: "hidden" }));
    const frozen = cellLook(cell({ status: "open", frozen: true }));
    expect(hidden.haze).toBeGreaterThan(0);
    expect(frozen.haze).toBeGreaterThan(0);
    expect(hidden.lines).toBeLessThan(open.lines);
    expect(frozen.lines).toBeLessThan(open.lines);
    expect(open.haze).toBe(0);
  });

  it("darkens lost ground", () => {
    expect(cellLook(cell({ status: "lost" })).brightness).toBeLessThan(1);
  });
});

describe("cellLooks from the sample player", () => {
  const looks = cellLooks(toWorldView(SAMPLE_STATE).cells);

  it("returns all 20 cells in shader order", () => {
    expect(looks).toHaveLength(20);
    expect(looks[cellIndex("money", 1)]!.riskPulse).toBeGreaterThan(0);
    expect(looks[cellIndex("body", 1)]!.claimed).toBe(true);
    expect(looks[cellIndex("body", 2)]!.progress).toBe(0.4);
  });

  it("draws cells missing from the view as hidden", () => {
    const sparse = cellLooks([cell({ status: "locked_in" })]);
    expect(sparse[cellIndex("mind", 3)]).toEqual(cellLook(cell({ status: "hidden" })));
  });
});
