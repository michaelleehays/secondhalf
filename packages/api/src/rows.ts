/**
 * Row shapes returned by load_game_state, and pure mapping between rows and contract types.
 * No I/O here, so it is unit-tested without a database.
 */
import type {
  AreaId,
  AreaMode,
  CheckInResult,
  GameEvent,
  GameState,
  Goal,
  Habit,
  HabitDay,
  LedgerEntry,
  LedgerKind,
  Level,
  Program,
  ResistanceId,
  ResistanceState,
  RuleAdjustment,
  StepResult,
} from "@second-half/contracts";

export interface ProfileRow {
  id: string;
  birth_year: number;
  end_age: number;
  timezone: string;
  today: string;
  level: number;
  score: number;
  credits: number;
}
export interface AreaRow { area: AreaId; mode: AreaMode; week_progress: boolean }
export interface GoalRow {
  id: string;
  area: AreaId;
  level: number;
  title: string;
  kind: Goal["kind"];
  status: Goal["status"];
  progress: number;
  risk: number;
  frozen: boolean;
  locked_in_on: string | null;
  last_quarterly_check: string | null;
}
export interface ProgramRow {
  id: string;
  goal_id: string;
  weeks: Program["weeks"];
  current_week: number;
  done: boolean[];
  threshold: number;
}
export interface HabitRow {
  id: string;
  goal_id: string;
  area: AreaId;
  title: string;
  full_dose: string;
  minimum_dose: string;
  weekly_target_focus: number;
  weekly_target_maintain: number;
  weekly_target_rest: number;
  maintenance: boolean;
}
export interface CheckInRow { habit_id: string; date: string; result: CheckInResult; reason: ResistanceId | null }
export interface ResistanceRow { id: ResistanceId; strength: number; reports_14d: number; target_area: AreaId }
export interface GamePlanRow { id: string; resistance: ResistanceId; text: string; equipped: boolean }
export interface RuleRow {
  id: string;
  trigger: ResistanceId;
  message: string;
  effect: RuleAdjustment["effect"];
  starts_on: string;
  ends_on: string;
}
export interface CharacterRow { health: number; strength: number; grace_days_left: number }
export interface RecoveryRow {
  cause: "auto" | "life_event";
  started_on: string;
  day: number;
  days_done: number;
  habit_title: string;
}
export interface SeasonRow {
  index: number;
  starts_on: string;
  focus: AreaId[];
  auto_recovery_used: boolean;
  life_event_pause_used: boolean;
}

/** What load_game_state returns for a player who has a profile. */
export interface GameSnapshot {
  profile: ProfileRow;
  areas: AreaRow[];
  goals: GoalRow[];
  programs: ProgramRow[];
  habits: HabitRow[];
  /** Already limited to the history window, ordered by habit then date. */
  checkIns: CheckInRow[];
  resistance: ResistanceRow[];
  gamePlans: GamePlanRow[];
  rules: RuleRow[];
  character: CharacterRow | null;
  recovery: RecoveryRow | null;
  season: SeasonRow | null;
}

export class IncompleteGameError extends Error {
  constructor(userId: string, missing: string) {
    super(`Saved game for ${userId} has no ${missing} yet.`);
    this.name = "IncompleteGameError";
  }
}

const habitDay = (c: CheckInRow): HabitDay => ({
  date: c.date,
  result: c.result,
  ...(c.reason ? { reason: c.reason } : {}),
});

/** Rows to a GameState. Habit history comes from check-ins, oldest first. */
export function toGameState(snap: GameSnapshot): GameState {
  const userId = snap.profile.id;
  if (!snap.character) throw new IncompleteGameError(userId, "character");
  if (!snap.season) throw new IncompleteGameError(userId, "season");

  const history = new Map<string, HabitDay[]>();
  for (const c of [...snap.checkIns].sort((a, b) => a.date.localeCompare(b.date))) {
    const list = history.get(c.habit_id) ?? [];
    list.push(habitDay(c));
    history.set(c.habit_id, list);
  }

  const modes = {} as Record<AreaId, AreaMode>;
  const weekProgress: GameState["weekProgress"] = {};
  for (const a of snap.areas) {
    modes[a.area] = a.mode;
    if (a.week_progress) weekProgress[a.area] = true;
  }

  const resistance = {} as Record<ResistanceId, ResistanceState>;
  for (const r of snap.resistance) {
    resistance[r.id] = { id: r.id, strength: r.strength, reports14d: r.reports_14d, targetArea: r.target_area };
  }

  return {
    userId,
    birthYear: snap.profile.birth_year,
    endAge: snap.profile.end_age,
    today: snap.profile.today,
    timezone: snap.profile.timezone,
    level: snap.profile.level as Level,
    score: snap.profile.score,
    credits: snap.profile.credits,
    modes,
    goals: snap.goals.map(
      (g): Goal => ({
        id: g.id,
        area: g.area,
        level: g.level as Goal["level"],
        title: g.title,
        kind: g.kind,
        status: g.status,
        progress: g.progress,
        risk: g.risk,
        frozen: g.frozen,
        ...(g.locked_in_on ? { lockedInOn: g.locked_in_on } : {}),
        ...(g.last_quarterly_check ? { lastQuarterlyCheck: g.last_quarterly_check } : {}),
      }),
    ),
    programs: snap.programs.map(
      (p): Program => ({
        id: p.id,
        goalId: p.goal_id,
        weeks: p.weeks,
        currentWeek: p.current_week,
        done: p.done,
        threshold: p.threshold,
      }),
    ),
    habits: snap.habits.map(
      (h): Habit => ({
        id: h.id,
        goalId: h.goal_id,
        area: h.area,
        title: h.title,
        fullDose: h.full_dose,
        minimumDose: h.minimum_dose,
        weeklyTarget: { focus: h.weekly_target_focus, maintain: h.weekly_target_maintain, rest: h.weekly_target_rest },
        maintenance: h.maintenance,
        history: history.get(h.id) ?? [],
      }),
    ),
    resistance,
    gamePlans: snap.gamePlans.map((gp) => ({ id: gp.id, resistance: gp.resistance, text: gp.text, equipped: gp.equipped })),
    rules: snap.rules.map(
      (r): RuleAdjustment => ({
        id: r.id,
        trigger: r.trigger,
        message: r.message,
        effect: r.effect,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      }),
    ),
    character: {
      health: snap.character.health,
      strength: snap.character.strength,
      graceDaysLeft: snap.character.grace_days_left,
    },
    recovery: snap.recovery
      ? {
          cause: snap.recovery.cause,
          startedOn: snap.recovery.started_on,
          day: snap.recovery.day,
          daysDone: snap.recovery.days_done,
          habitTitle: snap.recovery.habit_title,
        }
      : null,
    season: {
      index: snap.season.index,
      startsOn: snap.season.starts_on,
      focus: snap.season.focus,
      autoRecoveryUsed: snap.season.auto_recovery_used,
      lifeEventPauseUsed: snap.season.life_event_pause_used,
    },
    weekProgress,
  };
}

/**
 * Ledger rows for a step: one per "points" event, dated the state's today.
 * Points events carry no source id yet, so sourceId is left out.
 */
export function ledgerFromEvents(result: StepResult): LedgerEntry[] {
  return result.events
    .filter((e): e is Extract<GameEvent, { type: "points" }> => e.type === "points")
    .map((e) => ({ date: result.state.today, kind: e.reason as LedgerKind, score: e.score, credits: e.credits }));
}

/** Arguments for the save_step_result RPC. */
export function toSaveArgs(userId: string, result: StepResult) {
  return {
    p_user_id: userId,
    p_state: result.state,
    p_ledger: ledgerFromEvents(result),
    p_events: result.events,
  };
}
