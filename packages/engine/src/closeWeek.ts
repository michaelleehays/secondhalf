import {
  AREAS,
  DEFAULT_RULES,
  type AreaId,
  type GameEvent,
  type GameState,
  type Goal,
  type Habit,
  type IsoDate,
  type ResistanceId,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { withLevels } from "./levels";
import { addDays, daysBetween } from "./resistance";
import { maintenanceCap } from "./maintenance";
import { withAutoRecovery } from "./recovery";
import { repeatUnfinishedWeeks } from "./programs";
import { applyConsistentWeek } from "./progress";
import { raiseRisk } from "./risk";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;
const WEEK_DAYS = 7;
/** The Monday after `date`. */
const mondayAfter = (date: IsoDate): IsoDate => addDays(date, 7 - ((new Date(Date.parse(date)).getUTCDay() + 6) % 7));

/** History entries from the week ending `weekEnding`: the 7 days up to and including it. */
const inWeek = (d: { date: IsoDate }, weekEnding: IsoDate) => {
  const ago = daysBetween(d.date, weekEnding);
  return ago >= 0 && ago < WEEK_DAYS;
};
const habitsOf = (goal: Goal, habits: Habit[]) => habits.filter((h) => h.goalId === goal.id);
const movedThisWeek = (goal: Goal, habits: Habit[], weekEnding: IsoDate) =>
  habitsOf(goal, habits).some((h) => h.history.some((d) => d.result !== "missed" && inWeek(d, weekEnding)));
const missedBeyondGraceThisWeek = (goal: Goal, habits: Habit[], weekEnding: IsoDate) =>
  habitsOf(goal, habits).some((h) => h.history.some((d) => d.result === "missed" && !d.graced && inWeek(d, weekEnding)));

/**
 * Sunday rollover. Pure: returns a new state and the events to show, never mutates `state`.
 *
 * 1. Idle areas (no `weekProgress`, mode not Rest): strength − `strength.idleWeekCost` each; the area's
 *    in-progress goal on the current level − `progress.idleWeekDecay`; the Resistance targeting it +1.
 * 2. Dividends, `points.dividendPerLevel` × goal level × level multiplier, for goals not frozen:
 *    - milestone, locked in: in full (its last quarterly check passed or is not yet due);
 *    - milestone, at risk (failed check): `points.milestoneVestedShare` of it, which vests for life;
 *    - system, locked in: in full if its habits made progress this week, otherwise nothing.
 * 2b. Consistent weeks: a goal whose habits reached `progress.consistentWeekShare` of their weekly targets
 *    gains `1 / progress.weeksToLockIn[level]` (see `applyConsistentWeek`). Paid dividends start next week.
 * 3. At-risk goals whose habits missed beyond grace this week: risk + `risk.perBadWeek` (100 → lost ground).
 * 4. Grace refills to `grace.perMonth` (never taking away bought days) when `weekEnding` starts a new month.
 * 5. Program weeks short of their threshold start again (not in Recovery). `weekProgress` resets, levels are checked, and `today` becomes `weekEnding`.
 * 5b. Season rollover: once the season has run `season.weeks` weeks, the next one starts the Monday after `weekEnding`
 *    (index + 1, Recovery allowances back, focus carried over). No event.
 * 6. `maintenance_cap` if locked-in system goals need more than `maintenance.maxWeeklyHabits` maintenance habits.
 * 7. Recovery may start automatically (see `withAutoRecovery`).
 *
 * In Recovery, idle-area penalties (1) and risk escalation (3) are frozen; dividends still pay.
 */
export function closeWeek(state: GameState, weekEnding: IsoDate, config: RulesConfig = DEFAULT_RULES): StepResult {
  const events: GameEvent[] = [];
  const mult = config.levelMultiplier[state.level];

  // 1. Idle areas.
  const inRecovery = state.recovery !== null;
  const idle: AreaId[] = inRecovery ? [] : AREAS.filter((a) => !state.weekProgress[a] && state.modes[a] !== "rest");
  let goals = state.goals;
  for (const area of idle) {
    const target = goals.find((g) => g.area === area && g.level === state.level && g.status === "in_progress" && !g.frozen);
    if (!target) continue;
    const to = tidy(Math.max(0, target.progress - config.progress.idleWeekDecay));
    if (to === target.progress) continue;
    events.push({ type: "progress", goalId: target.id, from: target.progress, to });
    goals = goals.map((g) => (g.id === target.id ? { ...g, progress: to } : g));
  }

  const startStrength = state.character.strength;
  const strength = clamp(startStrength - idle.length * config.strength.idleWeekCost, 0, config.strength.max);
  if (strength !== startStrength) events.push({ type: "strength_changed", delta: strength - startStrength });

  const resistance = { ...state.resistance };
  for (const id of Object.keys(resistance) as ResistanceId[]) {
    const r = resistance[id];
    const hits = idle.filter((a) => a === r.targetArea).length;
    if (!hits) continue;
    const next = clamp(r.strength + hits, 1, config.resistance.max);
    if (next === r.strength) continue;
    resistance[id] = { ...r, strength: next };
    events.push({ type: "resistance_changed", id, strength: next });
  }

  // 2. Dividends.
  let score = state.score;
  for (const goal of goals) {
    if (goal.frozen) continue;
    const full = config.points.dividendPerLevel * goal.level * mult;
    let pay = 0;
    if (goal.kind === "milestone" && goal.status === "locked_in") pay = full;
    else if (goal.kind === "milestone" && goal.status === "at_risk") pay = full * config.points.milestoneVestedShare;
    else if (goal.kind === "system" && goal.status === "locked_in" && movedThisWeek(goal, state.habits, weekEnding)) pay = full;
    const points = Math.round(pay);
    if (points <= 0) continue;
    score += points;
    events.push({ type: "points", score: points, credits: 0, reason: "dividend", sourceId: goal.id });
  }

  // 2b. Consistent weeks: goals whose habits hit their weekly target move toward locking in (not in Recovery).
  const totals = { score, credits: state.credits };
  if (!inRecovery) goals = applyConsistentWeek(state, goals, weekEnding, totals, config, events);
  score = totals.score;

  // 3. Risk escalation.
  goals = goals.map((goal) =>
    !inRecovery && goal.status === "at_risk" && !goal.frozen && missedBeyondGraceThisWeek(goal, state.habits, weekEnding)
      ? raiseRisk(goal, config.risk.perBadWeek, events, config)
      : goal,
  );

  // 4. Grace refill at month start.
  const newMonth = weekEnding.slice(0, 7) !== state.today.slice(0, 7);
  const graceDaysLeft = newMonth
    ? Math.min(config.grace.maxHeld, Math.max(state.character.graceDaysLeft, config.grace.perMonth))
    : state.character.graceDaysLeft;

  // Season rollover: `season.weeks` after it started, the next season begins the Monday after.
  const season =
    daysBetween(state.season.startsOn, weekEnding) >= config.season.weeks * WEEK_DAYS - 1
      ? { ...state.season, index: state.season.index + 1, startsOn: mondayAfter(weekEnding), autoRecoveryUsed: false, lifeEventPauseUsed: false }
      : state.season;

  // 5. Reset, levels, date.
  const result = withLevels(
    {
      state: {
        ...state,
        today: weekEnding,
        score,
        credits: totals.credits,
        goals,
        resistance,
        character: { ...state.character, strength, graceDaysLeft },
        weekProgress: {},
        season,
        programs: inRecovery ? state.programs : repeatUnfinishedWeeks(state.programs),
      },
      events,
    },
    config,
  );
  const capped = maintenanceCap(result.state, config);
  return withAutoRecovery(capped ? { ...result, events: [...result.events, capped] } : result, weekEnding, config);
}
