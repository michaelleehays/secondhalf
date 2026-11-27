import { AREAS, type CellView, type GoalStatus } from "@second-half/contracts";
import { CELL_COUNT, cellIndex } from "./layout";

/**
 * How one terrain cell looks. Pure presentation: it reads a CellView and never decides status.
 *
 * The shader paints the area colour over the first `progress` of the sector at `fill` strength,
 * and over the rest at `restFill`. Then it multiplies by `brightness` and pulses red by `riskPulse`.
 */
export interface CellLook {
  /** Use the "lost" colour instead of the area colour. */
  tint: "area" | "lost";
  /** 0..1 strength of the tint over the done part. */
  fill: number;
  /** 0..1 share of the sector (by angle) counted as done. */
  progress: number;
  /** 0..1 strength of the tint over the rest of the sector. */
  restFill: number;
  /** 0..1 amplitude of the red risk pulse. */
  riskPulse: number;
  /** Overall brightness multiplier. */
  brightness: number;
}

const LOOK: Record<GoalStatus, (c: CellView) => CellLook> = {
  locked_in: () => ({ tint: "area", fill: 0.62, progress: 1, restFill: 0.62, riskPulse: 0, brightness: 1 }),
  in_progress: (c) => ({ tint: "area", fill: 0.55, progress: clamp01(c.progress), restFill: 0.12, riskPulse: 0, brightness: 1 }),
  // At risk keeps its colour but weaker, and pulses harder the closer it is to lost.
  at_risk: (c) => ({ tint: "area", fill: 0.38, progress: 1, restFill: 0.38, riskPulse: 0.4 + 0.6 * clamp01(c.risk / 100), brightness: 1 }),
  lost: () => ({ tint: "lost", fill: 0.6, progress: 1, restFill: 0.6, riskPulse: 0, brightness: 1 }),
  open: () => ({ tint: "area", fill: 0, progress: 0, restFill: 0, riskPulse: 0, brightness: 1.05 }),
  hidden: () => ({ tint: "area", fill: 0, progress: 0, restFill: 0, riskPulse: 0, brightness: 0.34 }),
};

/** Frozen cells (above the player's level) keep their colour but sit in shadow. */
const FROZEN_DIM = 0.55;
/** Area colours are darkened before tinting so the terrain stays readable. */
export const AREA_TINT_SCALE = 0.62;

export function cellLook(cell: CellView): CellLook {
  const look = LOOK[cell.status](cell);
  return cell.frozen ? { ...look, brightness: look.brightness * FROZEN_DIM } : look;
}

const HIDDEN: CellView = { area: "body", level: 1, status: "hidden", progress: 0, risk: 0, frozen: false };

/**
 * Looks for all 20 cells in shader order (see cellIndex). Cells missing from the view draw as hidden.
 * If a view repeats a cell, the last one wins.
 */
export function cellLooks(cells: readonly CellView[]): CellLook[] {
  const out: CellLook[] = Array.from({ length: CELL_COUNT }, () => cellLook(HIDDEN));
  for (const c of cells) out[cellIndex(c.area, c.level)] = cellLook(c);
  return out;
}

/** Area for a shader cell index. */
export function areaOfIndex(i: number) {
  return AREAS[i % AREAS.length]!;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
