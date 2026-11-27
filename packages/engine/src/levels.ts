import { DEFAULT_RULES, type GameEvent, type GameState, type Goal, type Level, type RulesConfig, type StepResult } from "@second-half/contracts";

/** Ground still held in a ring: locked in, or at risk but not yet lost. */
const held = (g: Goal) => g.status === "locked_in" || g.status === "at_risk";
const heldIn = (goals: Goal[], ring: number) => goals.filter((g) => g.level === ring && held(g)).length;
/** Goals above the player's level are frozen: progress kept, not scored. */
const freezeAbove = (goals: Goal[], level: Level) =>
  goals.map((g): Goal => {
    const frozen = g.level > level && g.status !== "hidden";
    return g.frozen === frozen ? g : { ...g, frozen };
  });

/** The level the board supports: 1 + the number of consecutive rings, from 101 up, that each hold `goalsToClear`. */
function supportedLevel(goals: Goal[], config: RulesConfig): Level {
  let level = 1;
  while (level < 5 && heldIn(goals, level) >= config.levels.goalsToClear) level += 1;
  return level as Level;
}

/**
 * Levels. The player at level L works on ring L; every ring below it is ground that earned the level.
 *
 * - Clear: when `levels.goalsToClear` goals in ring L are held (locked in or at risk; lost does not count),
 *   the player moves up to L+1, earns `credits.levelCleared`, the next ring's goals open in the areas held,
 *   and goals on the new level are unfrozen.
 * - Drop: when any ring below L holds fewer than `goalsToClear`, the player drops to that ring's level and
 *   goals above it freeze, progress kept. They come back when the ground is retaken.
 *
 * The level always equals what the board supports, so retaking ground under frozen, locked-in goals can
 * climb more than one level (one `level_up` per level). Pure: never mutates `state`.
 */
export function checkLevels(state: GameState, config: RulesConfig = DEFAULT_RULES): StepResult {
  const events: GameEvent[] = [];
  let goals = state.goals;
  let credits = state.credits;
  let level = state.level;

  const target = supportedLevel(goals, config);
  if (target < level) {
    level = target;
    events.push({ type: "level_lost", level });
  }
  while (level < target) {
    const ring = level;
    const heldAreas = new Set(goals.filter((g) => g.level === ring && held(g)).map((g) => g.area));
    level = (level + 1) as Level;
    goals = goals.map((g): Goal => (g.level === level && g.status === "hidden" && heldAreas.has(g.area) ? { ...g, status: "open" } : g));
    credits += config.credits.levelCleared;
    events.push({ type: "level_up", level });
    events.push({ type: "points", score: 0, credits: config.credits.levelCleared, reason: "level_cleared" });
  }

  goals = freezeAbove(goals, level);
  const changed = level !== state.level || credits !== state.credits || goals.some((g, i) => g !== state.goals[i]);
  return { state: changed ? { ...state, level, goals, credits } : state, events };
}

/** Runs `checkLevels` after a step and appends its events. */
export function withLevels(result: StepResult, config: RulesConfig): StepResult {
  const levels = checkLevels(result.state, config);
  return { state: levels.state, events: [...result.events, ...levels.events] };
}
