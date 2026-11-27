import {
  DEFAULT_RULES,
  type AreaId,
  type CheckInEntry,
  type GameEvent,
  type GameState,
  type Goal,
  type Habit,
  type IsoDate,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { withJournal } from "./journal";
import { withLevels } from "./levels";
import { daysBetween } from "./resistance";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/** At 100 the goal is lost: dividends stop and it must be won back from `lostRestartProgress`. */
function loseGround(goal: Goal, events: GameEvent[], config: RulesConfig): Goal {
  events.push({ type: "ground_lost", goalId: goal.id });
  return { ...goal, status: "lost", risk: 0, progress: config.risk.lostRestartProgress };
}

/** Risk goes up by `by`; at 100 the ground is lost. */
export function raiseRisk(goal: Goal, by: number, events: GameEvent[], config: RulesConfig): Goal {
  const risk = clamp(goal.risk + by, 0, 100);
  if (risk >= 100) return loseGround(goal, events, config);
  if (risk === goal.risk) return goal;
  events.push({ type: "at_risk", goalId: goal.id, risk });
  return { ...goal, risk };
}

function clearRisk(goal: Goal, events: GameEvent[]): Goal {
  events.push({ type: "risk_cleared", goalId: goal.id });
  return { ...goal, status: "locked_in", risk: 0 };
}

export interface DayRiskInput {
  state: GameState;
  /** Habits with today's entry already in their history. */
  habits: Habit[];
  entries: Map<string, CheckInEntry>;
  /** Habits whose entry counted as full today (after rule adjustments). */
  countedFull: Set<string>;
  /** Habits whose miss a grace day covered today. */
  graced: Set<string>;
  /** Areas a setback targeted today. */
  setbackAreas: AreaId[];
  date: IsoDate;
}

/**
 * At risk and lost ground, for one closed day. Runs after goal progress.
 *
 * - Clean day on an at-risk goal (at least one of its habits checked in, none missed): risk drops by
 *   `fullCleanDay` if every one was full, else `minimumCleanDay`. At 0 it is locked in again.
 * - Miss pattern, system goals only: a locked-in system goal goes at risk at `onTrigger` when a miss beyond
 *   grace today brings its habits to `missesToTrigger` such misses within `patternDays` days. Milestones only go at
 *   risk from a failed quarterly check.
 * - Setback pressure: an at-risk goal in the targeted area gains `setbackPressure` risk; with none, the
 *   area's in-progress goal on the highest level reached loses `setbackLoss` progress.
 * - At 100 risk the goal is lost and restarts from `lostRestartProgress`.
 */
export function applyDayRisk(goals: Goal[], input: DayRiskInput, events: GameEvent[], config: RulesConfig): Goal[] {
  const { state, habits, entries, countedFull, graced, setbackAreas, date } = input;
  const served = (goal: Goal) => habits.filter((h) => h.goalId === goal.id);

  let next = goals.map((goal): Goal => {
    if (goal.frozen) return goal;
    const today = served(goal).flatMap((h) => {
      const e = entries.get(h.id);
      return e ? [e] : [];
    });

    if (goal.status === "at_risk") {
      if (today.length === 0 || today.some((e) => e.result === "missed")) return goal;
      const allFull = today.every((e) => countedFull.has(e.habitId));
      const risk = Math.max(0, goal.risk - (allFull ? config.risk.fullCleanDay : config.risk.minimumCleanDay));
      if (risk === 0) return clearRisk(goal, events);
      events.push({ type: "at_risk", goalId: goal.id, risk });
      return { ...goal, risk };
    }

    if (goal.status === "locked_in" && goal.kind === "system") {
      const missedToday = today.some((e) => e.result === "missed" && !graced.has(e.habitId));
      if (!missedToday) return goal;
      const misses = served(goal).reduce(
        (n, h) => n + h.history.filter((d) => d.result === "missed" && !d.graced && daysBetween(d.date, date) < config.risk.patternDays).length,
        0,
      );
      if (misses < config.risk.missesToTrigger) return goal;
      events.push({ type: "at_risk", goalId: goal.id, risk: config.risk.onTrigger });
      return { ...goal, status: "at_risk", risk: config.risk.onTrigger };
    }
    return goal;
  });

  for (const area of setbackAreas) {
    const inArea = next.filter((g) => g.area === area && !g.frozen && g.level <= state.level).sort((a, b) => a.level - b.level);
    const atRisk = inArea.find((g) => g.status === "at_risk");
    const target = atRisk ?? [...inArea].reverse().find((g) => g.status === "in_progress");
    if (!target) continue;
    const pressed = atRisk
      ? raiseRisk(target, config.risk.setbackPressure, events, config)
      : (() => {
          const to = tidy(Math.max(0, target.progress - config.progress.setbackLoss));
          if (to === target.progress) return target;
          events.push({ type: "progress", goalId: target.id, from: target.progress, to });
          return { ...target, progress: to };
        })();
    next = next.map((g) => (g.id === target.id ? pressed : g));
  }
  return next;
}

/**
 * A milestone goal's quarterly check. A pass records the date and takes an at-risk milestone off the board;
 * a fail puts a locked-in milestone at risk at `onTrigger`. Anything else is left as it is.
 */
function quarterlyCheckStep(
  state: GameState,
  goalId: string,
  passed: boolean,
  date: IsoDate,
  config: RulesConfig = DEFAULT_RULES,
): StepResult {
  const events: GameEvent[] = [];
  const goals = state.goals.map((goal): Goal => {
    if (goal.id !== goalId || goal.kind !== "milestone") return goal;
    if (goal.status !== "locked_in" && goal.status !== "at_risk") return goal;
    if (passed) {
      const checked = { ...goal, lastQuarterlyCheck: date };
      return goal.status === "at_risk" ? clearRisk(checked, events) : checked;
    }
    if (goal.status === "at_risk") return goal;
    events.push({ type: "at_risk", goalId: goal.id, risk: config.risk.onTrigger });
    return { ...goal, status: "at_risk", risk: config.risk.onTrigger };
  });
  const result = { state: events.length || goals.some((g, i) => g !== state.goals[i]) ? { ...state, goals } : state, events };
  return withLevels(result, config);
}

/** quarterlyCheck with the step's notable moments added to `state.journal`. */
export function quarterlyCheck(state: GameState, goalId: string, passed: boolean, date: IsoDate, config: RulesConfig = DEFAULT_RULES): StepResult {
  return withJournal(state, quarterlyCheckStep(state, goalId, passed, date, config), date, config);
}
