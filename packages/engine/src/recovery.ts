import {
  DEFAULT_RULES,
  type CheckIn,
  type CheckInEntry,
  type GameEvent,
  type GameState,
  type Habit,
  type IsoDate,
  type RecoveryState,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { appendHistory } from "./history";

/**
 * The recovery habit: the active habit (area not in Rest) with the most Done / Minimum check-ins in its
 * history, at its minimum dose. Ties go to habit order. The UI can let the player pick another.
 */
export function recoveryHabit(state: GameState): Habit | undefined {
  const active = state.habits.filter((h) => state.modes[h.area] !== "rest");
  const done = (h: Habit) => h.history.filter((d) => d.result !== "missed").length;
  return active.reduce<Habit | undefined>((best, h) => (!best || done(h) > done(best) ? h : best), undefined);
}

function begin(state: GameState, cause: RecoveryState["cause"], date: IsoDate): StepResult {
  const habit = recoveryHabit(state);
  const recovery: RecoveryState = {
    cause,
    startedOn: date,
    day: 1,
    daysDone: 0,
    habitTitle: habit ? `${habit.title}: ${habit.minimumDose}` : "",
  };
  const season = cause === "auto" ? { ...state.season, autoRecoveryUsed: true } : { ...state.season, lifeEventPauseUsed: true };
  return { state: { ...state, recovery, season }, events: [{ type: "recovery_started", cause }] };
}

/** True when Recovery should turn on by itself: health below `recovery.healthBelow` or `recovery.atRiskGoals`+ goals at risk. */
export function needsRecovery(state: GameState, config: RulesConfig): boolean {
  const atRisk = state.goals.filter((g) => g.status === "at_risk" && !g.frozen).length;
  return state.character.health < config.recovery.healthBelow || atRisk >= config.recovery.atRiskGoals;
}

/** Starts automatic Recovery after a step, once per season, unless it is already on. */
export function withAutoRecovery(result: StepResult, date: IsoDate, config: RulesConfig): StepResult {
  const { state } = result;
  if (state.recovery || state.season.autoRecoveryUsed || !needsRecovery(state, config)) return result;
  const started = begin(state, "auto", date);
  return { state: started.state, events: [...result.events, ...started.events] };
}

/**
 * A life event (illness, family emergency, heavy travel) the player logs. Starts Recovery once per season.
 * Does nothing, with no events, if Recovery is already on or this season's life-event pause is used.
 */
export function startLifeEvent(state: GameState, date: IsoDate, _config: RulesConfig = DEFAULT_RULES): StepResult {
  if (state.recovery || state.season.lifeEventPauseUsed) return { state, events: [] };
  return begin(state, "life_event", date);
}

/**
 * One closed day in Recovery. Decay, at-risk meters, grace and Resistance are frozen, and only the
 * recovery habit scores: a Done or Minimum entry on any habit counts as the recovery day and earns that
 * one habit's points (a full entry if there is one). Misses cost nothing and are recorded as covered,
 * so they never count toward the at-risk pattern, double misses or Resistance reports later.
 *
 * `recovery.daysNeeded` days done within `recovery.days` ends it: health rises to at least
 * `recovery.restoreHealth`. Running out of days ends it without the boost.
 */
export function recoveryDay(state: GameState, checkIn: CheckIn, config: RulesConfig = DEFAULT_RULES): StepResult {
  const recovery = state.recovery!;
  const events: GameEvent[] = [];
  const date = checkIn.date;
  const known = new Set(state.habits.map((h) => h.id));
  const entries = new Map<string, CheckInEntry>();
  for (const e of checkIn.entries) if (known.has(e.habitId)) entries.set(e.habitId, e);

  const missed = new Set([...entries.values()].filter((e) => e.result === "missed").map((e) => e.habitId));
  const habits = appendHistory(state.habits, entries, missed, date, config);

  const done = [...entries.values()].filter((e) => e.result !== "missed");
  const best = done.find((e) => e.result === "full") ?? done[0];
  let { score, credits } = state;
  const weekProgress = { ...state.weekProgress };
  if (best) {
    const full = best.result === "full";
    const points = Math.round((full ? config.points.habitFull : config.points.habitMinimum) * config.levelMultiplier[state.level]);
    const earned = full ? config.credits.habitFull : config.credits.habitMinimum;
    score += points;
    credits += earned;
    events.push({ type: "points", score: points, credits: earned, reason: "habit", sourceId: best.habitId });
    for (const e of done) weekProgress[state.habits.find((h) => h.id === e.habitId)!.area] = true;
  }

  const daysDone = recovery.daysDone + (best ? 1 : 0);
  let health = state.character.health;
  let next: RecoveryState | null = { ...recovery, day: recovery.day + 1, daysDone };
  if (daysDone >= config.recovery.daysNeeded) {
    const restored = Math.max(health, config.recovery.restoreHealth);
    if (restored !== health) events.push({ type: "health_changed", delta: restored - health, reason: "recovery" });
    health = restored;
    next = null;
    events.push({ type: "recovery_ended", completed: true });
  } else if (recovery.day >= config.recovery.days) {
    next = null;
    events.push({ type: "recovery_ended", completed: false });
  }

  return {
    state: { ...state, today: date, score, credits, habits, weekProgress, recovery: next, character: { ...state.character, health } },
    events,
  };
}
