import type {
  CheckInEntry,
  Habit,
  IsoDate,
  ResistanceId,
  RuleAdjustment,
  RuleEffect,
  RulesConfig,
} from "@second-half/contracts";

const DAY_MS = 864e5;
export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
export const addDays = (d: IsoDate, n: number): IsoDate => new Date(Date.parse(d) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (d: IsoDate) => new Date(Date.parse(d)).getUTCDay();

export const RESISTANCE_NAMES: Record<ResistanceId, string> = {
  fatigue: "Fatigue",
  no_time: "No Time",
  temptation: "Temptation",
  stress: "Stress",
  avoidance: "Avoidance",
};

/** Rule adjustments in force on `date`: from `startsOn` up to, not including, `endsOn`. */
export const activeRules = (rules: RuleAdjustment[], date: IsoDate) => rules.filter((r) => r.startsOn <= date && date < r.endsOn);

export function hasEffect(rules: RuleAdjustment[], kind: RuleEffect["kind"], habitId: string) {
  return rules.find((r) => r.effect.kind === kind && r.effect.habitId === habitId);
}

/**
 * The Resistance that usually beats this habit on this weekday: a miss with a reason on the same weekday
 * in the habit's history (before today). Doing the habit on such a day knocks that Resistance down.
 */
export function usualMissOn(habit: Habit, date: IsoDate): ResistanceId | undefined {
  const day = weekday(date);
  const counts = new Map<ResistanceId, number>();
  for (const h of habit.history) {
    if (h.date === date || h.result !== "missed" || !h.reason || weekday(h.date) !== day) continue;
    counts.set(h.reason, (counts.get(h.reason) ?? 0) + 1);
  }
  let best: ResistanceId | undefined;
  for (const [id, n] of counts) if (!best || n > counts.get(best)!) best = id;
  return best;
}

/** Times a Resistance was reported across all habits in the kept history window. */
export const reportsIn = (habits: Habit[], id: ResistanceId) =>
  habits.reduce((n, h) => n + h.history.filter((d) => d.result === "missed" && d.reason === id).length, 0);

/**
 * The adaptive rule for a Resistance that caused a setback: for `adaptation.ruleWeeks` weeks, the minimum
 * version of the habit it beats most counts as a full one.
 */
export function adjustmentFor(
  id: ResistanceId,
  habits: Habit[],
  todaysMisses: CheckInEntry[],
  date: IsoDate,
  config: RulesConfig,
): RuleAdjustment | undefined {
  const candidates = todaysMisses.filter((e) => e.reason === id).map((e) => habits.find((h) => h.id === e.habitId)!);
  const beaten = (h: Habit) => h.history.filter((d) => d.result === "missed" && d.reason === id).length;
  const habit = candidates.sort((a, b) => beaten(b) - beaten(a))[0];
  if (!habit) return undefined;

  const weeks = config.adaptation.ruleWeeks;
  const reports = reportsIn(habits, id);
  return {
    id: `rule-${id}-${date}`,
    trigger: id,
    message:
      `${RESISTANCE_NAMES[id]} beat you ${reports} ${reports === 1 ? "time" : "times"} in ${config.history.days} days. ` +
      `For the next ${weeks} ${weeks === 1 ? "week" : "weeks"}, the minimum ${habit.title.toLowerCase()} ` +
      `(${habit.minimumDose.toLowerCase()}) counts as a full one.`,
    effect: { kind: "minimum_counts_as_full", habitId: habit.id },
    startsOn: date,
    endsOn: addDays(date, weeks * 7),
  };
}
