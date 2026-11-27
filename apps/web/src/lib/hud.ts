import type { AreaId, AreaMode, GameState, Habit, IsoDate, Level, RulesConfig } from "@second-half/contracts";
import { AREA_META, LEVEL_NAMES, levelCode } from "./labels";

const DAY_MS = 864e5;

/** Whole days from `date` (default: `state.today`) to the start of the year the player turns `endAge`. Same basis as the engine's weeksLeft. */
export function daysLeft(state: GameState, date: IsoDate = state.today): number {
  const end = Date.UTC(state.birthYear + state.endAge, 0, 1);
  const now = Date.parse(`${date}T00:00:00Z`);
  return Math.max(0, Math.floor((end - now) / DAY_MS));
}

/** Health below this shows the meter in the warning color. A display choice, not a game rule. */
export const HEALTH_WARN_BELOW = 50;

export type Tone = "ok" | "warn" | "bad";

export interface HudModel {
  levelCode: string;
  levelName: string;
  score: number;
  credits: number;
  daysLeft: number;
  health: number;
  healthMax: number;
  healthTone: Tone;
  strength: number;
  strengthMax: number;
  atRisk: { goalId: string; area: AreaId; label: string; risk: number }[];
  recovery: { day: number; of: number } | null;
}

/** The player's name for a level, or the default. */
export const levelName = (state: GameState, level: Level): string => state.levelNames?.[level]?.trim() || LEVEL_NAMES[level];

export function hudModel(state: GameState, rules: RulesConfig, date: IsoDate = state.today): HudModel {
  const { health, strength } = state.character;
  const healthTone: Tone = health < rules.recovery.healthBelow ? "bad" : health < HEALTH_WARN_BELOW ? "warn" : "ok";
  return {
    levelCode: levelCode(state.level),
    levelName: levelName(state, state.level),
    score: state.score,
    credits: state.credits,
    daysLeft: daysLeft(state, date),
    health: Math.round(health),
    healthMax: rules.health.max,
    healthTone,
    strength: Math.round(strength),
    strengthMax: rules.strength.max,
    atRisk: state.goals
      .filter((g) => g.status === "at_risk")
      .map((g) => ({ goalId: g.id, area: g.area, label: `${AREA_META[g.area].name} ${levelCode(g.level)}`, risk: Math.round(g.risk) })),
    recovery: state.recovery ? { day: state.recovery.day, of: rules.recovery.days } : null,
  };
}

/** Habits that ask for a check-in tonight: any habit whose area mode has a weekly target above zero. */
export function activeHabits(state: GameState): Habit[] {
  if (state.recovery) {
    // The engine names the recovery habit "<title>: <minimum dose>".
    const title = state.recovery.habitTitle;
    const match = state.habits.find((h) => title === h.title || title.startsWith(`${h.title}: `));
    return match ? [match] : activeHabits({ ...state, recovery: null }).slice(0, 1);
  }
  return state.habits.filter((h) => {
    const mode: AreaMode = state.modes[h.area];
    return h.weeklyTarget[mode] > 0;
  });
}
