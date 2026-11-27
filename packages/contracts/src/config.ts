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
    idleWeekCost: number;
    fullGain: number;
    minimumGain: number;
  };
  grace: { perMonth: number; maxHeld: number };
  resistance: { max: number; setbackAt: number; gamePlanDamageFactor: number; maxEquippedPlans: number };
  risk: {
    /** Misses beyond grace within 7 days that put a system goal at risk. */
    missesToTrigger: number;
    perBadWeek: number;
    fullCleanDay: number;
    minimumCleanDay: number;
    lostRestartProgress: number;
  };
  levels: { goalsToClear: number };
  progress: {
    idleWeekDecay: number;
    /** Goal progress (0..1) added by one full check-in of a habit that serves the goal, unless the goal has a program. */
    perFull: number;
    /** Goal progress added by one minimum check-in. */
    perMinimum: number;
  };
  /** Days of check-in history kept per habit. */
  history: { days: number };
  maintenance: { maxWeeklyHabits: number };
  recovery: { healthBelow: number; atRiskGoals: number; days: number; daysNeeded: number; restoreHealth: number };
  adaptation: { ruleWeeks: number };
  program: { defaultThreshold: number };
  life: { defaultEndAge: number };
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
    start: 80,
    missCost: 6,
    doubleMissFactor: 2,
    fullRestore: 3,
    minimumRestore: 1,
    setbackDamage: 12,
    knockedDownAt: 0,
    getUpAfterPlays: 3,
    getUpHealth: 30,
  },
  strength: { idleWeekCost: 3, fullGain: 1, minimumGain: 0.5 },
  grace: { perMonth: 2, maxHeld: 4 },
  resistance: { max: 5, setbackAt: 5, gamePlanDamageFactor: 0.5, maxEquippedPlans: 3 },
  risk: { missesToTrigger: 3, perBadWeek: 25, fullCleanDay: 20, minimumCleanDay: 10, lostRestartProgress: 0.5 },
  levels: { goalsToClear: 4 },
  progress: { idleWeekDecay: 0.08, perFull: 0.07, perMinimum: 0.03 },
  history: { days: 14 },
  maintenance: { maxWeeklyHabits: 6 },
  recovery: { healthBelow: 25, atRiskGoals: 2, days: 7, daysNeeded: 5, restoreHealth: 30 },
  adaptation: { ruleWeeks: 2 },
  program: { defaultThreshold: 3 },
  life: { defaultEndAge: 84 },
};
