import type { CheckIn, GameEvent, GameState, ResistanceId, RulesConfig, StepResult } from "@second-half/contracts";

/**
 * Stand-in for engine.closeDay until workstream A ships it. It covers only what the check-in
 * screen needs to show (points, credits, grace, health, strength, Resistance, setbacks) so the UI
 * has realistic events to animate. It is not the rulebook: the real engine replaces it wholesale.
 * Pure: never mutates `state`, no clock reads.
 */
export function mockCloseDay(state: GameState, checkIn: CheckIn, rules: RulesConfig): StepResult {
  const events: GameEvent[] = [];
  const mult = rules.levelMultiplier[state.level];
  let score = 0;
  let credits = 0;
  let health = state.character.health;
  let strength = state.character.strength;
  let grace = state.character.graceDaysLeft;
  const resistance = { ...state.resistance };
  const weekProgress = { ...state.weekProgress };
  const setbacks: ResistanceId[] = [];

  for (const entry of checkIn.entries) {
    const habit = state.habits.find((h) => h.id === entry.habitId);
    if (!habit) continue;
    if (entry.result === "full" || entry.result === "minimum") {
      const full = entry.result === "full";
      score += (full ? rules.points.habitFull : rules.points.habitMinimum) * mult;
      credits += full ? rules.credits.habitFull : rules.credits.habitMinimum;
      health += full ? rules.health.fullRestore : rules.health.minimumRestore;
      strength += full ? rules.strength.fullGain : rules.strength.minimumGain;
      weekProgress[habit.area] = true;
      continue;
    }
    if (grace > 0) {
      grace -= 1;
      events.push({ type: "grace_used", habitId: habit.id });
    } else {
      health -= rules.health.missCost;
      events.push({ type: "health_changed", delta: -rules.health.missCost, reason: "miss" });
    }
    if (entry.reason) {
      const r = resistance[entry.reason];
      const next = Math.min(rules.resistance.max, r.strength + 1);
      resistance[entry.reason] = { ...r, strength: next, reports14d: r.reports14d + 1 };
      if (next !== r.strength) events.push({ type: "resistance_changed", id: r.id, strength: next });
      if (next >= rules.resistance.setbackAt && !setbacks.includes(r.id)) setbacks.push(r.id);
    }
  }

  const gained = checkIn.entries.filter((e) => e.result !== "missed").length;
  if (gained) {
    const restored = Math.min(100, health) - state.character.health;
    events.unshift({ type: "points", score: Math.round(score), credits, reason: "habit" });
    if (restored > 0) events.push({ type: "health_changed", delta: restored, reason: "habit" });
  }

  for (const id of setbacks) {
    const equipped = state.gamePlans.some((p) => p.resistance === id && p.equipped);
    const damage = Math.round(rules.health.setbackDamage * (equipped ? rules.resistance.gamePlanDamageFactor : 1));
    health -= damage;
    events.push({ type: "setback", resistance: id, damage });
  }

  const nextHealth = clamp(health);
  const nextStrength = clamp(strength);
  if (nextStrength !== state.character.strength) events.push({ type: "strength_changed", delta: nextStrength - state.character.strength });
  if (nextHealth <= rules.health.knockedDownAt && state.character.health > rules.health.knockedDownAt) events.push({ type: "knocked_down" });

  return {
    state: {
      ...state,
      score: state.score + Math.round(score),
      credits: state.credits + credits,
      character: { health: nextHealth, strength: nextStrength, graceDaysLeft: grace },
      resistance,
      weekProgress,
    },
    events,
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
