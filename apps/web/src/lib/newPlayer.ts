import { DEFAULT_RULES, type GameState, type IsoDate, type ResistanceId, type RulesConfig } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { addDays } from "./dates";

export interface NewPlayerOptions {
  userId: string;
  /** The device's date; the new game's last closed day is the day before, so tonight's check-in is open. */
  today: IsoDate;
  timezone: string;
  /** Defaults to the year the player is rules.life.startAge. Onboarding will ask. */
  birthYear?: number;
  rules?: RulesConfig;
  /** Where the goal and habit titles come from until onboarding builds Level 101 from the player's own goals. */
  template?: GameState;
}

/**
 * A fresh game at Level 101: nothing locked in, no score, health at its starting value. The goals
 * and habits are the sample player's, reset (101 open, the rest hidden, habits feeding the 101 goal
 * in their area), so a signed-in player can play straight away. Onboarding replaces this.
 */
export function newPlayerState(opts: NewPlayerOptions): GameState {
  const rules = opts.rules ?? DEFAULT_RULES;
  const t = opts.template ?? SAMPLE_STATE;
  const year = Number(opts.today.slice(0, 4));
  const resistance = Object.fromEntries(
    Object.entries(t.resistance).map(([id, r]) => [id, { ...r, strength: 1, reports14d: 0 }]),
  ) as Record<ResistanceId, GameState["resistance"][ResistanceId]>;

  return {
    userId: opts.userId,
    birthYear: opts.birthYear ?? year - rules.life.startAge,
    endAge: rules.life.defaultEndAge,
    today: addDays(opts.today, -1),
    timezone: opts.timezone,
    level: 1,
    bestLevel: 1,
    score: 0,
    credits: 0,
    modes: { ...t.modes },
    goals: t.goals.map((g) => {
      const { lockedInOn: _l, lastQuarterlyCheck: _q, verifiedOn: _v, ...rest } = g;
      return { ...rest, status: g.level === 1 ? "open" : "hidden", progress: 0, risk: 0, frozen: false };
    }),
    programs: [],
    habits: t.habits.map((h) => ({ ...h, goalId: `${h.area}-101`, history: [] })),
    resistance,
    gamePlans: t.gamePlans.map((p) => ({ ...p, equipped: false })),
    rules: [],
    character: { health: rules.health.start, strength: rules.strength.start, graceDaysLeft: rules.grace.perMonth },
    recovery: null,
    season: { index: 1, startsOn: opts.today, focus: [...t.season.focus], autoRecoveryUsed: false, lifeEventPauseUsed: false },
    journal: [],
    weekProgress: {},
  };
}
