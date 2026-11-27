import type { AreaId, GameState, Goal, Habit, Level, ResistanceId, ResistanceState } from "./index";

/**
 * The sample player used across all prototypes: age 42, Level 201.
 * Body, Mind and Work 101 locked in; People 101 half done; Money 101 at 60% risk from Temptation.
 * Every stream builds against this until real data exists.
 */
const g = (
  area: AreaId,
  level: Exclude<Level, 5>,
  title: string,
  kind: Goal["kind"],
  status: Goal["status"],
  progress = 0,
  risk = 0,
): Goal => ({ id: `${area}-${level}01`, area, level, title, kind, status, progress, risk, frozen: false });

const GOALS: Goal[] = [
  g("body", 1, "Run a 5K", "milestone", "locked_in", 1),
  g("mind", 1, "Meditate 30 days straight", "system", "locked_in", 1),
  g("work", 1, "Ship the side project", "milestone", "locked_in", 1),
  g("people", 1, "Host dinner 6 times", "system", "in_progress", 0.5),
  g("money", 1, "$5,000 emergency fund", "milestone", "at_risk", 1, 60),
  g("body", 2, "Run a 10K", "milestone", "in_progress", 0.4),
  g("mind", 2, "Silent weekend retreat", "milestone", "in_progress", 0.2),
  g("work", 2, "First $1,000 from your craft", "milestone", "open"),
  g("money", 2, "Pay off the car", "milestone", "open"),
  g("people", 2, "Trip with old friends", "milestone", "hidden"),
  g("body", 3, "Half marathon", "milestone", "hidden"),
  g("mind", 3, "Teach what you practice", "system", "hidden"),
  g("work", 3, "Craft covers 25% of income", "milestone", "hidden"),
  g("people", 3, "Host a yearly gathering", "system", "hidden"),
  g("money", 3, "Debt-free", "milestone", "hidden"),
  g("body", 4, "A body that lasts to 84", "system", "hidden"),
  g("mind", 4, "Mentor three people", "system", "hidden"),
  g("work", 4, "Work on your own terms", "milestone", "hidden"),
  g("people", 4, "The family table", "system", "hidden"),
  g("money", 4, "Financial independence", "milestone", "hidden"),
];

const h = (id: string, goalId: string, area: AreaId, title: string, fullDose: string, minimumDose: string, focus: number, maintain: number): Habit => ({
  id, goalId, area, title, fullDose, minimumDose, weeklyTarget: { focus, maintain, rest: 0 }, maintenance: false,
});

const HABITS: Habit[] = [
  h("run", "body-201", "body", "Tempo run", "25 minutes", "15-minute easy jog", 4, 2),
  h("meditate", "mind-101", "mind", "Meditate", "10 minutes", "Three slow breaths", 7, 5),
  h("deep-work", "work-201", "work", "Deep work", "90 minutes, phone in another room", "One 25-minute sprint", 5, 2),
  h("no-impulse", "money-101", "money", "No impulse purchases", "No unplanned purchases", "Logged every purchase", 7, 5),
  h("reach-out", "people-101", "people", "Reach out to a friend", "Call or see someone", "Send one message", 3, 2),
];

const r = (id: ResistanceId, targetArea: AreaId, strength: number, reports14d: number): ResistanceState => ({ id, targetArea, strength, reports14d });

export const SAMPLE_STATE: GameState = {
  userId: "sample",
  birthYear: 1984,
  endAge: 84,
  today: "2026-11-26",
  level: 2,
  score: 61840,
  credits: 1240,
  modes: { body: "focus", work: "focus", mind: "maintain", people: "maintain", money: "maintain" },
  goals: GOALS,
  programs: [],
  habits: HABITS,
  resistance: {
    fatigue: r("fatigue", "body", 2, 3),
    no_time: r("no_time", "work", 3, 4),
    temptation: r("temptation", "money", 5, 6),
    stress: r("stress", "mind", 1, 1),
    avoidance: r("avoidance", "people", 2, 2),
  },
  gamePlans: [
    { id: "gp-fatigue", resistance: "fatigue", text: "If I'm tired, I do the 15-minute version and it counts.", equipped: false },
    { id: "gp-temptation", resistance: "temptation", text: "Anything over $50 waits 48 hours in a cart.", equipped: false },
  ],
  rules: [],
  character: { health: 72, strength: 64, graceDaysLeft: 2 },
  recovery: null,
  season: { index: 1, startsOn: "2026-10-26", focus: ["body", "work"], autoRecoveryUsed: false, lifeEventPauseUsed: false },
  weekProgress: {},
};
