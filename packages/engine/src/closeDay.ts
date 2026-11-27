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
import { withJournal } from "./journal";
import { activeRules, adjustmentFor, daysBetween, hasEffect, reportsIn, usualMissOn } from "./resistance";
import { appendHistory } from "./history";
import { withLevels } from "./levels";
import { recoveryDay, withAutoRecovery } from "./recovery";
import { maintenanceCap } from "./maintenance";
import { applyProgramSessions } from "./programs";
import { moveGoal, movable } from "./progress";
import { applyDayRisk } from "./risk";
import { withKnockedDown } from "./character";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Keeps progress sums like 0.97 + 0.03 from landing a hair under 1. */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;

/** True when the habit's last recorded check-in was a miss, so a miss today is the second in a row. */
const lastWasMiss = (habit: Habit) => habit.history[habit.history.length - 1]?.result === "missed";

/**
 * Nightly check-in. Pure: returns a new state and the events to show, never mutates `state`.
 *
 * - Programs: done entries on a program goal fill sessions of its current week (see `applyProgramSessions`);
 *   such goals move only by finished weeks.
 * - Done / Minimum: score (× level multiplier) and credits, health restore, strength gain, and the area marked
 *   as moved this week. Goals don't move per check-in: they move by consistent weeks in `closeWeek`.
 * - Missed: grace days absorb misses first (costliest misses first); a miss with no grace left costs health,
 *   and a second miss in a row on the same habit (its last two check-ins) costs `doubleMissFactor` × that.
 *   A grace day removes the damage, not the miss, so the streak still counts.
 * - Resistance: a reason given raises that Resistance by 1 (at most 1 a night, however many habits report it); doing a habit on a weekday it is usually
 *   missed knocks that Resistance down by 1. A Resistance reported while at `setbackAt` causes a setback
 *   (halved by an equipped game plan) and, if no rule for it is in force, a rule adjustment; it then drops
 *   to `afterSetback`, so it cannot hit every day in a row.
 * - At risk and lost ground: see `applyDayRisk`. Levels are checked last: see `checkLevels`.
 * - Rule adjustments in force change how entries count (see `RuleEffect`).
 * - Strength: + `fullGain` / `minimumGain` per done habit, − `strength.missCost` per miss grace didn't cover,
 *   − `strength.dailyDecay` × current strength each night, so it settles where gains and decay meet.
 * - Health and strength changes are summed and clamped once, so entry order never matters.
 * - Score is never taken away.
 *
 * - In Recovery the day runs `recoveryDay` instead; otherwise Recovery may start automatically at the end
 *   (see `withAutoRecovery`).
 * - Knocked down: reaching `health.knockedDownAt` sets `character.knockedDown` and emits `knocked_down`.
 *   While down, habits restore no health (points and credits still score); each done or minimum entry is a
 *   play, and `health.getUpAfterPlays` plays get the athlete up at `health.getUpHealth`.
 * - Maintenance cap: on a night a system goal locks in, `maintenance_cap` if the cap is passed.
 *
 * Callers must close each date once: closing the same date twice counts it twice.
 */
function closeDayStep(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  if (state.recovery) return recoveryDay(state, checkIn, config);
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
  const sessions = new Map<string, number>();
  const programGoals = new Set(state.programs.map((p) => p.goalId));
  const resistanceDelta = new Map<ResistanceId, number>();
  const reported = new Set<ResistanceId>();
  const countedFull = new Set<string>();
  const graced = new Set<string>();
  const bump = (id: ResistanceId, by: number) => resistanceDelta.set(id, (resistanceDelta.get(id) ?? 0) + by);

  for (const entry of entries.values()) {
    const habit = habitsById.get(entry.habitId)!;

    if (entry.result === "missed") {
      // A Resistance gains at most 1 a night, however many habits report it.
      if (entry.reason && !reported.has(entry.reason)) {
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
    if (programGoals.has(habit.goalId)) sessions.set(habit.goalId, (sessions.get(habit.goalId) ?? 0) + 1);
  }

  // History: append today's result and keep the last `history.days` days.
  const habits = appendHistory(state.habits, entries, graced, date, config);

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

  // Knocked down: habits restore no health; each done or minimum entry is a play toward getting up.
  const wasDown = state.character.knockedDown;
  const plays = (wasDown?.plays ?? 0) + [...entries.values()].filter((e) => e.result !== "missed").length;
  const getsUp = !!wasDown && plays >= config.health.getUpAfterPlays;
  if (wasDown) health.habit = 0;

  // Health: sum, clamp once, then trim the events so they add up to what actually changed.
  const startHealth = state.character.health;
  const raw = startHealth + health.habit + health.miss + health.double_miss + health.setback;
  let endHealth = clamp(raw, 0, config.health.max);
  if (raw > endHealth) health.habit -= raw - endHealth;
  if (raw < endHealth) {
    let give = endHealth - raw;
    for (const key of ["miss", "double_miss", "setback"] as const) {
      const back = Math.min(give, -health[key]);
      health[key] += back;
      give -= back;
    }
  }
  if (getsUp) {
    // Back up: health is set to getUpHealth, whatever else happened today.
    endHealth = config.health.getUpHealth;
    if (endHealth !== startHealth) events.push({ type: "health_changed", delta: endHealth - startHealth, reason: "habit" });
  } else {
    for (const reason of ["habit", "miss", "double_miss", "setback"] as const) {
      if (health[reason] !== 0) events.push({ type: "health_changed", delta: health[reason], reason });
    }
  }
  let knockedDown = wasDown ? (getsUp ? undefined : { ...wasDown, plays }) : undefined;
  if (!wasDown && endHealth <= config.health.knockedDownAt) {
    knockedDown = { since: date, plays: 0 };
    events.push({ type: "knocked_down" });
  }

  const startStrength = state.character.strength;
  // Strength: gains, minus missCost per miss grace didn't cover, minus dailyDecay of current strength.
  const uncovered = misses.filter((e) => !graced.has(e.habitId)).length;
  const strengthLoss = uncovered * config.strength.missCost + startStrength * config.strength.dailyDecay;
  const endStrength = clamp(tidy(startStrength + strengthGain - strengthLoss), 0, config.strength.max);
  if (endStrength !== startStrength) events.push({ type: "strength_changed", delta: endStrength - startStrength });

  // Programs: sessions toward the current week, for goals a check-in can move.
  for (const id of sessions.keys()) {
    const g = state.goals.find((x) => x.id === id);
    if (!g || !movable(g, state.level)) sessions.delete(id);
  }
  const programDay = applyProgramSessions(state, sessions, { score, credits }, config, events);
  score = programDay.score;
  credits = programDay.credits;

  // Program goals move by finished weeks; finishing the program verifies a milestone. Other goals move
  // by consistent weeks at the weekly rollover (see `applyConsistentWeek`).
  const totals = { score, credits };
  const progressed = state.goals.map((goal): Goal => {
    const target = programDay.progress.get(goal.id);
    if (target === undefined || !movable(goal, state.level)) return goal;
    return moveGoal(goal, target, { date, level: state.level, totals, verifies: target >= 1 }, config, events);
  });
  score = totals.score;
  credits = totals.credits;

  // At risk, clean days, setback pressure and lost ground.
  const goals = applyDayRisk(progressed, { state, habits, entries, countedFull, graced, setbackAreas, date }, events, config);

  const result = withLevels({
    state: {
      ...state,
      today: date,
      score,
      credits,
      goals,
      habits,
      programs: programDay.programs,
      resistance,
      rules: [...state.rules, ...newRules],
      character: withKnockedDown({ ...state.character, health: endHealth, strength: endStrength, graceDaysLeft }, knockedDown),
      weekProgress,
    },
    events,
  }, config);
  const capped = lockedSystemGoal(events, state) ? maintenanceCap(result.state, config) : undefined;
  return withAutoRecovery(capped ? { ...result, events: [...result.events, capped] } : result, date, config);
}

/** True when a system goal locked in during this step. */
const lockedSystemGoal = (events: GameEvent[], state: GameState) =>
  events.some((e) => e.type === "locked_in" && state.goals.find((g) => g.id === e.goalId)?.kind === "system");

/** closeDay with the step's notable moments added to `state.journal`. */
export function closeDay(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  return withJournal(state, closeDayStep(state, checkIn, config), checkIn.date, config);
}
