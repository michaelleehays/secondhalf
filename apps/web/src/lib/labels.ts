import type { AreaId, GoalStatus, Level, ResistanceId } from "@second-half/contracts";

/**
 * Display names for the five areas. Areas have no colour of their own: the scene is monochrome with
 * carved section lines and labels, so the app names areas and colours only by status.
 */
export const AREA_META: Record<AreaId, { name: string }> = {
  body: { name: "Body" },
  mind: { name: "Mind" },
  work: { name: "Work" },
  people: { name: "People" },
  money: { name: "Money" },
};

/** Status colours, as CSS custom properties from globals.css. */
export const STATUS_COLOR: Record<GoalStatus, string> = {
  locked_in: "var(--ok)",
  in_progress: "var(--signal)",
  at_risk: "var(--risk)",
  lost: "var(--risk)",
  open: "var(--muted)",
  hidden: "var(--line)",
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
