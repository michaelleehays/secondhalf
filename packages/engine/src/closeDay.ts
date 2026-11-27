import {
  DEFAULT_RULES,
  type CheckIn,
  type CheckInEntry,
  type CheckInResult,
  type GameEvent,
  type GameState,
  type Habit,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";

/**
 * Bridge until `packages/contracts` carries it (requested in the pull request):
 * the result of the habit's last check-in, so the double-miss rule can tell a second miss in a row.
 */
export type HabitWithLastResult = Habit & { lastResult?: CheckInResult };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Nightly check-in. Pure: returns a new state and the events to show, never mutates `state`.
 *
 * - Done / Minimum: score (× level multiplier) and credits, health restore, strength gain, area marked as moved this week.
 * - Missed: grace days absorb misses first (costliest misses first); a miss with no grace left costs health,
 *   and a second miss in a row on the same habit costs `doubleMissFactor` × that. A grace day removes the
 *   damage, not the miss, so the streak still counts.
 * - Score is never taken away. Health and strength stay within 0..100.
 */
export function closeDay(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  const events: GameEvent[] = [];
  const mult = config.levelMultiplier[state.level];
  const habitsById = new Map(state.habits.map((h) => [h.id, h as HabitWithLastResult]));

  // Only entries for habits the player has; one entry per habit (the last one wins).
  const entries = new Map<string, CheckInEntry>();
  for (const e of checkIn.entries) if (habitsById.has(e.habitId)) entries.set(e.habitId, e);

  let score = state.score;
  let credits = state.credits;
  let health = state.character.health;
  let strength = state.character.strength;
  let graceDaysLeft = state.character.graceDaysLeft;
  const weekProgress = { ...state.weekProgress };

  // Misses: decide which ones grace absorbs before any damage lands.
  const misses = [...entries.values()]
    .filter((e) => e.result === "missed")
    .map((e) => ({ entry: e, double: habitsById.get(e.habitId)?.lastResult === "missed" }));
  const graceOrder = [...misses].sort((a, b) => Number(b.double) - Number(a.double));
  const absorbed = new Set(graceOrder.slice(0, graceDaysLeft).map((m) => m.entry.habitId));

  let strengthDelta = 0;
  for (const entry of entries.values()) {
    const habit = habitsById.get(entry.habitId)!;

    if (entry.result === "missed") {
      if (absorbed.has(habit.id)) {
        graceDaysLeft -= 1;
        events.push({ type: "grace_used", habitId: habit.id });
        continue;
      }
      const double = habit.lastResult === "missed";
      const cost = config.health.missCost * (double ? config.health.doubleMissFactor : 1);
      const next = clamp(health - cost, 0, 100);
      if (next !== health) events.push({ type: "health_changed", delta: next - health, reason: double ? "double_miss" : "miss" });
      health = next;
      continue;
    }

    const full = entry.result === "full";
    const points = Math.round((full ? config.points.habitFull : config.points.habitMinimum) * mult);
    const earned = full ? config.credits.habitFull : config.credits.habitMinimum;
    score += points;
    credits += earned;
    events.push({ type: "points", score: points, credits: earned, reason: "habit" });

    const next = clamp(health + (full ? config.health.fullRestore : config.health.minimumRestore), 0, 100);
    if (next !== health) events.push({ type: "health_changed", delta: next - health, reason: "habit" });
    health = next;

    strengthDelta += full ? config.strength.fullGain : config.strength.minimumGain;
    weekProgress[habit.area] = true;
  }

  const nextStrength = clamp(strength + strengthDelta, 0, 100);
  if (nextStrength !== strength) events.push({ type: "strength_changed", delta: nextStrength - strength });
  strength = nextStrength;

  const habits = state.habits.map((h): HabitWithLastResult => {
    const entry = entries.get(h.id);
    return entry ? { ...h, lastResult: entry.result } : h;
  });

  return {
    state: {
      ...state,
      today: checkIn.date,
      score,
      credits,
      habits,
      character: { ...state.character, health, strength, graceDaysLeft },
      weekProgress,
    },
    events,
  };
}
