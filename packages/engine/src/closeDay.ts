import {
  DEFAULT_RULES,
  type CheckIn,
  type CheckInEntry,
  type GameEvent,
  type AreaId,
  type GameState,
  type Goal,
  type Habit,
  type HabitDay,
  type ResistanceId,
  type ResistanceState,
  type RuleAdjustment,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { activeRules, adjustmentFor, daysBetween, hasEffect, reportsIn, usualMissOn } from "./resistance";
import { withLevels } from "./levels";
import { applyDayRisk } from "./risk";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Keeps progress sums like 0.97 + 0.03 from landing a hair under 1. */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/** True when the habit's last recorded check-in was a miss, so a miss today is the second in a row. */
const lastWasMiss = (habit: Habit) => habit.history[habit.history.length - 1]?.result === "missed";

/** Goals a check-in can move: on the current level or below, not frozen, not locked in, and not run by a program. */
function earnsProgress(goal: Goal, state: GameState): boolean {
  if (goal.frozen || goal.level > state.level) return false;
  if (goal.status !== "open" && goal.status !== "in_progress" && goal.status !== "lost") return false;
  return !state.programs.some((p) => p.goalId === goal.id);
}

/**
 * Nightly check-in. Pure: returns a new state and the events to show, never mutates `state`.
 *
 * - Done / Minimum: score (× level multiplier) and credits, health restore, strength gain, goal progress,
 *   and the area marked as moved this week. A goal that reaches 1 locks in and pays its lock-in bonus.
 * - Missed: grace days absorb misses first (costliest misses first); a miss with no grace left costs health,
 *   and a second miss in a row on the same habit (its last two check-ins) costs `doubleMissFactor` × that.
 *   A grace day removes the damage, not the miss, so the streak still counts.
 * - Resistance: each reason given raises that Resistance by 1; doing a habit on a weekday it is usually
 *   missed knocks that Resistance down by 1. A Resistance reported while at `setbackAt` causes a setback
 *   (halved by an equipped game plan) and, if no rule for it is in force, a rule adjustment; it then drops
 *   to `afterSetback`, so it cannot hit every day in a row.
 * - At risk and lost ground: see `applyDayRisk`. Levels are checked last: see `checkLevels`.
 * - Rule adjustments in force change how entries count (see `RuleEffect`).
 * - Health and strength changes are summed and clamped once, so entry order never matters.
 * - Score is never taken away.
 *
 * Callers must close each date once: closing the same date twice counts it twice.
 */
export function closeDay(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  const events: GameEvent[] = [];
  const date = checkIn.date;
  const mult = config.levelMultiplier[state.level];
  const habitsById = new Map(state.habits.map((h) => [h.id, h]));
  const rulesInForce = activeRules(state.rules, date);

  // Only entries for habits the player has; one entry per habit (the last one wins).
  const entries = new Map<string, CheckInEntry>();
  for (const e of checkIn.entries) if (habitsById.has(e.habitId)) entries.set(e.habitId, e);

  let score = state.score;
  let credits = state.credits;
  let graceDaysLeft = state.character.graceDaysLeft;
  const weekProgress = { ...state.weekProgress };

  // Misses: decide which ones grace absorbs before any damage lands. A miss that costs no health needs no grace.
  const misses = [...entries.values()].filter((e) => e.result === "missed");
  const costly = misses
    .filter((e) => !hasEffect(rulesInForce, "no_health_loss_on_miss", e.habitId))
    .map((e) => ({ habitId: e.habitId, double: lastWasMiss(habitsById.get(e.habitId)!) }));
  const graceOrder = [...costly].sort((a, b) => Number(b.double) - Number(a.double));
  const absorbed = new Set(graceOrder.slice(0, graceDaysLeft).map((m) => m.habitId));

  const health = { habit: 0, miss: 0, double_miss: 0, setback: 0 };
  let strengthGain = 0;
  const progressGain = new Map<string, number>();
  const resistanceDelta = new Map<ResistanceId, number>();
  const reported = new Set<ResistanceId>();
  const countedFull = new Set<string>();
  const graced = new Set<string>();
  const bump = (id: ResistanceId, by: number) => resistanceDelta.set(id, (resistanceDelta.get(id) ?? 0) + by);

  for (const entry of entries.values()) {
    const habit = habitsById.get(entry.habitId)!;

    if (entry.result === "missed") {
      if (entry.reason) {
        bump(entry.reason, 1);
        reported.add(entry.reason);
      }
      if (hasEffect(rulesInForce, "no_health_loss_on_miss", habit.id)) continue;
      if (absorbed.has(habit.id)) {
        graceDaysLeft -= 1;
        graced.add(habit.id);
        events.push({ type: "grace_used", habitId: habit.id });
      } else if (lastWasMiss(habit)) {
        health.double_miss -= config.health.missCost * config.health.doubleMissFactor;
      } else {
        health.miss -= config.health.missCost;
      }
      continue;
    }

    const usual = usualMissOn(habit, date);
    if (usual) bump(usual, -1);

    const full = entry.result === "full" || !!hasEffect(rulesInForce, "minimum_counts_as_full", habit.id);
    if (full) countedFull.add(habit.id);
    const creditRule = rulesInForce.find((r) => r.effect.kind === "credit_multiplier" && r.effect.habitId === habit.id);
    const creditMult = creditRule?.effect.kind === "credit_multiplier" ? creditRule.effect.multiplier : 1;
    const points = Math.round((full ? config.points.habitFull : config.points.habitMinimum) * mult);
    const earned = Math.round((full ? config.credits.habitFull : config.credits.habitMinimum) * creditMult);
    score += points;
    credits += earned;
    events.push({ type: "points", score: points, credits: earned, reason: "habit", sourceId: habit.id });

    health.habit += full ? config.health.fullRestore : config.health.minimumRestore;
    strengthGain += full ? config.strength.fullGain : config.strength.minimumGain;
    weekProgress[habit.area] = true;
    const step = full ? config.progress.perFull : config.progress.perMinimum;
    progressGain.set(habit.goalId, (progressGain.get(habit.goalId) ?? 0) + step);
  }

  // History: append today's result and keep the last `history.days` days.
  const habits = state.habits.map((h): Habit => {
    const entry = entries.get(h.id);
    if (!entry) return h;
    const today: HabitDay = {
      date,
      result: entry.result,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(graced.has(h.id) ? { graced: true } : {}),
    };
    const history = [...h.history, today].filter((d) => daysBetween(d.date, date) < config.history.days);
    return { ...h, history };
  });

  // Resistance: strength, reports, setbacks and rule adjustments.
  const newRules: RuleAdjustment[] = [];
  const setbackAreas: AreaId[] = [];
  const resistance = { ...state.resistance };
  for (const id of Object.keys(state.resistance) as ResistanceId[]) {
    const before = state.resistance[id];
    let strength = clamp(before.strength + (resistanceDelta.get(id) ?? 0), 1, config.resistance.max);

    if (reported.has(id) && strength >= config.resistance.setbackAt) {
      const planned = state.gamePlans.some((p) => p.resistance === id && p.equipped);
      const damage = config.health.setbackDamage * (planned ? config.resistance.gamePlanDamageFactor : 1);
      health.setback -= damage;
      events.push({ type: "setback", resistance: id, damage });
      setbackAreas.push(before.targetArea);

      if (!rulesInForce.some((r) => r.trigger === id)) {
        const rule = adjustmentFor(id, habits, misses, date, config);
        if (rule) {
          newRules.push(rule);
          events.push({ type: "rule_adjusted", rule });
        }
      }
      // Right after a setback the Resistance drops back, so it cannot hit every day in a row.
      strength = config.resistance.afterSetback;
    }

    const next: ResistanceState = { ...before, strength, reports14d: reportsIn(habits, id) };
    resistance[id] = next;
    if (strength !== before.strength) events.push({ type: "resistance_changed", id, strength });
  }

  // Health: sum, clamp once, then trim the events so they add up to what actually changed.
  const startHealth = state.character.health;
  const raw = startHealth + health.habit + health.miss + health.double_miss + health.setback;
  const endHealth = clamp(raw, 0, config.health.max);
  if (raw > endHealth) health.habit -= raw - endHealth;
  if (raw < endHealth) {
    let give = endHealth - raw;
    for (const key of ["miss", "double_miss", "setback"] as const) {
      const back = Math.min(give, -health[key]);
      health[key] += back;
      give -= back;
    }
  }
  for (const reason of ["habit", "miss", "double_miss", "setback"] as const) {
    if (health[reason] !== 0) events.push({ type: "health_changed", delta: health[reason], reason });
  }

  const startStrength = state.character.strength;
  const endStrength = clamp(startStrength + strengthGain, 0, config.strength.max);
  if (endStrength !== startStrength) events.push({ type: "strength_changed", delta: endStrength - startStrength });

  // Goal progress and lock-ins.
  const progressed = state.goals.map((goal): Goal => {
    const gain = progressGain.get(goal.id);
    if (!gain || !earnsProgress(goal, state)) return goal;
    const to = tidy(clamp(goal.progress + gain, 0, 1));
    if (to === goal.progress) return goal;
    events.push({ type: "progress", goalId: goal.id, from: goal.progress, to });
    if (to < 1) return { ...goal, progress: to, status: goal.status === "open" ? "in_progress" : goal.status };

    const bonus = Math.round(config.points.goalLockedInPerLevel * goal.level * mult);
    const bonusCredits = config.credits.goalLockedInPerLevel * goal.level;
    score += bonus;
    credits += bonusCredits;
    events.push({ type: "locked_in", goalId: goal.id });
    events.push({ type: "points", score: bonus, credits: bonusCredits, reason: "goal_locked_in", sourceId: goal.id });
    return { ...goal, progress: 1, status: "locked_in", risk: 0, lockedInOn: date };
  });

  // At risk, clean days, setback pressure and lost ground.
  const goals = applyDayRisk(progressed, { state, habits, entries, countedFull, graced, setbackAreas, date }, events, config);

  return withLevels({
    state: {
      ...state,
      today: date,
      score,
      credits,
      goals,
      habits,
      resistance,
      rules: [...state.rules, ...newRules],
      character: { ...state.character, health: endHealth, strength: endStrength, graceDaysLeft },
      weekProgress,
    },
    events,
  }, config);
}
