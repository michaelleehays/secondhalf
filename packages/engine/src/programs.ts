import type { GameEvent, GameState, Program, RulesConfig } from "@second-half/contracts";

const threshold = (p: Program, config: RulesConfig, sessions: number) =>
  Math.min(p.threshold > 0 ? p.threshold : config.program.defaultThreshold, sessions);

/** True when every week of the program is finished. */
export const programFinished = (p: Program) => p.currentWeek > p.weeks.length;

export interface ProgramDay {
  programs: Program[];
  /** New goal progress for goals whose program finished a week tonight: weeks finished / total weeks. */
  progress: Map<string, number>;
  score: number;
  credits: number;
}

/**
 * Program sessions for one closed day. Each Done or Minimum entry on a habit serving a program goal fills
 * one session of the current week. When the week reaches its threshold (`program.threshold`, else
 * `program.defaultThreshold`) it pays `points.programWeek` (× level multiplier) and `credits.programWeek`,
 * advances to the next week, and sessions start again; extra sessions that night carry into the new week.
 * Goal progress for program goals comes only from weeks: finished weeks / total weeks.
 */
export function applyProgramSessions(
  state: GameState,
  sessions: Map<string, number>,
  totals: { score: number; credits: number },
  config: RulesConfig,
  events: GameEvent[],
): ProgramDay {
  const mult = config.levelMultiplier[state.level];
  let { score, credits } = totals;
  const progress = new Map<string, number>();

  const programs = state.programs.map((program): Program => {
    let left = sessions.get(program.goalId) ?? 0;
    if (!left) return program;
    let p = program;
    while (left > 0 && !programFinished(p)) {
      const week = p.weeks[p.currentWeek - 1]!;
      const done = week.sessions.map((_, i) => p.done[i] ?? false);
      for (let i = 0; i < done.length && left > 0; i++) {
        if (!done[i]) {
          done[i] = true;
          left -= 1;
        }
      }
      const count = done.filter(Boolean).length;
      if (count < threshold(p, config, done.length)) {
        p = { ...p, done };
        break;
      }
      const points = Math.round(config.points.programWeek * mult);
      score += points;
      credits += config.credits.programWeek;
      events.push({ type: "points", score: points, credits: config.credits.programWeek, reason: "program_week", sourceId: p.id });
      const nextWeek = p.weeks[p.currentWeek];
      p = { ...p, currentWeek: p.currentWeek + 1, done: nextWeek ? nextWeek.sessions.map(() => false) : [] };
      progress.set(p.goalId, (p.currentWeek - 1) / p.weeks.length);
      // Sessions left over tonight (`left`) carry into the new week on the next pass.
    }
    return p;
  });

  return { programs, progress, score, credits };
}

/** At the weekly rollover a program week still short of its threshold starts again: "falling short means repeating the week". */
export function repeatUnfinishedWeeks(programs: Program[]): Program[] {
  return programs.map((p) => (programFinished(p) || !p.done.some(Boolean) ? p : { ...p, done: p.done.map(() => false) }));
}
