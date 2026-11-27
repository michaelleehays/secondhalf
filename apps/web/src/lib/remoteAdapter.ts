import { DEFAULT_RULES, type Engine, type GameEvent, type GameState, type IsoDate, type RulesConfig, type StepResult } from "@second-half/contracts";
import { createEngine } from "@second-half/engine";
import type { GameApi } from "@second-half/api";
import { STALE_SAVE } from "@second-half/api";
import { ComingSoonError, isStub, StaleGameError, type GameAdapter, type GameStep, type SavedGame } from "./adapter";
import { laterOf } from "./dates";
import { newPlayerState } from "./newPlayer";

export interface RemoteAdapterOptions {
  api: GameApi;
  /** The signed-in player's id (auth.uid()). */
  userId: string;
  /** IANA time zone for a new player's game. */
  timezone: string;
  rules?: RulesConfig;
  engine?: Engine;
}

/** True when the player has already checked in for `state.today` (the engine sets today to the check-in date). */
export const closedOnFor = (state: GameState): IsoDate | null => (state.habits.some((h) => h.history.some((d) => d.date === state.today)) ? state.today : null);

const isStale = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === STALE_SAVE;

/**
 * The player's game in Supabase. Steps run on the real engine in the browser, then save through the
 * api client's save_step_result with version locking: a save made from an older copy is refused, the
 * latest game is loaded, and a StaleGameError hands it to the UI. The weekly rollover runs on the
 * server, so there are no demo controls here.
 */
export function createRemoteAdapter(opts: RemoteAdapterOptions): GameAdapter {
  const rules = opts.rules ?? DEFAULT_RULES;
  const engine = opts.engine ?? createEngine(rules);
  const { api, userId } = opts;
  /** The version of the game this adapter last loaded or saved. */
  let version = 0;

  const toGame = (state: GameState, today: IsoDate): SavedGame => ({ state, date: laterOf(today, state.today), closedOn: closedOnFor(state) });

  async function reload(today: IsoDate): Promise<SavedGame> {
    const loaded = await api.loadVersioned(userId);
    if (!loaded) throw new Error("The saved game disappeared.");
    version = loaded.version;
    return toGame(loaded.state, today);
  }

  async function commit(game: SavedGame, result: StepResult, extra: Partial<SavedGame> = {}): Promise<GameStep> {
    try {
      version = await api.saveStepResult(userId, result, { expectedVersion: version });
    } catch (err) {
      if (isStale(err)) throw new StaleGameError(await reload(game.date));
      throw err;
    }
    return { game: { ...game, ...extra, state: result.state }, events: result.events };
  }

  const demoOnly = (what: string) => async (): Promise<never> => {
    throw new Error(`${what} is a demo control; with an account the server runs the week.`);
  };

  return {
    rules,
    mode: "remote",
    async load(today) {
      const loaded = await api.loadVersioned(userId);
      if (loaded) {
        version = loaded.version;
        return toGame(loaded.state, today);
      }
      // First visit: start a new game and save it, so the next load finds it.
      const state = newPlayerState({ userId, today, timezone: opts.timezone, rules });
      version = 0;
      const created = await commit(toGame(state, today), { state, events: [] });
      return created.game;
    },
    async closeDay(game, checkIn) {
      return commit(game, engine.closeDay(game.state, checkIn), { closedOn: checkIn.date });
    },
    passWeek: demoOnly("Let a week pass"),
    nextDay: demoOnly("Skip to tomorrow"),
    reset: demoOnly("Restart"),
    async startLifeEvent(game) {
      return commit(game, engine.startLifeEvent(game.state, game.date));
    },
    async equipGamePlan(game, gamePlanId, equipped) {
      return commit(game, engine.equipGamePlan(game.state, gamePlanId, equipped));
    },
    async verifyAchievement(game, goalId, note) {
      return commit(game, engine.verifyAchievement(game.state, goalId, game.date, note));
    },
    async applyPlanEdit(game, edit) {
      let result: { state: GameState; events: GameEvent[] };
      try {
        result = engine.applyPlanEdit(game.state, edit, game.date);
      } catch (err) {
        if (isStub(err)) throw new ComingSoonError("Editing your plan");
        throw err;
      }
      // A refused edit changes nothing, so there is nothing to save.
      if (result.events.some((e) => e.type === "plan_rejected")) return { game, events: result.events };
      return commit(game, result);
    },
    async setVision(game, text) {
      const vision = text.trim();
      const { vision: _old, ...rest } = game.state;
      const state: GameState = vision ? { ...rest, vision } : rest;
      return (await commit(game, { state, events: [] })).game;
    },
    canEditPlan(state) {
      try {
        engine.applyPlanEdit(state, { kind: "rename_level", level: state.level, name: state.levelNames?.[state.level] ?? "" }, state.today);
        return true;
      } catch (err) {
        return !isStub(err);
      }
    },
    toWorldView: (state) => engine.toWorldView(state),
    projectedFinalScore: (state) => engine.projectedFinalScore(state),
  };
}
