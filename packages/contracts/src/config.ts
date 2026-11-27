/**
 * Tunable rule values. Starting numbers come from the game design doc.
 * The adaptive engine (later, server-side) tunes these per user; code must read them from here,
 * never hard-code them.
 */
export interface RulesConfig {
  points: {
    habitFull: number;
    habitMinimum: number;
    programWeek: number;
    goalLockedInPerLevel: number;
    weeklyReview: number;
    /** Weekly dividend per locked-in goal = this × goal level. */
    dividendPerLevel: number;
    /** Share of a milestone dividend that vests with no tracking. */
    milestoneVestedShare: number;
  };
  credits: {
    habitFull: number;
    habitMinimum: number;
    programWeek: number;
    goalLockedInPerLevel: number;
    levelCleared: number;
    weeklyReview: number;
  };
  /** Score multiplier by level (index = level). */
  levelMultiplier: Record<1 | 2 | 3 | 4 | 5, number>;
  health: {
    max: number;
    start: number;
    missCost: number;
    /** Multiplier on missCost for a second miss in a row on the same habit. */
    doubleMissFactor: number;
    fullRestore: number;
    minimumRestore: number;
    setbackDamage: number;
    knockedDownAt: number;
    getUpAfterPlays: number;
    getUpHealth: number;
  };
  strength: {
    max: number;
    /** Strength a new player starts with. */
    start: number;
    /** Strength lost per miss that grace doesn't cover. 0 = off. */
    missCost: number;
    /** Share of current strength lost each night, so strength settles where gains and decay meet. 0 = off. */
    dailyDecay: number;
    idleWeekCost: number;
    fullGain: number;
    minimumGain: number;
  };
  grace: { perMonth: number; maxHeld: number };
  resistance: {
    max: number;
    setbackAt: number;
    /** Strength a Resistance drops to right after it causes a setback, so it cannot hit every day in a row. */
    afterSetback: number;
    gamePlanDamageFactor: number;
    maxEquippedPlans: number;
  };
  risk: {
    /** Misses beyond grace within `patternDays` days that put a system goal at risk. */
    missesToTrigger: number;
    /** Window, in days, for the at-risk miss pattern. */
    patternDays: number;
    /** Risk (0..100) a goal starts at when it goes at risk. */
    onTrigger: number;
    /** Risk added to an at-risk goal in the area a setback targets. */
    setbackPressure: number;
    perBadWeek: number;
    fullCleanDay: number;
    minimumCleanDay: number;
    lostRestartProgress: number;
  };
  levels: { goalsToClear: number };
  progress: {
    idleWeekDecay: number;
    /**
     * A week is "consistent" for a goal when its habits reach this share of their weekly targets
     * (a minimum check-in counts as `minimumWeight` of a full one).
     */
    consistentWeekShare: number;
    /** Weight of a minimum check-in toward the weekly target. */
    minimumWeight: number;
    /** Consistent weeks needed to lock in a goal (or reach verification for a milestone), by goal level. */
    weeksToLockIn: Record<1 | 2 | 3 | 4, number>;
    /**
     * Milestone goals stop at this progress until a real achievement verifies them
     * (Engine.verifyAchievement, or finishing their program).
     */
    milestoneVerifyAt: number;
    /** Progress removed from the in-progress goal in a setback's area when nothing there is at risk. */
    setbackLoss: number;
  };
  /** Days of check-in history kept per habit. */
  history: { days: number };
  maintenance: { maxWeeklyHabits: number };
  recovery: { healthBelow: number; atRiskGoals: number; days: number; daysNeeded: number; restoreHealth: number };
  adaptation: { ruleWeeks: number };
  program: { defaultThreshold: number };
  life: {
    /** The age a new game starts at: halftime. */
    startAge: number;
    defaultEndAge: number;
  };
  season: { weeks: number };
  journal: { maxEntries: number };
}

export const DEFAULT_RULES: RulesConfig = {
  points: {
    habitFull: 15,
    habitMinimum: 6,
    programWeek: 50,
    goalLockedInPerLevel: 500,
    weeklyReview: 25,
    dividendPerLevel: 15,
    milestoneVestedShare: 0.5,
  },
  credits: { habitFull: 10, habitMinimum: 4, programWeek: 25, goalLockedInPerLevel: 100, levelCleared: 500, weeklyReview: 10 },
  levelMultiplier: { 1: 1, 2: 1.25, 3: 1.5, 4: 1.75, 5: 2 },
  health: {
    max: 100,
    start: 80,
    missCost: 3,
    doubleMissFactor: 1.5,
    fullRestore: 5,
    minimumRestore: 3,
    setbackDamage: 7,
    knockedDownAt: 0,
    getUpAfterPlays: 3,
    getUpHealth: 30,
  },
  strength: { max: 100, start: 50, missCost: 0, dailyDecay: 0.018, idleWeekCost: 3, fullGain: 0.4, minimumGain: 0.3 },
  grace: { perMonth: 2, maxHeld: 4 },
  resistance: { max: 5, setbackAt: 5, afterSetback: 3, gamePlanDamageFactor: 0.5, maxEquippedPlans: 3 },
  risk: { missesToTrigger: 3, patternDays: 7, onTrigger: 25, setbackPressure: 10, perBadWeek: 25, fullCleanDay: 20, minimumCleanDay: 10, lostRestartProgress: 0.5 },
  levels: { goalsToClear: 4 },
  progress: {
    idleWeekDecay: 0.08,
    setbackLoss: 0.05,
    consistentWeekShare: 0.7,
    minimumWeight: 0.5,
    weeksToLockIn: { 1: 12, 2: 18, 3: 27, 4: 40 },
    milestoneVerifyAt: 0.8,
  },
  history: { days: 14 },
  maintenance: { maxWeeklyHabits: 6 },
  recovery: { healthBelow: 25, atRiskGoals: 2, days: 7, daysNeeded: 5, restoreHealth: 30 },
  adaptation: { ruleWeeks: 2 },
  program: { defaultThreshold: 3 },
  life: { startAge: 42, defaultEndAge: 84 },
  season: { weeks: 12 },
  journal: { maxEntries: 200 },
};
