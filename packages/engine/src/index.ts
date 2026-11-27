import {
  DEFAULT_RULES,
  AREAS,
  type AreaId,
  type Engine,
  type GameState,
  type RulesConfig,
  type TrailView,
  type WorldView,
} from "@second-half/contracts";
import { levelNames } from "./journal";
import { closeDay } from "./closeDay";
import { closeWeek } from "./closeWeek";
import { closeReview, equipGamePlan } from "./player";
import { applyPlanEdit } from "./plan";
import { verifyAchievement } from "./progress";
import { startLifeEvent } from "./recovery";
import { quarterlyCheck } from "./risk";

export { closeDay } from "./closeDay";
export { closeWeek } from "./closeWeek";
export { recoveryHabit, startLifeEvent } from "./recovery";
export { closeReview, equipGamePlan } from "./player";
export { verifyAchievement, weeklyShare } from "./progress";
export { applyPlanEdit } from "./plan";
export { DEFAULT_LEVEL_NAMES, journalEntries, levelNames, withJournal } from "./journal";
export { quarterlyCheck, raiseRisk } from "./risk";
export { checkLevels } from "./levels";

/**
 * Game engine: every rule in the design doc, with a test named after each rule.
 * Every function is pure: it returns a new state and never mutates its input.
 */
export function createEngine(config: RulesConfig = DEFAULT_RULES): Engine {
  return {
    closeDay: (state, checkIn) => closeDay(state, checkIn, config),
    closeWeek: (state, weekEnding) => closeWeek(state, weekEnding, config),
    startLifeEvent: (state, date) => startLifeEvent(state, date, config),
    equipGamePlan: (state, gamePlanId, equipped) => equipGamePlan(state, gamePlanId, equipped, config),
    closeReview: (state, date) => closeReview(state, date, config),
    verifyAchievement: (state, goalId, date, note) => verifyAchievement(state, goalId, date, note, config),
    applyPlanEdit: (state, edit, date) => applyPlanEdit(state, edit, date, config),
    quarterlyCheck: (state, goalId, passed, date) => quarterlyCheck(state, goalId, passed, date, config),
    projectedFinalScore: (state) => projectedFinalScore(state, config),
    toWorldView,
  };
}

/** Weeks of game left, from today to the user's end age. */
export function weeksLeft(state: GameState): number {
  const end = Date.UTC(state.birthYear + state.endAge, 0, 1);
  const now = Date.parse(state.today);
  return Math.max(0, Math.floor((end - now) / (7 * 864e5)));
}

/** Current score plus weekly dividends on locked-in goals, paid until the end of the game. Habit points are not projected. */
export function projectedFinalScore(state: GameState, config: RulesConfig = DEFAULT_RULES): number {
  const mult = config.levelMultiplier[state.level];
  const weekly = state.goals
    .filter((g) => g.status === "locked_in" && !g.frozen)
    .reduce((sum, g) => sum + config.points.dividendPerLevel * g.level, 0);
  return Math.round(state.score + weekly * mult * weeksLeft(state));
}

export function toWorldView(state: GameState): WorldView {
  const { health, strength } = state.character;
  return {
    level: state.level,
    cells: state.goals.map((g) => ({
      goalId: g.id,
      area: g.area,
      level: g.level,
      status: g.status,
      progress: g.progress,
      risk: g.risk,
      frozen: g.frozen || g.level > state.level,
    })),
    athlete: {
      health,
      strength,
      build: Math.max(-1, Math.min(1, (strength - 50) / 40)),
      slump: health < 35 ? 1 : 0,
      knockedDown: state.character.knockedDown !== undefined || health <= 0,
    },
    resistance: Object.values(state.resistance).map((r) => {
      const attacked = state.goals.find((g) => g.area === r.targetArea && g.status === "at_risk");
      return {
        id: r.id,
        strength: r.strength,
        targetArea: r.targetArea,
        ...(attacked && r.strength >= 5 ? { attackingGoalId: attacked.id } : {}),
      };
    }),
    inRecovery: state.recovery !== null,
    levelNames: levelNames(state),
    trail: trailView(state),
  };
}

/**
 * The section being worked: the Focus area whose lowest in-progress goal sits lowest on the mountain (ties go to
 * AREAS order; no Focus area in progress falls back to body). Stops are its goals 101-401; moments its journal.
 */
export function trailView(state: GameState): TrailView {
  let area: AreaId = "body";
  let best = Infinity;
  for (const a of AREAS) {
    if (state.modes[a] !== "focus") continue;
    const lowest = Math.min(...state.goals.filter((g) => g.area === a && g.status === "in_progress").map((g) => g.level));
    if (lowest < best) {
      best = lowest;
      area = a;
    }
  }
  const stops = state.goals
    .filter((g) => g.area === area)
    .sort((a, b) => a.level - b.level)
    .map((g) => ({ goalId: g.id, level: g.level, title: g.title, status: g.status, progress: g.progress, frozen: g.frozen || g.level > state.level }));
  return { area, stops, moments: (state.journal ?? []).filter((e) => e.area === area) };
}
