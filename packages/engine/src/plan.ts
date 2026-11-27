import {
  DEFAULT_RULES,
  type AreaMode,
  type GameState,
  type Goal,
  type Habit,
  type IsoDate,
  type PlanEdit,
  type RulesConfig,
  type StepResult,
} from "@second-half/contracts";

const NAME_MAX = 40;
const TITLE_MAX = 80;
const MODES: AreaMode[] = ["focus", "maintain", "rest"];

const reject = (state: GameState, edit: PlanEdit, reason: string): StepResult => ({
  state,
  events: [{ type: "plan_rejected", edit: edit.kind, reason }],
});
const fits = (text: string, max: number) => text.trim().length >= 1 && text.trim().length <= max;
const validTarget = (t: Record<AreaMode, number>) => MODES.every((m) => Number.isInteger(t[m]) && t[m] >= 0 && t[m] <= 7);

/** Checks the text and numbers a habit edit sets. Returns a coach-voice reason, or undefined when it's fine. */
function habitProblem(h: Partial<Pick<Habit, "title" | "fullDose" | "minimumDose" | "weeklyTarget">>): string | undefined {
  if (h.title !== undefined && !fits(h.title, TITLE_MAX)) return `Give the habit a name of 1 to ${TITLE_MAX} characters.`;
  if (h.fullDose !== undefined && !fits(h.fullDose, TITLE_MAX)) return `Describe the full version in 1 to ${TITLE_MAX} characters.`;
  if (h.minimumDose !== undefined && !fits(h.minimumDose, TITLE_MAX)) return `Describe the minimum version in 1 to ${TITLE_MAX} characters.`;
  if (h.weeklyTarget !== undefined && !validTarget(h.weeklyTarget)) return "Weekly targets run from 0 to 7 days.";
  return undefined;
}

/**
 * Apply one edit the player makes to their plan. Pure. An edit the rules don't allow leaves the state
 * unchanged and emits `plan_rejected` with a coach-voice reason. A successful edit emits nothing.
 *
 * - rename_level: a name of 1-40 characters.
 * - set_goal: title (1-80) and verification at any status. The kind can change while the goal is hidden, open
 *   or in progress (becoming a milestone caps progress at `milestoneVerifyAt`), not once it's been earned.
 * - add_habit: needs an existing goal in the same area, a new id, a title and doses of 1-80 characters and
 *   weekly targets of 0-7. History starts empty.
 * - update_habit: same checks; may move the habit to another goal in its area, and keeps its history.
 * - retire_habit: removes it from `state.habits` (the backend archives it).
 */
export function applyPlanEdit(state: GameState, edit: PlanEdit, _date: IsoDate, config: RulesConfig = DEFAULT_RULES): StepResult {
  switch (edit.kind) {
    case "rename_level": {
      if (!fits(edit.name, NAME_MAX)) return reject(state, edit, `Give the level a name of 1 to ${NAME_MAX} characters.`);
      return { state: { ...state, levelNames: { ...state.levelNames, [edit.level]: edit.name.trim() } }, events: [] };
    }

    case "set_goal": {
      const goal = state.goals.find((g) => g.id === edit.goalId);
      if (!goal) return reject(state, edit, "That goal isn't on your map.");
      if (edit.title !== undefined && !fits(edit.title, TITLE_MAX)) return reject(state, edit, `Give the goal a name of 1 to ${TITLE_MAX} characters.`);
      if (edit.verification !== undefined && edit.verification.trim().length > TITLE_MAX) {
        return reject(state, edit, `Keep the achievement to ${TITLE_MAX} characters.`);
      }
      const changesKind = edit.goalKind !== undefined && edit.goalKind !== goal.kind;
      if (changesKind && (goal.status === "locked_in" || goal.status === "at_risk" || goal.status === "lost")) {
        return reject(state, edit, "That goal's already been earned as it stands.");
      }
      let next: Goal = { ...goal };
      if (edit.title !== undefined) next.title = edit.title.trim();
      if (edit.verification !== undefined) {
        const text = edit.verification.trim();
        if (text) next.verification = text;
        else delete next.verification;
      }
      if (changesKind) {
        next = { ...next, kind: edit.goalKind! };
        if (next.kind === "milestone") next.progress = Math.min(next.progress, config.progress.milestoneVerifyAt);
      }
      return { state: { ...state, goals: state.goals.map((g) => (g.id === goal.id ? next : g)) }, events: [] };
    }

    case "add_habit": {
      const { habit } = edit;
      const goal = state.goals.find((g) => g.id === habit.goalId);
      if (!goal) return reject(state, edit, "Pick a goal on your map for this habit to feed.");
      if (goal.area !== habit.area) return reject(state, edit, "A habit feeds a goal in its own area.");
      if (state.habits.some((h) => h.id === habit.id)) return reject(state, edit, "You already have a habit with that id.");
      const problem = habitProblem(habit);
      if (problem) return reject(state, edit, problem);
      const added: Habit = {
        ...habit,
        title: habit.title.trim(),
        fullDose: habit.fullDose.trim(),
        minimumDose: habit.minimumDose.trim(),
        weeklyTarget: { ...habit.weeklyTarget },
        history: [],
      };
      return { state: { ...state, habits: [...state.habits, added] }, events: [] };
    }

    case "update_habit": {
      const habit = state.habits.find((h) => h.id === edit.habitId);
      if (!habit) return reject(state, edit, "That habit isn't in your plan.");
      if (edit.goalId !== undefined) {
        const goal = state.goals.find((g) => g.id === edit.goalId);
        if (!goal) return reject(state, edit, "Pick a goal on your map for this habit to feed.");
        if (goal.area !== habit.area) return reject(state, edit, "A habit feeds a goal in its own area.");
      }
      const problem = habitProblem(edit);
      if (problem) return reject(state, edit, problem);
      const next: Habit = {
        ...habit,
        ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
        ...(edit.fullDose !== undefined ? { fullDose: edit.fullDose.trim() } : {}),
        ...(edit.minimumDose !== undefined ? { minimumDose: edit.minimumDose.trim() } : {}),
        ...(edit.weeklyTarget !== undefined ? { weeklyTarget: { ...edit.weeklyTarget } } : {}),
        ...(edit.goalId !== undefined ? { goalId: edit.goalId } : {}),
      };
      return { state: { ...state, habits: state.habits.map((h) => (h.id === habit.id ? next : h)) }, events: [] };
    }

    case "retire_habit": {
      if (!state.habits.some((h) => h.id === edit.habitId)) return reject(state, edit, "That habit isn't in your plan.");
      return { state: { ...state, habits: state.habits.filter((h) => h.id !== edit.habitId) }, events: [] };
    }
  }
}
