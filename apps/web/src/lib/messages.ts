import type { GameEvent, GameState, RulesConfig } from "@second-half/contracts";
import { levelName } from "./hud";
import { AREA_META, RESISTANCE_META, fmt, levelCode, signed } from "./labels";

export type ToastKind = "good" | "bad" | "info";
export interface Toast {
  title: string;
  body: string;
  kind: ToastKind;
}

/** "Money 101", or "That goal" if the id is unknown. */
export function goalLabel(state: GameState, goalId: string): string {
  const g = state.goals.find((x) => x.id === goalId);
  return g ? `${AREA_META[g.area].name} ${levelCode(g.level)}` : "That goal";
}

/**
 * One summary line for a batch of events: points, credits, grace, health and strength.
 * Returns null when nothing in the batch is worth summing up.
 */
export function summarize(events: readonly GameEvent[]): { body: string; kind: ToastKind } | null {
  let score = 0;
  let credits = 0;
  let missHealth = 0;
  let graceUsed = 0;
  let strength = 0;
  for (const e of events) {
    if (e.type === "points") {
      score += e.score;
      credits += e.credits;
    } else if (e.type === "grace_used") graceUsed += 1;
    else if (e.type === "health_changed" && (e.reason === "miss" || e.reason === "double_miss")) missHealth += e.delta;
    else if (e.type === "strength_changed") strength += e.delta;
  }
  const parts: string[] = [];
  if (score) parts.push(`${signed(score)} points`);
  if (credits) parts.push(`${signed(credits)} credits`);
  if (graceUsed) parts.push(`${graceUsed} ${graceUsed === 1 ? "miss" : "misses"} covered by grace`);
  if (missHealth) parts.push(`${signed(missHealth)} health`);
  const s = Math.round(strength);
  if (s) parts.push(`${signed(s)} strength`);
  if (!parts.length) return null;
  return { body: `${parts.join(" · ")}.`, kind: score > 0 && missHealth >= 0 && s >= 0 ? "good" : missHealth < 0 || s < 0 ? "bad" : "info" };
}

/** The toast for one event, or null for events that only feed the summary or the scene. */
export function eventToast(e: GameEvent, after: GameState, rules: RulesConfig): Toast | null {
  const goal = (id: string) => goalLabel(after, id);
  switch (e.type) {
    case "setback": {
      const name = RESISTANCE_META[e.resistance].name;
      return {
        title: "Setback",
        body: `${name} hit strength ${rules.resistance.setbackAt}. That cost you ${e.damage} health. A game plan against it softens the next one.`,
        kind: "bad",
      };
    }
    case "locked_in":
      return { title: "Locked in", body: `${goal(e.goalId)} is locked in. It pays points every week from here on, as long as you keep moving.`, kind: "good" };
    case "at_risk":
      return { title: "At risk", body: `${goal(e.goalId)} is at ${Math.round(e.risk)}% risk. Clean days take it back down.`, kind: "bad" };
    case "risk_cleared":
      return { title: "Coach", body: `${goal(e.goalId)} is safe again.`, kind: "good" };
    case "ground_lost":
      return {
        title: "Lost ground",
        body: `${goal(e.goalId)} is lost. Its weekly points stop until you win it back from ${Math.round(rules.risk.lostRestartProgress * 100)}%.`,
        kind: "bad",
      };
    case "level_up":
      return { title: "Level up", body: `You're on Level ${levelCode(e.level)} · ${levelName(after, e.level)}.`, kind: "good" };
    case "level_lost":
      return { title: "Coach", body: `You're back to Level ${levelCode(e.level)}. Progress above it is frozen, not gone.`, kind: "bad" };
    case "rule_adjusted":
      return { title: "Game plan", body: e.rule.message, kind: "info" };
    case "recovery_started":
      return {
        title: "Recovery mode",
        body: `For ${rules.recovery.days} days only one small habit counts. Decay and Resistance are frozen. Do it ${rules.recovery.daysNeeded} of ${rules.recovery.days} days to get back to ${rules.recovery.restoreHealth} health.`,
        kind: "info",
      };
    case "recovery_ended":
      return e.completed
        ? { title: "Coach", body: "Recovery done. The board is live again.", kind: "good" }
        : { title: "Coach", body: "Recovery ended. Pick the one habit that matters most tomorrow.", kind: "info" };
    case "knocked_down":
      return {
        title: "Knocked down",
        body: `Health hit ${rules.health.knockedDownAt}. Log any ${rules.health.getUpAfterPlays} habits to get back up at ${rules.health.getUpHealth} health.`,
        kind: "bad",
      };
    case "ready_to_verify": {
      const g = after.goals.find((x) => x.id === e.goalId);
      const proof = g?.verification ? ` What proves it: ${g.verification}.` : "";
      return { title: "Ready", body: `${goal(e.goalId)} is ready to lock in once you've done the real thing.${proof}`, kind: "good" };
    }
    case "verified":
      return { title: "Verified", body: `${goal(e.goalId)}: achievement logged.`, kind: "good" };
    case "plan_rejected":
      return { title: "Coach", body: e.reason, kind: "info" };
    case "game_plan_refused":
      return { title: "Coach", body: `You can run ${e.max} game plans at once. Take one off before adding another.`, kind: "info" };
    case "maintenance_cap":
      return {
        title: "Coach",
        body: `You're keeping ${e.count} weekly maintenance habits. The cap is ${e.max}. Merge, convert or retire one to keep the load light.`,
        kind: "info",
      };
    default:
      return null;
  }
}

/**
 * Coach-voice toasts for a batch of events: an optional summary (e.g. "Day closed"), then one toast
 * per event worth its own moment. Voice rules: state the number, say what happens next, never shame.
 */
export function toastsFor(events: readonly GameEvent[], after: GameState, rules: RulesConfig, summaryTitle?: string): Toast[] {
  const out: Toast[] = [];
  if (summaryTitle) {
    const s = summarize(events);
    out.push({ title: summaryTitle, body: s?.body ?? "Nothing logged.", kind: s?.kind ?? "info" });
  }
  for (const e of events) {
    const t = eventToast(e, after, rules);
    if (t) out.push(t);
  }
  return out;
}

/** Toasts after closing a day. */
export const toastsForDay = (events: readonly GameEvent[], after: GameState, rules: RulesConfig) => toastsFor(events, after, rules, "Day closed");

/** Toasts after the Sunday rollover. */
export const toastsForWeek = (events: readonly GameEvent[], after: GameState, rules: RulesConfig) => toastsFor(events, after, rules, "Week closed");

export { fmt };
