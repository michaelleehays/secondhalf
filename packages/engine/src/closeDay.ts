import {
  DEFAULT_RULES,
  type CheckIn,
  type CheckInEntry,
  type GameEvent,
  type GameState,
  type Goal,
  type Habit,
  type HabitDay,
  type IsoDate,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Keeps progress sums like 0.97 + 0.03 from landing a hair under 1. */
const tidy = (n: number) => Math.round(n * 1e9) / 1e9;
const DAY_MS = 864e5;
const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

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
 * - Health and strength changes are summed and clamped once, so entry order never matters.
 * - Score is never taken away.
 *
 * Callers must close each date once: closing the same date twice counts it twice.
 */
export function closeDay(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  const events: GameEvent[] = [];
  const mult = config.levelMultiplier[state.level];
  const habitsById = new Map(state.habits.map((h) => [h.id, h]));

  // Only entries for habits the player has; one entry per habit (the last one wins).
  const entries = new Map<string, CheckInEntry>();
  for (const e of checkIn.entries) if (habitsById.has(e.habitId)) entries.set(e.habitId, e);

  let score = state.score;
  let credits = state.credits;
  let graceDaysLeft = state.character.graceDaysLeft;
  const weekProgress = { ...state.weekProgress };

  // Misses: decide which ones grace absorbs before any damage lands.
  const misses = [...entries.values()]
    .filter((e) => e.result === "missed")
    .map((e) => ({ habitId: e.habitId, double: lastWasMiss(habitsById.get(e.habitId)!) }));
  const graceOrder = [...misses].sort((a, b) => Number(b.double) - Number(a.double));
  const absorbed = new Set(graceOrder.slice(0, graceDaysLeft).map((m) => m.habitId));

  const health = { habit: 0, miss: 0, double_miss: 0 };
  let strengthGain = 0;
  const progressGain = new Map<string, number>();

  for (const entry of entries.values()) {
    const habit = habitsById.get(entry.habitId)!;

    if (entry.result === "missed") {
      if (absorbed.has(habit.id)) {
        graceDaysLeft -= 1;
        events.push({ type: "grace_used", habitId: habit.id });
      } else if (lastWasMiss(habit)) {
        health.double_miss -= config.health.missCost * config.health.doubleMissFactor;
      } else {
        health.miss -= config.health.missCost;
      }
      continue;
    }

    const full = entry.result === "full";
    const points = Math.round((full ? config.points.habitFull : config.points.habitMinimum) * mult);
    const earned = full ? config.credits.habitFull : config.credits.habitMinimum;
    score += points;
    credits += earned;
    events.push({ type: "points", score: points, credits: earned, reason: "habit" });

    health.habit += full ? config.health.fullRestore : config.health.minimumRestore;
    strengthGain += full ? config.strength.fullGain : config.strength.minimumGain;
    weekProgress[habit.area] = true;
    const step = full ? config.progress.perFull : config.progress.perMinimum;
    progressGain.set(habit.goalId, (progressGain.get(habit.goalId) ?? 0) + step);
  }

  // Health: sum, clamp once, then trim the events so they add up to what actually changed.
  const startHealth = state.character.health;
  const raw = startHealth + health.habit + health.miss + health.double_miss;
  const endHealth = clamp(raw, 0, config.health.max);
  if (raw > endHealth) health.habit -= raw - endHealth;
  if (raw < endHealth) {
    let give = endHealth - raw;
    for (const key of ["miss", "double_miss"] as const) {
      const back = Math.min(give, -health[key]);
      health[key] += back;
      give -= back;
    }
  }
  for (const reason of ["habit", "miss", "double_miss"] as const) {
    if (health[reason] !== 0) events.push({ type: "health_changed", delta: health[reason], reason });
  }

  const startStrength = state.character.strength;
  const endStrength = clamp(startStrength + strengthGain, 0, config.strength.max);
  if (endStrength !== startStrength) events.push({ type: "strength_changed", delta: endStrength - startStrength });

  // Goal progress and lock-ins.
  const goals = state.goals.map((goal): Goal => {
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
    events.push({ type: "points", score: bonus, credits: bonusCredits, reason: "goal_locked_in" });
    return { ...goal, progress: 1, status: "locked_in", risk: 0, lockedInOn: checkIn.date };
  });

  // History: append today's result and keep the last `history.days` days.
  const habits = state.habits.map((h): Habit => {
    const entry = entries.get(h.id);
    if (!entry) return h;
    const today: HabitDay = { date: checkIn.date, result: entry.result, ...(entry.reason ? { reason: entry.reason } : {}) };
    const history = [...h.history, today].filter((d) => daysBetween(d.date, checkIn.date) < config.history.days);
    return { ...h, history };
  });

  return {
    state: {
      ...state,
      today: checkIn.date,
      score,
      credits,
      goals,
      habits,
      character: { ...state.character, health: endHealth, strength: endStrength, graceDaysLeft },
      weekProgress,
    },
    events,
  };
}
