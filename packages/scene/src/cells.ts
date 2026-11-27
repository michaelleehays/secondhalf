import type { CellView, GoalStatus } from "@second-half/contracts";
import { CELL_COUNT, cellIndex } from "./layout";

/**
 * How one terrain cell looks. Pure presentation: it reads a CellView and never decides status.
 *
 * The mountain is monochrome rock; a cell's state shows through light and linework, not colour:
 * - claimed (locked in) ground is a little brighter, with brighter boundary lines (and a flag, drawn elsewhere)
 * - worked ground brightens over the share of the slice already done
 * - unexplored ground (hidden, or above the player's level) sits under a light haze with faint lines
 * - at risk keeps a restrained red pulse, the one accent; lost ground is darkened
 */
export interface CellLook {
  /** Overall brightness multiplier. */
  brightness: number;
  /** 0..1 share of the slice (by angle) counted as done. */
  progress: number;
  /** Extra brightness over the done share (multiplier, 1 = none). */
  doneLift: number;
  /** 0..1 light haze over unexplored ground. */
  haze: number;
  /** 0..1 strength of this cell's boundary lines (ridges and rings). */
  lines: number;
  /** 0..1 amplitude of the red risk pulse. */
  riskPulse: number;
  /** Claimed ground: gets a flag. */
  claimed: boolean;
}

const BASE: CellLook = { brightness: 1, progress: 0, doneLift: 1, haze: 0, lines: 0.6, riskPulse: 0, claimed: false };

const LOOK: Record<GoalStatus, (c: CellView) => Partial<CellLook>> = {
  locked_in: () => ({ brightness: 1.12, progress: 1, lines: 1, claimed: true }),
  in_progress: (c) => ({ progress: clamp01(c.progress), doneLift: 1.12, lines: 0.75 }),
  // At risk pulses harder the closer it is to lost.
  at_risk: (c) => ({ brightness: 1.05, progress: 1, lines: 0.8, riskPulse: 0.4 + 0.6 * clamp01(c.risk / 100) }),
  lost: () => ({ brightness: 0.72, lines: 0.5 }),
  open: () => ({}),
  hidden: () => ({ brightness: 0.85, haze: 0.55, lines: 0.25 }),
};

/** Frozen cells (above the player's level) read as unexplored: hazed, with fainter lines. */
const FROZEN = { haze: 0.35, lines: 0.6 };

export function cellLook(cell: CellView): CellLook {
  const look: CellLook = { ...BASE, ...LOOK[cell.status](cell) };
  if (cell.frozen) {
    look.haze = Math.max(look.haze, FROZEN.haze);
    look.lines *= FROZEN.lines;
  }
  return look;
}

const HIDDEN: CellView = { goalId: "", area: "body", level: 1, status: "hidden", progress: 0, risk: 0, frozen: false };

/**
 * Looks for all 20 cells in shader order (see cellIndex). Cells missing from the view draw as hidden.
 * If a view repeats a cell, the last one wins.
 */
export function cellLooks(cells: readonly CellView[]): CellLook[] {
  const out: CellLook[] = Array.from({ length: CELL_COUNT }, () => cellLook(HIDDEN));
  for (const c of cells) out[cellIndex(c.area, c.level)] = cellLook(c);
  return out;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
