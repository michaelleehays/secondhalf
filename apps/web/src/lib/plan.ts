import {
  AREAS,
  type AreaMode,
  type GameEvent,
  type GameState,
  type Goal,
  type GoalKind,
  type Habit,
  type Level,
  type PlanEdit,
} from "@second-half/contracts";
import { levelName } from "./hud";
import { levelCode } from "./labels";

/**
 * The "Your levels" screen's logic: the ladder it draws and the forms that turn into PlanEdits.
 * Pure. The engine decides whether an edit is allowed (plan_rejected); these checks only catch
 * empty fields and say what a locked-in goal keeps, so the player isn't surprised.
 */

export const KIND_LABEL: Record<GoalKind, string> = { system: "Ongoing", milestone: "One-time" };
export const MAX_WEEKLY_TARGET = 7;
export const MAX_LEVEL_NAME = 40;
export const MAX_VISION = 280;

export interface LadderRung {
  level: Level;
  code: string;
  name: string;
  current: boolean;
  /** Goals on this ring in area order. Empty for 501. */
  goals: Goal[];
  held: number;
}

/** 501 at the top down to 101, like the mountain. */
export function ladder(state: GameState): LadderRung[] {
  return ([5, 4, 3, 2, 1] as const).map((level) => {
    const goals = level === 5 ? [] : AREAS.map((a) => state.goals.find((g) => g.area === a && g.level === level)).filter((g): g is Goal => !!g);
    return {
      level,
      code: levelCode(level),
      name: levelName(state, level),
      current: state.level === level,
      goals,
      held: goals.filter((g) => g.status === "locked_in").length,
    };
  });
}

/** Locked-in ground keeps its kind and habits; only its title and what proves it can change. */
export const isLocked = (goal: Goal) => goal.status === "locked_in";

export const lockedNote = (goal: Goal) =>
  "This goal is locked in. You can reword it and what proves it. Its kind and habits stay as they are, so the ground you've taken holds.";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function renameLevelEdit(state: GameState, level: Level, raw: string): Result<PlanEdit | null> {
  const name = raw.trim();
  if (!name) return { ok: false, error: "Give the level a name." };
  if (name.length > MAX_LEVEL_NAME) return { ok: false, error: `Keep it to ${MAX_LEVEL_NAME} characters.` };
  if (name === levelName(state, level)) return { ok: true, value: null };
  return { ok: true, value: { kind: "rename_level", level, name } };
}

export interface GoalForm {
  title: string;
  kind: GoalKind;
  verification: string;
}

export const goalForm = (g: Goal): GoalForm => ({ title: g.title, kind: g.kind, verification: g.verification ?? "" });

/** Only the fields that changed. Null when nothing did. */
export function setGoalEdit(goal: Goal, form: GoalForm): Result<PlanEdit | null> {
  const title = form.title.trim();
  const verification = form.verification.trim();
  if (!title) return { ok: false, error: "The goal needs a title." };
  if (isLocked(goal) && form.kind !== goal.kind) return { ok: false, error: "A locked-in goal keeps its kind." };
  const edit: Extract<PlanEdit, { kind: "set_goal" }> = { kind: "set_goal", goalId: goal.id };
  if (title !== goal.title) edit.title = title;
  if (form.kind !== goal.kind) edit.goalKind = form.kind;
  if (verification !== (goal.verification ?? "")) edit.verification = verification;
  return { ok: true, value: Object.keys(edit).length > 2 ? edit : null };
}

export interface HabitForm {
  title: string;
  fullDose: string;
  minimumDose: string;
  focus: number;
  maintain: number;
}

export const habitForm = (h: Habit): HabitForm => ({
  title: h.title,
  fullDose: h.fullDose,
  minimumDose: h.minimumDose,
  focus: h.weeklyTarget.focus,
  maintain: h.weeklyTarget.maintain,
});

export const emptyHabitForm = (): HabitForm => ({ title: "", fullDose: "", minimumDose: "", focus: 3, maintain: 2 });

function checkHabit(form: HabitForm): string | null {
  if (!form.title.trim()) return "The habit needs a name.";
  if (!form.fullDose.trim()) return "Say what the full version is.";
  if (!form.minimumDose.trim()) return "Say what the minimum is. It's what keeps a bad day from being a zero.";
  for (const [label, n] of [
    ["Focus", form.focus],
    ["Maintain", form.maintain],
  ] as const) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_WEEKLY_TARGET) return `${label} target is 0 to ${MAX_WEEKLY_TARGET} times a week.`;
  }
  return null;
}

const target = (form: HabitForm): Record<AreaMode, number> => ({ focus: form.focus, maintain: form.maintain, rest: 0 });

export function updateHabitEdit(habit: Habit, form: HabitForm): Result<PlanEdit | null> {
  const error = checkHabit(form);
  if (error) return { ok: false, error };
  const edit: Extract<PlanEdit, { kind: "update_habit" }> = { kind: "update_habit", habitId: habit.id };
  if (form.title.trim() !== habit.title) edit.title = form.title.trim();
  if (form.fullDose.trim() !== habit.fullDose) edit.fullDose = form.fullDose.trim();
  if (form.minimumDose.trim() !== habit.minimumDose) edit.minimumDose = form.minimumDose.trim();
  if (form.focus !== habit.weeklyTarget.focus || form.maintain !== habit.weeklyTarget.maintain) edit.weeklyTarget = { ...habit.weeklyTarget, ...target(form), rest: habit.weeklyTarget.rest };
  return { ok: true, value: Object.keys(edit).length > 2 ? edit : null };
}

/** A habit id that isn't taken: "<goal>-<slug>", with a number on the end if needed. */
export function newHabitId(state: GameState, goal: Goal, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "habit";
  const base = `${goal.id}-${slug}`;
  const taken = new Set(state.habits.map((h) => h.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function addHabitEdit(state: GameState, goal: Goal, form: HabitForm): Result<PlanEdit> {
  if (isLocked(goal)) return { ok: false, error: "A locked-in goal keeps its habits." };
  const error = checkHabit(form);
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: {
      kind: "add_habit",
      habit: {
        id: newHabitId(state, goal, form.title),
        goalId: goal.id,
        area: goal.area,
        title: form.title.trim(),
        fullDose: form.fullDose.trim(),
        minimumDose: form.minimumDose.trim(),
        weeklyTarget: target(form),
        maintenance: false,
      },
    },
  };
}

/** The engine's reason, if it turned this edit down. */
export const rejection = (events: readonly GameEvent[]): string | null => {
  const e = events.find((x) => x.type === "plan_rejected");
  return e && e.type === "plan_rejected" ? e.reason : null;
};

/** A milestone at the verify mark, not yet verified: the area sheet offers "I did it". */
export const readyToVerify = (goal: Goal, verifyAt: number) =>
  goal.kind === "milestone" && goal.status === "in_progress" && !goal.verifiedOn && goal.progress >= verifyAt;
