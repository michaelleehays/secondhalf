import type { CheckInEntry, Habit, HabitDay, IsoDate, RulesConfig } from "@second-half/contracts";
import { daysBetween } from "./resistance";

/** Appends each habit's entry for `date` to its history and keeps the last `history.days` days. */
export function appendHistory(
  habits: Habit[],
  entries: Map<string, CheckInEntry>,
  graced: Set<string>,
  date: IsoDate,
  config: RulesConfig,
): Habit[] {
  return habits.map((h): Habit => {
    const entry = entries.get(h.id);
    if (!entry) return h;
    const today: HabitDay = {
      date,
      result: entry.result,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(graced.has(h.id) ? { graced: true } : {}),
    };
    const history = [...h.history, today].filter((d) => daysBetween(d.date, date) < config.history.days);
    return { ...h, history };
  });
}
