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
import { shortDate } from "./dates";
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

/* ---------- One goal, by where it sits in time ---------- */

export type GoalPhase = "past" | "current" | "future";

export interface GoalDetail {
  phase: GoalPhase;
  /** "Locked in", "Working on it now", "Ahead of you" */
  heading: string;
  label: string;
  title: string;
  kind: string;
  coach: string;
  facts: { label: string; value: string }[];
  momentsTitle: string;
  moments: { date: string; label: string }[];
}

const MOMENTS_SHOWN = 6;

export function goalPhase(goal: Goal, state: GameState): GoalPhase {
  if (goal.status === "locked_in") return "past";
  if (goal.status === "hidden" || goal.frozen || goal.level > state.level) return "future";
  return "current";
}

/** Consistent weeks so far and needed, by the engine's rule: each consistent week moves 1/weeksToLockIn of the way. */
export function consistentWeeks(goal: Goal, rules: RulesConfig): { done: number; total: number } {
  const total = rules.progress.weeksToLockIn[goal.level];
  const reach = goal.kind === "milestone" ? rules.progress.milestoneVerifyAt : 1;
  const done = Math.min(total, Math.floor((goal.progress / reach) * total + 1e-9));
  return { done, total };
}

const journalFor = (state: GameState, pick: (e: NonNullable<GameState["journal"]>[number]) => boolean) =>
  (state.journal ?? []).filter(pick);

export function goalDetail(state: GameState, goal: Goal, rules: RulesConfig, events: readonly GameEvent[]): GoalDetail {
  const phase = goalPhase(goal, state);
  const label = goalLabel(state, goal.id);
  const kind = goal.kind === "milestone" ? "One-time" : "Ongoing";
  const base = { phase, label, title: goal.title, kind };
  const date = (d?: string) => (d ? shortDate(d) : "");

  if (phase === "past") {
    const weekly = Math.round(rules.points.dividendPerLevel * goal.level * rules.levelMultiplier[state.level]);
    const facts = [
      ...(goal.lockedInOn ? [{ label: "Locked in", value: date(goal.lockedInOn) }] : []),
      ...(goal.verifiedOn ? [{ label: "Verified", value: date(goal.verifiedOn) }] : []),
      { label: "Pays", value: `+${fmt(weekly)} points a week` },
      ...(goal.kind === "milestone"
        ? [{ label: "Quarterly check", value: goal.lastQuarterlyCheck ? `Passed ${date(goal.lastQuarterlyCheck)}` : "Not done yet" }]
        : [{ label: "Upkeep", value: "One weekly habit at its minimum" }]),
      ...(goal.verification ? [{ label: "What proved it", value: goal.verification }] : []),
    ];
    let moments = journalFor(state, (e) => e.goalId === goal.id).map((e) => ({ date: e.date, label: e.label }));
    if (!moments.length) {
      moments = [
        ...(goal.verifiedOn ? [{ date: goal.verifiedOn, label: "Real achievement logged" }] : []),
        ...(goal.lockedInOn ? [{ date: goal.lockedInOn, label: `${label} locked in` }] : []),
      ];
    }
    return {
      ...base,
      heading: "Locked in",
      coach: `${label} is yours${goal.lockedInOn ? ` since ${date(goal.lockedInOn)}` : ""}. It pays +${fmt(weekly)} points a week as long as you keep moving.`,
      facts,
      momentsTitle: "Moments",
      moments: moments.slice(-MOMENTS_SHOWN).reverse().map((m) => ({ date: date(m.date), label: m.label })),
    };
  }

  if (phase === "current") {
    const { done, total } = consistentWeeks(goal, rules);
    const ready = goal.kind === "milestone" && goal.progress >= rules.progress.milestoneVerifyAt;
    const facts = [
      { label: "Progress", value: goal.status === "lost" ? `Lost ground, back at ${pct(goal.progress)}` : `${pct(goal.progress)}` },
      { label: "Consistent weeks", value: `${done} of ${total}` },
      {
        label: "What's left",
        value: ready
          ? `The real thing: ${goal.verification || "do it and log it"}`
          : `About ${total - done} more consistent ${total - done === 1 ? "week" : "weeks"}${goal.kind === "milestone" ? `, then ${goal.verification || "the real achievement"}` : ""}`,
      },
      ...(goal.status === "at_risk"
        ? [{ label: "Risk", value: `${Math.round(goal.risk)}% · about ${cleanDaysToClear(goal.risk, rules)} clean days to clear` }]
        : []),
    ];
    const res = resistanceFor(state, goal.area);
    const setbackKinds = new Set(["setback", "at_risk", "ground_lost", "risk_cleared"]);
    let moments = journalFor(state, (e) => e.area === goal.area && setbackKinds.has(e.kind)).map((e) => ({ date: date(e.date), label: e.label }));
    moments = moments.slice(-MOMENTS_SHOWN).reverse();
    if (!moments.length && res && res.reports14d > 0)
      moments = [{ date: "Last 2 weeks", label: `${RESISTANCE_META[res.id].name} picked as the reason ${res.reports14d} ${res.reports14d === 1 ? "time" : "times"}` }];
    return {
      ...base,
      heading: goal.status === "at_risk" ? "At risk" : goal.status === "lost" ? "Lost ground" : "Working on it now",
      coach: areaCoach(state, goal.area, rules, events),
      facts,
      momentsTitle: "Recent setbacks",
      moments,
    };
  }

  // Future ground.
  const below = state.goals.find((g) => g.area === goal.area && g.level === goal.level - 1);
  const unlocks: string[] = [];
  if (below && below.status !== "locked_in") unlocks.push(`Lock in ${goalLabel(state, below.id)}`);
  if (goal.level > state.level) unlocks.push(`Reach Level ${levelCode(goal.level)}: lock in ${rules.levels.goalsToClear} of 5 at ${levelCode((goal.level - 1) as Level)}`);
  return {
    ...base,
    heading: "Ahead of you",
    coach: `${label} is ahead of you: ${goal.title}. ${unlocks.length ? `It opens once you ${unlocks[0]!.charAt(0).toLowerCase()}${unlocks[0]!.slice(1)}.` : "It's open whenever you're ready."}`,
    facts: [
      { label: "Kind", value: kind },
      { label: "What proves it", value: goal.verification || "Not set yet. Set it in Your levels." },
      { label: "Unlocks when", value: unlocks.length ? unlocks.join(" · ") : "Open now" },
      ...(goal.progress > 0 ? [{ label: "Kept from before", value: `${pct(goal.progress)} done, frozen until you're back on this level` }] : []),
    ],
    momentsTitle: "",
    moments: [],
  };
}
