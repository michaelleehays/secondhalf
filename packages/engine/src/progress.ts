import {
  DEFAULT_RULES,
  type GameEvent,
  type GameState,
  type Goal,
  type Habit,
  type IsoDate,
  type Level,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { withJournal } from "./journal";
import { withLevels } from "./levels";
import { daysBetween } from "./resistance";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Keeps progress sums like 11 × (1/12) from landing a hair under 1. */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;
const WEEK_DAYS = 7;
const SNAP = 1e-6;

/** Goals that can move: on the current level or below, not frozen, and not yet held. */
export function movable(goal: Goal, level: Level): boolean {
  if (goal.frozen || goal.level > level) return false;
  return goal.status === "open" || goal.status === "in_progress" || goal.status === "lost";
}

export interface Totals {
  score: number;
  credits: number;
}

/** Locks a goal in and pays `goalLockedInPerLevel × goal level` (score × the player's level multiplier). */
function lockIn(goal: Goal, date: IsoDate, level: Level, totals: Totals, config: RulesConfig, events: GameEvent[]): Goal {
  const bonus = Math.round(config.points.goalLockedInPerLevel * goal.level * config.levelMultiplier[level]);
  const bonusCredits = config.credits.goalLockedInPerLevel * goal.level;
  totals.score += bonus;
  totals.credits += bonusCredits;
  events.push({ type: "locked_in", goalId: goal.id });
  events.push({ type: "points", score: bonus, credits: bonusCredits, reason: "goal_locked_in", sourceId: goal.id });
  return { ...goal, progress: 1, status: "locked_in", risk: 0, lockedInOn: date };
}

/**
 * Moves a goal to `to` (0..1). A milestone without a verified achievement stops at `milestoneVerifyAt` and
 * emits `ready_to_verify` the first time it gets there; a verified milestone locks in from that point.
 * A system goal locks in at 1. `verifies` marks this move as the verification (a finished program).
 */
export function moveGoal(
  goal: Goal,
  to: number,
  ctx: { date: IsoDate; level: Level; totals: Totals; verifies?: boolean },
  config: RulesConfig,
  events: GameEvent[],
): Goal {
  const verifyAt = config.progress.milestoneVerifyAt;
  const milestone = goal.kind === "milestone";
  const verified = !!goal.verifiedOn || !!ctx.verifies;
  let target = tidy(clamp(to, 0, 1));
  // Steps like 1/12 don't add up exactly: snap to 1 and to the verify point when within rounding.
  if (Math.abs(target - 1) < SNAP) target = 1;
  if (Math.abs(target - verifyAt) < SNAP) target = verifyAt;
  if (milestone && !verified) target = Math.min(target, verifyAt);
  if (milestone && verified && target >= verifyAt) target = 1;
  if (target === goal.progress) return goal;

  events.push({ type: "progress", goalId: goal.id, from: goal.progress, to: target });
  const moved: Goal = ctx.verifies && milestone && !goal.verifiedOn ? { ...goal, verifiedOn: ctx.date } : goal;
  if (target >= 1) return lockIn(moved, ctx.date, ctx.level, ctx.totals, config, events);
  if (milestone && !verified && target >= verifyAt && goal.progress < verifyAt) events.push({ type: "ready_to_verify", goalId: goal.id });
  return { ...moved, progress: target, status: goal.status === "open" ? "in_progress" : goal.status };
}

/**
 * Share of a goal's weekly target its habits reached in the 7 days ending `weekEnding`: each full check-in
 * counts 1 and each minimum `minimumWeight`, against the habits' `weeklyTarget` for their area's mode.
 * Undefined when the goal has no habits with a target this week (no habits, or its area is in Rest).
 */
export function weeklyShare(goal: Goal, state: GameState, habits: Habit[], weekEnding: IsoDate, config: RulesConfig): number | undefined {
  const mine = habits.filter((h) => h.goalId === goal.id);
  const target = mine.reduce((n, h) => n + h.weeklyTarget[state.modes[h.area]], 0);
  if (target <= 0) return undefined;
  const done = mine.reduce(
    (n, h) =>
      n +
      h.history.reduce((m, d) => {
        const ago = daysBetween(d.date, weekEnding);
        if (ago < 0 || ago >= WEEK_DAYS) return m;
        return m + (d.result === "full" ? 1 : d.result === "minimum" ? config.progress.minimumWeight : 0);
      }, 0),
    0,
  );
  return done / target;
}

/**
 * Consistent weeks, at the weekly rollover. A goal (not run by a program) whose habits reached
 * `consistentWeekShare` of their weekly targets moves 1 / `weeksToLockIn[goal level]` of the way: to 1 for a
 * system goal, to `milestoneVerifyAt` for a milestone, so either takes `weeksToLockIn` consistent weeks.
 */
export function applyConsistentWeek(state: GameState, goals: Goal[], weekEnding: IsoDate, totals: Totals, config: RulesConfig, events: GameEvent[]): Goal[] {
  const programGoals = new Set(state.programs.map((p) => p.goalId));
  return goals.map((goal) => {
    if (programGoals.has(goal.id) || !movable(goal, state.level)) return goal;
    const share = weeklyShare(goal, state, state.habits, weekEnding, config);
    if (share === undefined || share < config.progress.consistentWeekShare) return goal;
    // Milestones reach the verify point, and system goals reach 1, after weeksToLockIn consistent weeks.
    const reach = goal.kind === "milestone" ? config.progress.milestoneVerifyAt : 1;
    const step = reach / config.progress.weeksToLockIn[goal.level];
    return moveGoal(goal, goal.progress + step, { date: weekEnding, level: state.level, totals }, config, events);
  });
}

/**
 * The player confirms a real achievement for a milestone goal. At or above `milestoneVerifyAt` it emits
 * `verified` and locks the goal in with its bonus; below that it records `verifiedOn` (and emits `verified`),
 * and the goal locks in as soon as consistency carries it there. Already verified, held, system or unknown
 * goals are left as they are.
 */
function verifyAchievementStep(state: GameState, goalId: string, date: IsoDate, note?: string, config: RulesConfig = DEFAULT_RULES): StepResult {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal || goal.kind !== "milestone" || goal.verifiedOn) return { state, events: [] };
  if (goal.status === "locked_in" || goal.status === "at_risk" || goal.status === "hidden") return { state, events: [] };

  const events: GameEvent[] = [{ type: "verified", goalId, ...(note ? { note } : {}) }];
  const totals = { score: state.score, credits: state.credits };
  let next: Goal = { ...goal, verifiedOn: date };
  if (movable(goal, state.level) && goal.progress >= config.progress.milestoneVerifyAt) {
    next = moveGoal(next, 1, { date, level: state.level, totals }, config, events);
  }
  const goals = state.goals.map((g) => (g.id === goalId ? next : g));
  return withLevels({ state: { ...state, goals, ...totals }, events }, config);
}

/** verifyAchievement with the step's notable moments added to `state.journal`. */
export function verifyAchievement(state: GameState, goalId: string, date: IsoDate, note?: string, config: RulesConfig = DEFAULT_RULES): StepResult {
  return withJournal(state, verifyAchievementStep(state, goalId, date, note, config), date, config);
}
