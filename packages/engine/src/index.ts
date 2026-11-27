import {
  DEFAULT_RULES,
  type Engine,
  type GameState,
  type RulesConfig,
  type WorldView,
} from "@second-half/contracts";
import { closeDay } from "./closeDay";
import { quarterlyCheck } from "./risk";

export { closeDay } from "./closeDay";
export { quarterlyCheck, raiseRisk } from "./risk";
export { checkLevels } from "./levels";

/**
 * Game engine. Workstream A implements closeDay, closeWeek, startLifeEvent and equipGamePlan
 * against the rules in the design doc, with tests for each rule.
 * Every function is pure: it returns a new state and never mutates its input.
 */
export function createEngine(config: RulesConfig = DEFAULT_RULES): Engine {
  const notYet = (name: string) => () => {
    throw new Error(`engine.${name} is not implemented yet (workstream A)`);
  };

  return {
    closeDay: (state, checkIn) => closeDay(state, checkIn, config),
    closeWeek: notYet("closeWeek"),
    startLifeEvent: notYet("startLifeEvent"),
    equipGamePlan: notYet("equipGamePlan"),
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
      knockedDown: health <= 0,
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
  };
}
