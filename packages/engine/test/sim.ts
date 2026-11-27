/**
 * Long-run simulation harness for the engine tests. A seeded player plays the sample state day by day:
 * a check-in every night, the weekly rollover and Sunday review every Sunday.
 */
import { DEFAULT_RULES, type CheckInEntry, type GameEvent, type GameState, type IsoDate, type ResistanceId, type RulesConfig } from "@second-half/contracts";
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

export interface SimOptions {
  days?: number;
  config?: RulesConfig;
  start?: GameState;
}

/** A new player at 101: ring 101 open, everything above hidden, average strength, Resistance at its floor. */
export const FRESH_START: GameState = {
  ...SAMPLE_STATE,
  level: 1,
  score: 0,
  credits: 0,
  goals: SAMPLE_STATE.goals.map((g) => ({
    ...g,
    status: g.level === 1 ? "open" : "hidden",
    progress: 0,
    risk: 0,
    frozen: false,
    lockedInOn: undefined,
  })),
  resistance: Object.fromEntries(Object.entries(SAMPLE_STATE.resistance).map(([k, v]) => [k, { ...v, strength: 1, reports14d: 0 }])) as GameState["resistance"],
  character: { health: DEFAULT_RULES.health.start, strength: 50, graceDaysLeft: DEFAULT_RULES.grace.perMonth },
};

/** Plays `days` nights from the day after the start state's `today`. Returns every step. */
export function simulate(profile: Profile, seed: number, options: SimOptions = {}): Step[] {
  const { days = 364, config = DEFAULT_RULES, start = SAMPLE_STATE } = options;
  const r = rng(seed);
  let state = start;
  const steps: Step[] = [];
  const push = (kind: Step["kind"], date: IsoDate, result: { state: GameState; events: GameEvent[] }) => {
    steps.push({ date, kind, before: state, state: result.state, events: result.events });
    state = result.state;
  };

  for (let i = 0; i < days; i++) {
    const date = addDays(start.today, i + 1);
    const plan = profile(i);
    state = retarget(state);
    const entries: CheckInEntry[] = state.habits
      .filter((h) => state.modes[h.area] !== "rest")
      .map((h) =>
        r() < plan.done
          ? { habitId: h.id, result: r() < plan.full ? "full" : "minimum" }
          : { habitId: h.id, result: "missed", reason: pick(r, plan.reasons) },
      );
    push("day", date, closeDay(state, { date, entries }, config));
    if (isSunday(date)) {
      push("week", date, closeWeek(state, date, config));
      if (plan.done > 0) push("review", date, closeReview(state, date, config));
    }
  }
  return steps;
}

/** Numbers for the report: where each run ends and what happened along the way. */
export function summary(steps: Step[]) {
  const first = steps[0]!.before;
  const last = steps[steps.length - 1]!.state;
  const days = steps.filter((s) => s.kind === "day");
  const count = (type: GameEvent["type"]) => steps.reduce((n, s) => n + s.events.filter((e) => e.type === type).length, 0);
  const health = days.map((s) => s.state.character.health);
  const strength = days.map((s) => s.state.character.strength);
  const levelDay = (l: number) => {
    const i = days.findIndex((s) => s.state.level >= l);
    return i < 0 ? null : i + 1;
  };
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) / 10;
  const setbackDays = days.map((s) => s.events.filter((e) => e.type === "setback").length);
  return {
    level: last.level,
    scoreGain: last.score - first.score,
    healthMin: Math.min(...health),
    healthMean: mean(health),
    /** Mean health from week 13 on, once the start state has washed out. */
    healthMeanLate: mean(health.slice(84)),
    daysBelow35: health.filter((h) => h < 35).length,
    knockedDown: count("knocked_down"),
    strengthDay42: strength[41] ?? null,
    strengthDay84: strength[83] ?? null,
    strengthMeanLate: mean(strength.slice(84)),
    strengthEnd: last.character.strength,
    setbacks: count("setback"),
    setbacksPerWeek: Math.round((setbackDays.reduce((a, b) => a + b, 0) / (days.length / 7)) * 100) / 100,
    rules: count("rule_adjusted"),
    groundLost: count("ground_lost"),
    levelLost: count("level_lost"),
    recoveriesStarted: count("recovery_started"),
    recoveriesCompleted: steps.reduce((n, s) => n + s.events.filter((e) => e.type === "recovery_ended" && e.completed).length, 0),
    /** Day (1-based) each level was first reached. */
    reached: { 2: levelDay(2), 3: levelDay(3), 4: levelDay(4), 5: levelDay(5) },
  };
}

export type Summary = ReturnType<typeof summary>;

/**
 * Balance harness: plays every profile for `seeds` from `start` under `config` and returns the summaries.
 * Use it to compare rule sets: `balance(myRules)` and read the numbers against the targets.
 */
export function balance(config: RulesConfig = DEFAULT_RULES, options: { seeds?: number[]; days?: number; start?: GameState } = {}) {
  const { seeds = [1, 7, 42], days = 364, start = FRESH_START } = options;
  return Object.fromEntries(
    (Object.keys(PROFILES) as (keyof typeof PROFILES)[]).map((name) => [
      name,
      seeds.map((seed) => summary(simulate(PROFILES[name], seed, { days, config, start }))),
    ]),
  ) as Record<keyof typeof PROFILES, Summary[]>;
}
