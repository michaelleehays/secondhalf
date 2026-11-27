import {
  DEFAULT_RULES,
  type AreaId,
  type GameEvent,
  type GameState,
  type Goal,
  type IsoDate,
  type JournalEntry,
  type Level,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";
import { RESISTANCE_NAMES } from "./resistance";

export const DEFAULT_LEVEL_NAMES: Record<Level, string> = { 1: "Foundations", 2: "Momentum", 3: "Mastery", 4: "Legacy", 5: "The Vision" };
const AREA_NAMES: Record<AreaId, string> = { body: "Body", mind: "Mind", work: "Work", people: "People", money: "Money" };

/** Level names to show: the player's own over the defaults. */
export const levelNames = (state: GameState): Record<Level, string> => ({ ...DEFAULT_LEVEL_NAMES, ...state.levelNames });

const ring = (level: Level) => `${level}01`;
const where = (g: Goal) => `${AREA_NAMES[g.area]} ${ring(g.level)}`;

/**
 * Journal entries for a step's notable events, in coach voice. `before` is the state the step started from,
 * so `at_risk` is recorded only when a goal goes at risk, not each time its meter moves.
 */
export function journalEntries(before: GameState, after: GameState, events: GameEvent[], date: IsoDate, config: RulesConfig): JournalEntry[] {
  const goalOf = (id: string) => after.goals.find((g) => g.id === id) ?? before.goals.find((g) => g.id === id);
  const names = levelNames(after);
  const out: JournalEntry[] = [];
  const forGoal = (kind: JournalEntry["kind"], goalId: string, label: (g: Goal) => string) => {
    const g = goalOf(goalId);
    if (g) out.push({ date, kind, area: g.area, goalId, label: label(g) });
  };

  for (const e of events) {
    switch (e.type) {
      case "locked_in":
        forGoal("locked_in", e.goalId, (g) => `${where(g)} locked in: ${g.title}.`);
        break;
      case "verified":
        forGoal("verified", e.goalId, (g) => `Verified: ${g.title}${e.note ? ` (${e.note})` : ""}.`);
        break;
      case "ready_to_verify":
        forGoal("ready_to_verify", e.goalId, (g) => `${g.title} is ready to verify.`);
        break;
      case "at_risk":
        if (before.goals.find((g) => g.id === e.goalId)?.status !== "at_risk") {
          forGoal("at_risk", e.goalId, (g) => `${where(g)} at ${Math.round(e.risk)}% risk.`);
        }
        break;
      case "risk_cleared":
        forGoal("risk_cleared", e.goalId, (g) => `${where(g)} is safe again.`);
        break;
      case "ground_lost":
        forGoal("ground_lost", e.goalId, (g) => `${where(g)} lost ground. Win it back from ${Math.round(g.progress * 100)}%.`);
        break;
      case "setback":
        out.push({
          date,
          kind: "setback",
          area: after.resistance[e.resistance].targetArea,
          label: `${RESISTANCE_NAMES[e.resistance]} setback: −${e.damage} health.`,
        });
        break;
      case "level_up":
        out.push({ date, kind: "level_up", label: `Reached ${ring(e.level)} · ${names[e.level]}.` });
        break;
      case "level_lost":
        out.push({ date, kind: "level_lost", label: `Back to ${ring(e.level)} · ${names[e.level]}. Retake the ground to climb again.` });
        break;
      case "recovery_started":
        out.push({
          date,
          kind: "recovery_started",
          label: e.cause === "auto"
            ? `Recovery on: ${config.recovery.days} days, one habit.`
            : `Life event logged. Recovery on: ${config.recovery.days} days, one habit.`,
        });
        break;
      case "recovery_ended":
        out.push({
          date,
          kind: "recovery_ended",
          label: e.completed ? `Recovery done. Health back to at least ${config.recovery.restoreHealth}.` : "Recovery ended. Back to the full plan.",
        });
        break;
    }
  }
  return out;
}

/** Appends a step's journal entries to its state, oldest first, keeping the last `journal.maxEntries`. */
export function withJournal(before: GameState, result: StepResult, date: IsoDate, config: RulesConfig = DEFAULT_RULES): StepResult {
  const added = journalEntries(before, result.state, result.events, date, config);
  if (!added.length) return result;
  const journal = [...(result.state.journal ?? []), ...added].slice(-config.journal.maxEntries);
  return { state: { ...result.state, journal }, events: result.events };
}
