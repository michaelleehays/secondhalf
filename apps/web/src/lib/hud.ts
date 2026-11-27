import type { AreaMode, GameState, Habit, RulesConfig } from "@second-half/contracts";
import { AREA_META, LEVEL_NAMES, levelCode } from "./labels";

const DAY_MS = 864e5;

/** Whole days from `state.today` to the start of the year the player turns `endAge`. Same basis as the engine's weeksLeft. */
export function daysLeft(state: GameState): number {
  const end = Date.UTC(state.birthYear + state.endAge, 0, 1);
  const now = Date.parse(`${state.today}T00:00:00Z`);
  return Math.max(0, Math.floor((end - now) / DAY_MS));
}

export type Tone = "ok" | "warn" | "bad";

export interface HudModel {
  levelCode: string;
  levelName: string;
  score: number;
  credits: number;
  daysLeft: number;
  health: number;
  healthTone: Tone;
  strength: number;
  atRisk: { goalId: string; label: string; risk: number }[];
  recovery: { day: number; of: number } | null;
}

export function hudModel(state: GameState, rules: RulesConfig): HudModel {
  const { health, strength } = state.character;
  const healthTone: Tone = health < rules.recovery.healthBelow ? "bad" : health < 50 ? "warn" : "ok";
  return {
    levelCode: levelCode(state.level),
    levelName: LEVEL_NAMES[state.level],
    score: state.score,
    credits: state.credits,
    daysLeft: daysLeft(state),
    health: Math.round(health),
    healthTone,
    strength: Math.round(strength),
    atRisk: state.goals
      .filter((g) => g.status === "at_risk")
      .map((g) => ({ goalId: g.id, label: `${AREA_META[g.area].name} ${levelCode(g.level)}`, risk: Math.round(g.risk) })),
    recovery: state.recovery ? { day: state.recovery.day, of: rules.recovery.days } : null,
  };
}

/** Habits that ask for a check-in tonight: any habit whose area mode has a weekly target above zero. */
export function activeHabits(state: GameState): Habit[] {
  if (state.recovery) {
    const title = state.recovery.habitTitle;
    return state.habits.filter((h) => h.title === title).slice(0, 1);
  }
  return state.habits.filter((h) => {
    const mode: AreaMode = state.modes[h.area];
    return h.weeklyTarget[mode] > 0;
  });
}
