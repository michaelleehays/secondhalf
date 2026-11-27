import {
  type AreaId,
  type AreaMode,
  type GameEvent,
  type GameState,
  type Goal,
  type Habit,
  type Level,
  type ResistanceId,
  type RuleAdjustment,
  type RulesConfig,
} from "@second-half/contracts";
import { daysLeft, levelName } from "./hud";
import { AREA_META, RESISTANCE_META, fmt, levelCode } from "./labels";
import { goalLabel } from "./messages";

/**
 * Copy for the area, athlete, Vision and Resistance sheets. Pure: state, rules and the events from
 * the player's last step in, strings out. When the last step touched what the sheet shows, the
 * coach talks about that; otherwise about where things stand.
 */

export const MODE_LABEL: Record<AreaMode, string> = { focus: "Focus", maintain: "Maintain", rest: "Rest" };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const resistanceFor = (state: GameState, area: AreaId) => Object.values(state.resistance).find((r) => r.targetArea === area);
const cleanDaysToClear = (risk: number, rules: RulesConfig) => Math.max(1, Math.ceil(risk / rules.risk.fullCleanDay));

/* ---------- Area ---------- */

export interface AreaRow {
  goal: Goal;
  /** "Body 201 · One-time" */
  tag: string;
  /** The goal title, or what it takes to see it while hidden. */
  title: string;
  status: string;
  /** 0..1 fill for the meter; null hides it. */
  fill: number | null;
  tone: "area" | "risk" | "muted";
  current: boolean;
}

export interface AreaView {
  name: string;
  color: string;
  mode: string;
  coach: string;
  rows: AreaRow[];
  habits: Habit[];
}

export function goalStatusText(goal: Goal, rules: RulesConfig): string {
  const frozen = goal.frozen ? " · frozen" : "";
  switch (goal.status) {
    case "locked_in":
      return `Locked in${frozen}`;
    case "in_progress":
      if (goal.kind === "milestone" && goal.progress >= rules.progress.milestoneVerifyAt && !goal.verifiedOn) return `Ready to verify${frozen}`;
      return `${pct(goal.progress)} done${frozen}`;
    case "at_risk":
      return `At risk · ${Math.round(goal.risk)}%`;
    case "lost":
      return "Lost ground";
    case "open":
      return `Open${frozen}`;
    case "hidden":
      return "Not yet visible";
  }
}

export function areaView(state: GameState, area: AreaId, rules: RulesConfig, events: readonly GameEvent[], focusLevel?: Level): AreaView {
  const meta = AREA_META[area];
  const goals = state.goals.filter((g) => g.area === area).sort((a, b) => a.level - b.level);
  const current = focusLevel && focusLevel < 5 ? focusLevel : (goals.find((g) => g.status !== "locked_in")?.level ?? state.level);
  const rows: AreaRow[] = goals.map((g) => {
    const below = goals.find((x) => x.level === g.level - 1);
    return {
      goal: g,
      tag: `${meta.name} ${levelCode(g.level)} · ${g.kind === "milestone" ? "One-time" : "Ongoing"}`,
      title: g.status === "hidden" ? `Shows once ${below ? `${meta.name} ${levelCode(below.level)}` : "the level below"} is locked in` : g.title,
      status: goalStatusText(g, rules),
      fill: g.status === "hidden" ? null : g.status === "locked_in" ? 1 : g.status === "at_risk" ? 1 - g.risk / 100 : g.status === "lost" ? 0 : g.progress,
      tone: g.status === "at_risk" || g.status === "lost" ? "risk" : g.status === "hidden" || g.frozen ? "muted" : "area",
      current: g.level === current,
    };
  });
  return {
    name: meta.name,
    color: meta.color,
    mode: MODE_LABEL[state.modes[area]],
    coach: areaCoach(state, area, rules, events),
    rows,
    habits: state.habits.filter((h) => h.area === area),
  };
}

function areaCoach(state: GameState, area: AreaId, rules: RulesConfig, events: readonly GameEvent[]): string {
  const name = AREA_META[area].name;
  const inArea = (goalId: string) => state.goals.find((g) => g.id === goalId)?.area === area;
  const res = resistanceFor(state, area);

  // What just happened here, most important first.
  for (const e of events) {
    if (e.type === "ground_lost" && inArea(e.goalId))
      return `${goalLabel(state, e.goalId)} slipped to lost ground. Win it back from ${pct(rules.risk.lostRestartProgress)}. Its weekly points pay again once it's locked in.`;
    if (e.type === "locked_in" && inArea(e.goalId)) return `${goalLabel(state, e.goalId)} is locked in. It pays every week from here on.`;
  }
  for (const e of events) {
    if (e.type === "setback" && res && e.resistance === res.id)
      return `${RESISTANCE_META[res.id].name} landed a setback here: ${e.damage} health. Equip a game plan against it.`;
    if (e.type === "at_risk" && inArea(e.goalId))
      return `${goalLabel(state, e.goalId)} went at risk at ${Math.round(e.risk)}%. About ${cleanDaysToClear(e.risk, rules)} clean days takes it off the board.`;
    if (e.type === "risk_cleared" && inArea(e.goalId)) return `${goalLabel(state, e.goalId)} is safe again. Keep the streak going.`;
  }

  // Where things stand.
  const goals = state.goals.filter((g) => g.area === area).sort((a, b) => a.level - b.level);
  const atRisk = goals.find((g) => g.status === "at_risk");
  if (atRisk) {
    const who = res ? `${RESISTANCE_META[res.id].name} has beaten you ${res.reports14d} times in two weeks. ` : "";
    return `${who}${goalLabel(state, atRisk.id)} is at ${Math.round(atRisk.risk)}% risk. About ${cleanDaysToClear(atRisk.risk, rules)} clean days takes it off the board. At 100% it's lost and its weekly points stop.`;
  }
  const lost = goals.find((g) => g.status === "lost");
  if (lost) return `${goalLabel(state, lost.id)} is lost ground. It restarts from ${pct(lost.progress)}; keep its habits going to win it back.`;
  if (state.modes[area] === "rest") return `${name} is resting this season. Nothing here decays while you focus elsewhere.`;
  const moving = goals.find((g) => g.status === "in_progress" && !g.frozen);
  if (moving) {
    if (moving.kind === "milestone" && moving.progress >= rules.progress.milestoneVerifyAt)
      return `${goalLabel(state, moving.id)} is ready. It locks in once you've done the real thing${moving.verification ? `: ${moving.verification}` : ""}.`;
    const weeks = rules.progress.weeksToLockIn[moving.level];
    return `${goalLabel(state, moving.id)} is ${pct(moving.progress)} done. Consistent weeks carry it the rest of the way, about ${weeks} of them from zero.`;
  }
  const open = goals.find((g) => g.status === "open" && !g.frozen);
  if (open) return `${goalLabel(state, open.id)} is open. Start it when a Focus slot frees up.`;
  return `${name} is holding steady. Keep the weekly habits alive.`;
}

/* ---------- Athlete ---------- */

export interface AthleteView {
  condition: string;
  build: string;
  coach: string;
  graceText: string;
  knockedDownText: string | null;
  recoveryText: string | null;
  canLogLifeEvent: boolean;
}

export function athleteView(state: GameState, rules: RulesConfig, events: readonly GameEvent[]): AthleteView {
  const { health, strength, graceDaysLeft, knockedDown } = state.character;
  const condition = knockedDown || health <= rules.health.knockedDownAt ? "Knocked down" : health < 35 ? "Worn down" : health < 60 ? "Banged up" : "Strong";
  const build = strength > 80 ? "Lean and strong" : strength > 62 ? "Fit" : strength > 42 ? "Average build" : strength > 25 ? "A little soft" : "Out of shape";

  let coach: string;
  const setback = events.find((e) => e.type === "setback");
  const down = events.find((e) => e.type === "knocked_down");
  if (down) coach = `You're down. Log any ${rules.health.getUpAfterPlays} habits and you're back up at ${rules.health.getUpHealth} health.`;
  else if (setback && setback.type === "setback")
    coach = `${RESISTANCE_META[setback.resistance].name} hit you for ${setback.damage} health. One small win tonight steadies you.`;
  else if (knockedDown)
    coach = `${knockedDown.plays} of ${rules.health.getUpAfterPlays} habits logged since you went down. ${rules.health.getUpAfterPlays - knockedDown.plays} more and you're up.`;
  else if (health < 35) coach = "You're running on empty. One small win tonight beats a perfect plan for next week.";
  else if (strength > 70) coach = "You look like someone who trains. Keep stacking weeks.";
  else coach = "Solid. Every full week you put in shows up in how you carry yourself.";

  const r = state.recovery;
  return {
    condition,
    build,
    coach,
    graceText: `${graceDaysLeft} grace ${graceDaysLeft === 1 ? "day" : "days"} left this month`,
    knockedDownText: knockedDown ? `Down since ${knockedDown.since}. ${knockedDown.plays} of ${rules.health.getUpAfterPlays} habits logged.` : null,
    recoveryText: r ? `Recovery, day ${r.day} of ${rules.recovery.days}. ${r.daysDone} of ${rules.recovery.daysNeeded} days done. Only ${r.habitTitle || "one habit"} counts.` : null,
    canLogLifeEvent: !r && !state.season.lifeEventPauseUsed,
  };
}

/* ---------- Vision ---------- */

export interface VisionView {
  name: string;
  coach: string;
  projected: string;
  score: string;
  weeksLeft: string;
  rings: { level: Level; name: string; held: number }[];
}

export function visionView(state: GameState, projected: number, date = state.today): VisionView {
  const weeks = Math.floor(daysLeft(state, date) / 7);
  const rings = ([1, 2, 3, 4] as const).map((level) => ({
    level: level as Level,
    name: levelName(state, level),
    held: state.goals.filter((g) => g.level === level && g.status === "locked_in").length,
  }));
  return {
    name: levelName(state, 5),
    coach: `The summit is the life you're playing for. It comes into view as the rings below it are locked in. At this pace you finish at ${fmt(projected)} points.`,
    projected: fmt(projected),
    score: fmt(state.score),
    weeksLeft: fmt(weeks),
    rings,
  };
}

/* ---------- Resistance ---------- */

export interface ResistanceView {
  name: string;
  reason: string;
  strength: number;
  max: number;
  reports: number;
  area: string;
  coach: string;
  attacking: string | null;
  plans: GameState["gamePlans"];
  equippedCount: number;
  rules: RuleAdjustment[];
}

export function resistanceView(state: GameState, id: ResistanceId, rules: RulesConfig, events: readonly GameEvent[]): ResistanceView {
  const r = state.resistance[id];
  const meta = RESISTANCE_META[id];
  const area = AREA_META[r.targetArea].name;
  const attackedGoal = state.goals.find((g) => g.area === r.targetArea && g.status === "at_risk");
  const plans = state.gamePlans.filter((p) => p.resistance === id);
  const equipped = plans.some((p) => p.equipped);
  const setback = events.find((e) => e.type === "setback" && e.resistance === id);
  const refused = events.find((e) => e.type === "game_plan_refused");

  let coach: string;
  if (refused && refused.type === "game_plan_refused") coach = `You can run ${refused.max} game plans at once. Take one off before adding another.`;
  else if (setback && setback.type === "setback") coach = `${meta.name} just cost you ${setback.damage} health. It drops back to ${rules.resistance.afterSetback} now. A game plan halves the next hit.`;
  else if (r.strength >= rules.resistance.setbackAt) coach = `${meta.name} is at full strength. The next "${meta.reason}" miss is a setback. ${equipped ? "Your game plan halves it." : "Equip a game plan to halve it."}`;
  else if (r.strength >= rules.resistance.setbackAt - 1) coach = `${meta.name} is one miss from a setback. Doing the ${area} habit on a day you'd usually miss knocks it down.`;
  else coach = `${meta.name} is at ${r.strength} of ${rules.resistance.max}. It grows each time you pick "${meta.reason}", and shrinks when you show up anyway.`;

  return {
    name: meta.name,
    reason: meta.reason,
    strength: r.strength,
    max: rules.resistance.max,
    reports: r.reports14d,
    area,
    coach,
    attacking: attackedGoal ? `Pressing on ${goalLabel(state, attackedGoal.id)} (${Math.round(attackedGoal.risk)}% risk)` : null,
    plans,
    equippedCount: state.gamePlans.filter((p) => p.equipped).length,
    rules: state.rules.filter((x) => x.trigger === id),
  };
}
