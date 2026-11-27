import type { AreaId } from "@second-half/contracts";

/** Area colours (sRGB hex), shared with the app's UI. */
export const AREA_HEX: Record<AreaId, string> = {
  body: "#58C27D",
  mind: "#9C8CF0",
  work: "#4FA3E8",
  people: "#F08A5D",
  money: "#E8C15A",
};

/** Terrain and sky colours (sRGB hex). */
export const WORLD_HEX = {
  sky: "#10141a",
  groundLow: "#262823",
  groundHigh: "#4a4a42",
  snow: "#8c8a82",
  plain: "#121417",
  vision: "#3a3628",
  lost: "#3a1416",
  risk: "#f2293a",
  ringLine: "#ffffff",
  summit: "#E8C15A",
} as const;
