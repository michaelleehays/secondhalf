import type { AreaId, Level, ResistanceId } from "@second-half/contracts";

/** Display names and colors for the five areas. Colors match the home screen prototype. */
export const AREA_META: Record<AreaId, { name: string; color: string }> = {
  body: { name: "Body", color: "#58C27D" },
  mind: { name: "Mind", color: "#9C8CF0" },
  work: { name: "Work", color: "#4FA3E8" },
  people: { name: "People", color: "#F08A5D" },
  money: { name: "Money", color: "#E8C15A" },
};

export const LEVEL_NAMES: Record<Level, string> = {
  1: "Foundations",
  2: "Momentum",
  3: "Mastery",
  4: "Legacy",
  5: "The Vision",
};

/** "201" for level 2. */
export const levelCode = (level: Level): string => `${level}01`;

/** Resistance names and the one-tap reason the player picks at check-in. Order is the order shown. */
export const RESISTANCE_META: Record<ResistanceId, { name: string; reason: string }> = {
  fatigue: { name: "Fatigue", reason: "Too tired" },
  no_time: { name: "No Time", reason: "No time" },
  temptation: { name: "Temptation", reason: "Tempted" },
  stress: { name: "Stress", reason: "Stressed" },
  avoidance: { name: "Avoidance", reason: "Avoided it" },
};

export const RESISTANCE_ORDER: readonly ResistanceId[] = ["fatigue", "no_time", "temptation", "stress", "avoidance"];

const nf = new Intl.NumberFormat("en-US");
export const fmt = (n: number): string => nf.format(Math.round(n));

/** "+12" / "−6" with a real minus sign. */
export const signed = (n: number): string => (n < 0 ? `−${fmt(-n)}` : `+${fmt(n)}`);
