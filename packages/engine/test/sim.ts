/**
 * Long-run simulation harness for the engine tests. A seeded player plays the sample state day by day:
 * a check-in every night, the weekly rollover and Sunday review every Sunday.
 */
import { AREAS, DEFAULT_RULES, type CheckInEntry, type GameEvent, type GameState, type IsoDate, type ResistanceId } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { closeDay, closeReview, closeWeek } from "../src/index";

/** mulberry32: small, fast, seeded. No Math.random anywhere in the simulation. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DayPlan {
  /** Chance each habit is done (full or minimum) tonight. */
  done: number;
  /** Share of done entries that are full rather than minimum. */
  full: number;
  /** Reasons for misses with their weights. */
  reasons: [ResistanceId, number][];
}

export type Profile = (day: number) => DayPlan;

const ALL_REASONS: [ResistanceId, number][] = [["fatigue", 1], ["no_time", 1], ["temptation", 1], ["stress", 1], ["avoidance", 1]];

export const PROFILES: Record<"consistent" | "struggling" | "collapse", Profile> = {
  consistent: () => ({ done: 0.9, full: 0.8, reasons: ALL_REASONS }),
  struggling: () => ({ done: 0.5, full: 0.5, reasons: [["fatigue", 0.45], ["no_time", 0.45], ["stress", 0.1]] }),
  // Two great months, a month of misses, then a steady recovery.
  collapse: (day) =>
    day < 61 ? { done: 0.95, full: 0.85, reasons: ALL_REASONS }
    : day < 91 ? { done: 0, full: 0, reasons: [["fatigue", 0.4], ["stress", 0.4], ["no_time", 0.2]] }
    : { done: 0.8, full: 0.6, reasons: ALL_REASONS },
};

const addDays = (d: IsoDate, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const isSunday = (d: IsoDate) => new Date(Date.parse(d)).getUTCDay() === 0;

function pick<T>(r: () => number, weighted: [T, number][]): T {
  const total = weighted.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of weighted) if ((x -= w) <= 0) return v;
  return weighted[weighted.length - 1]![0];
}

/**
 * What the app does for the player between nights: once a habit's goal is locked in, point the habit at the
 * next goal in its area that is open or in progress on the current level or below.
 */
function retarget(state: GameState): GameState {
  const habits = state.habits.map((h) => {
    const goal = state.goals.find((g) => g.id === h.goalId);
    if (!goal || (goal.status !== "locked_in" && goal.status !== "hidden")) return h;
    const next = state.goals
      .filter((g) => g.area === h.area && g.level <= state.level && !g.frozen && (g.status === "open" || g.status === "in_progress" || g.status === "lost"))
      .sort((a, b) => a.level - b.level)[0];
    return next ? { ...h, goalId: next.id } : h;
  });
  return { ...state, habits };
}

export interface Step {
  date: IsoDate;
  kind: "day" | "week" | "review";
  before: GameState;
  state: GameState;
  events: GameEvent[];
}

/** Plays `days` nights from the day after SAMPLE_STATE.today. Returns every step. */
export function simulate(profile: Profile, seed: number, days = 364): Step[] {
  const r = rng(seed);
  let state = SAMPLE_STATE;
  const steps: Step[] = [];
  const push = (kind: Step["kind"], date: IsoDate, result: { state: GameState; events: GameEvent[] }) => {
    steps.push({ date, kind, before: state, state: result.state, events: result.events });
    state = result.state;
  };

  for (let i = 0; i < days; i++) {
    const date = addDays(SAMPLE_STATE.today, i + 1);
    const plan = profile(i);
    state = retarget(state);
    const entries: CheckInEntry[] = state.habits
      .filter((h) => state.modes[h.area] !== "rest")
      .map((h) =>
        r() < plan.done
          ? { habitId: h.id, result: r() < plan.full ? "full" : "minimum" }
          : { habitId: h.id, result: "missed", reason: pick(r, plan.reasons) },
      );
    push("day", date, closeDay(state, { date, entries }, DEFAULT_RULES));
    if (isSunday(date)) {
      push("week", date, closeWeek(state, date, DEFAULT_RULES));
      if (plan.done > 0) push("review", date, closeReview(state, date, DEFAULT_RULES));
    }
  }
  return steps;
}

/** Numbers for the report: where each run ends and what happened along the way. */
export function summary(steps: Step[]) {
  const last = steps[steps.length - 1]!.state;
  const count = (type: GameEvent["type"]) => steps.reduce((n, s) => n + s.events.filter((e) => e.type === type).length, 0);
  const health = steps.filter((s) => s.kind === "day").map((s) => s.state.character.health);
  return {
    level: last.level,
    score: last.score,
    scoreGain: last.score - SAMPLE_STATE.score,
    credits: last.credits,
    health: last.character.health,
    minHealth: Math.min(...health),
    strength: last.character.strength,
    lockedIn: last.goals.filter((g) => g.status === "locked_in").length,
    atRisk: last.goals.filter((g) => g.status === "at_risk").length,
    lost: last.goals.filter((g) => g.status === "lost").length,
    setbacks: count("setback"),
    rules: count("rule_adjusted"),
    groundLost: count("ground_lost"),
    levelUps: count("level_up"),
    levelLost: count("level_lost"),
    recoveries: count("recovery_started"),
    knockedDown: count("knocked_down"),
    daysKnockedDown: steps.filter((s) => s.kind === "day" && s.state.character.knockedDown).length,
    resistance: Object.fromEntries(AREAS.length ? Object.values(last.resistance).map((x) => [x.id, x.strength]) : []),
  };
}
