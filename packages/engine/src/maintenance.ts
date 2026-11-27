import type { GameEvent, GameState, RulesConfig } from "@second-half/contracts";

/**
 * Maintenance cap. Locked-in ground needs one weekly maintenance habit per system goal; past
 * `maintenance.maxWeeklyHabits` the UI asks the player to merge, convert or retire one. Counts maintenance
 * habits whose goal is a locked-in or at-risk system goal. Returns the event, or undefined within the cap.
 */
export function maintenanceCap(state: GameState, config: RulesConfig): GameEvent | undefined {
  const held = new Set(
    state.goals.filter((g) => g.kind === "system" && (g.status === "locked_in" || g.status === "at_risk")).map((g) => g.id),
  );
  const habitIds = state.habits.filter((h) => h.maintenance && held.has(h.goalId)).map((h) => h.id);
  const max = config.maintenance.maxWeeklyHabits;
  return habitIds.length > max ? { type: "maintenance_cap", count: habitIds.length, max, habitIds } : undefined;
}
