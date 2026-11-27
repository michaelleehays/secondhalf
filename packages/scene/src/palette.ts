import type { AreaId } from "@second-half/contracts";

/** Area colours (sRGB hex), shared with the app's UI. */
export const AREA_HEX: Record<AreaId, string> = {
  body: "#58C27D",
  mind: "#9C8CF0",
  work: "#4FA3E8",
  people: "#F08A5D",
  money: "#E8C15A",
};

/** Terrain and sky colours (sRGB hex). The mountain is monochrome: rock, snow and lines. */
export const WORLD_HEX = {
  sky: "#10141a",
  groundLow: "#3a3936",
  groundHigh: "#5f5d58",
  snow: "#d6d3cc",
  plain: "#16181b",
  vision: "#77736a",
  /** Haze over unexplored ground. */
  haze: "#7d848f",
  /** Ridge and ring lines. */
  ridgeLine: "#e8e4da",
  /** The one accent: risk, setbacks, Resistance. */
  risk: "#f2293a",
  summit: "#E8C15A",
  /** Claimed-ground flags and trail markers. */
  flag: "#f1efea",
} as const;
