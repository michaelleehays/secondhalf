import type { GameEvent, GameState, RulesConfig } from "@second-half/contracts";
import { AREA_META, LEVEL_NAMES, RESISTANCE_META, levelCode, signed } from "./labels";

export type ToastKind = "good" | "bad" | "info";
export interface Toast {
  title: string;
  body: string;
  kind: ToastKind;
}

/**
 * Turns the events from closing a day into coach-voice toasts: one summary line, then one toast
 * per thing worth its own moment (setbacks, locked in, at risk, level changes, rule changes).
 * Voice rules: state the number, say what happens next, never shame.
 */
export function toastsForDay(events: readonly GameEvent[], after: GameState, rules: RulesConfig): Toast[] {
  const goal = (id: string) => after.goals.find((g) => g.id === id);
  const goalName = (id: string) => {
    const g = goal(id);
    return g ? `${AREA_META[g.area].name} ${levelCode(g.level)}` : "That goal";
  };

  const parts: string[] = [];
  let score = 0;
  let credits = 0;
  let missHealth = 0;
  let graceUsed = 0;
  for (const e of events) {
    if (e.type === "points") {
      score += e.score;
      credits += e.credits;
    } else if (e.type === "grace_used") graceUsed += 1;
    else if (e.type === "health_changed" && (e.reason === "miss" || e.reason === "double_miss")) missHealth += e.delta;
  }
  if (score) parts.push(`${signed(score)} points`);
  if (credits) parts.push(`${signed(credits)} credits`);
  if (graceUsed) parts.push(`${graceUsed} ${graceUsed === 1 ? "miss" : "misses"} covered by grace`);
  if (missHealth) parts.push(`${signed(missHealth)} health`);

  const summary: Toast = {
    title: "Day closed",
    body: parts.length ? `${parts.join(" · ")}.` : "Nothing logged.",
    kind: score ? "good" : missHealth ? "bad" : "info",
  };
  const out: Toast[] = [summary];

  for (const e of events) {
    switch (e.type) {
      case "setback": {
        const name = RESISTANCE_META[e.resistance].name;
        out.push({ title: "Setback", body: `${name} hit strength ${rules.resistance.setbackAt}. That cost you ${e.damage} health. A game plan against it softens the next one.`, kind: "bad" });
        break;
      }
      case "locked_in":
        out.push({ title: "Locked in", body: `${goalName(e.goalId)} is locked in. It pays points every week from here on, as long as you keep moving.`, kind: "good" });
        break;
      case "at_risk":
        out.push({ title: "At risk", body: `${goalName(e.goalId)} is at ${Math.round(e.risk)}% risk. Clean days take it back down.`, kind: "bad" });
        break;
      case "risk_cleared":
        out.push({ title: "Coach", body: `${goalName(e.goalId)} is safe again.`, kind: "good" });
        break;
      case "ground_lost":
        out.push({ title: "Lost ground", body: `${goalName(e.goalId)} is lost. Its weekly points stop until you win it back from ${Math.round(rules.risk.lostRestartProgress * 100)}%.`, kind: "bad" });
        break;
      case "level_up":
        out.push({ title: "Level up", body: `You're on Level ${levelCode(e.level)} · ${LEVEL_NAMES[e.level]}.`, kind: "good" });
        break;
      case "level_lost":
        out.push({ title: "Coach", body: `You're back to Level ${levelCode(e.level)}. Progress above it is frozen, not gone.`, kind: "bad" });
        break;
      case "rule_adjusted":
        out.push({ title: "Game plan", body: e.rule.message, kind: "info" });
        break;
      case "recovery_started":
        out.push({ title: "Recovery mode", body: `For ${rules.recovery.days} days only one small habit counts. Decay and Resistance are frozen. Do it ${rules.recovery.daysNeeded} of ${rules.recovery.days} days to get back to ${rules.recovery.restoreHealth} health.`, kind: "info" });
        break;
      case "recovery_ended":
        out.push({ title: "Coach", body: e.completed ? "Recovery done. The board is live again." : "Recovery ended. Pick the one habit that matters most tomorrow.", kind: e.completed ? "good" : "info" });
        break;
      case "knocked_down":
        out.push({ title: "Knocked down", body: `Health hit ${rules.health.knockedDownAt}. Log any ${rules.health.getUpAfterPlays} habits to get back up at ${rules.health.getUpHealth} health.`, kind: "bad" });
        break;
      default:
        break;
    }
  }
  return out;
}

