import { DEFAULT_RULES, type GameState, type IsoDate, type RulesConfig, type StepResult } from "@second-half/contracts";
import { addDays } from "./resistance";

/**
 * Equip or take off a game plan. Up to `resistance.maxEquippedPlans` can be equipped at once: past that,
 * the state is unchanged and `game_plan_refused` tells the UI to ask the player to take one off first.
 * Taking a plan off always works. Unknown ids and toggles that change nothing return the same state, no events.
 */
export function equipGamePlan(state: GameState, gamePlanId: string, equipped: boolean, config: RulesConfig = DEFAULT_RULES): StepResult {
  const plan = state.gamePlans.find((p) => p.id === gamePlanId);
  if (!plan || plan.equipped === equipped) return { state, events: [] };
  const max = config.resistance.maxEquippedPlans;
  if (equipped && state.gamePlans.filter((p) => p.equipped).length >= max) {
    return { state, events: [{ type: "game_plan_refused", gamePlanId, max }] };
  }
  return { state: { ...state, gamePlans: state.gamePlans.map((p) => (p.id === gamePlanId ? { ...p, equipped } : p)) }, events: [] };
}

/** Monday of the Monday–Sunday week holding `date`. */
const mondayOf = (date: IsoDate): IsoDate => addDays(date, -((new Date(Date.parse(date)).getUTCDay() + 6) % 7));

/**
 * Sunday review completed. Pays `points.weeklyReview` (× level multiplier) and `credits.weeklyReview` once per
 * Monday–Sunday week, and records `lastReviewOn`. A second review in the same week returns the same state, no events.
 */
export function closeReview(state: GameState, date: IsoDate, config: RulesConfig = DEFAULT_RULES): StepResult {
  if (state.lastReviewOn && mondayOf(state.lastReviewOn) === mondayOf(date)) return { state, events: [] };
  const score = Math.round(config.points.weeklyReview * config.levelMultiplier[state.level]);
  const credits = config.credits.weeklyReview;
  return {
    state: { ...state, score: state.score + score, credits: state.credits + credits, lastReviewOn: date },
    events: [{ type: "points", score, credits, reason: "weekly_review" }],
  };
}
