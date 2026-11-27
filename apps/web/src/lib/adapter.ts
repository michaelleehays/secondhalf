import {
  DEFAULT_RULES,
  type CheckIn,
  type Engine,
  type GameEvent,
  type GameState,
  type IsoDate,
  type RulesConfig,
  type WorldView,
} from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { createEngine } from "@second-half/engine";
import { addDays, laterOf, sundayOnOrAfter } from "./dates";
import { clearSaved, readSaved, writeSaved, type KeyValueStore, type SavedGame } from "./storage";

export type { SavedGame } from "./storage";

export interface GameStep {
  game: SavedGame;
  events: GameEvent[];
}

/**
 * Everything the screens need from the game. Today the real engine runs in the browser and the
 * game is saved on this device. Later the same interface is backed by the backend (workstream B).
 */
export interface GameAdapter {
  readonly rules: RulesConfig;
  /** The saved game, or the sample player on first run. `today` is the device date. */
  load(today: IsoDate): Promise<SavedGame>;
  closeDay(game: SavedGame, checkIn: CheckIn): Promise<GameStep>;
  /** Demo: runs the Sunday rollover for the current week and moves to the Monday after. */
  passWeek(game: SavedGame): Promise<GameStep>;
  /** Demo: moves to the next day without a check-in. */
  nextDay(game: SavedGame): Promise<SavedGame>;
  startLifeEvent(game: SavedGame): Promise<GameStep>;
  equipGamePlan(game: SavedGame, gamePlanId: string, equipped: boolean): Promise<GameStep>;
  /** Back to the sample player. */
  reset(today: IsoDate): Promise<SavedGame>;
  toWorldView(state: GameState): WorldView;
  projectedFinalScore(state: GameState): number;
}

export interface LocalAdapterOptions {
  rules?: RulesConfig;
  engine?: Engine;
  initial?: GameState;
  /** Where the game is saved; null keeps it in memory only. */
  store?: KeyValueStore | null;
}

/** The real engine, in memory, saved to the device's storage after every step. */
export function createLocalAdapter(options: LocalAdapterOptions = {}): GameAdapter {
  const rules = options.rules ?? DEFAULT_RULES;
  const engine = options.engine ?? createEngine(rules);
  const initial = options.initial ?? SAMPLE_STATE;
  const store = options.store ?? null;

  const fresh = (today: IsoDate): SavedGame => {
    const state = structuredClone(initial);
    // The sample's `today` is the last day it checked in, so it starts closed for that day.
    return { state, date: laterOf(today, state.today), closedOn: state.today };
  };
  const save = (game: SavedGame) => {
    writeSaved(store, game);
    return game;
  };
  const step = (game: SavedGame, result: { state: GameState; events: GameEvent[] }, extra: Partial<SavedGame> = {}): GameStep => ({
    game: save({ ...game, ...extra, state: result.state }),
    events: result.events,
  });

  return {
    rules,
    async load(today) {
      const saved = readSaved(store);
      if (!saved) return save(fresh(today));
      return { ...saved, date: laterOf(today, saved.date) };
    },
    async closeDay(game, checkIn) {
      return step(game, engine.closeDay(game.state, checkIn), { closedOn: checkIn.date });
    },
    async passWeek(game) {
      const sunday = sundayOnOrAfter(game.date);
      const result = engine.closeWeek(game.state, sunday);
      return step(game, result, { date: addDays(sunday, 1) });
    },
    async nextDay(game) {
      return save({ ...game, date: addDays(game.date, 1) });
    },
    async startLifeEvent(game) {
      return step(game, engine.startLifeEvent(game.state, game.date));
    },
    async equipGamePlan(game, gamePlanId, equipped) {
      return step(game, engine.equipGamePlan(game.state, gamePlanId, equipped));
    },
    async reset(today) {
      clearSaved(store);
      return save(fresh(today));
    },
    toWorldView: (state) => engine.toWorldView(state),
    projectedFinalScore: (state) => engine.projectedFinalScore(state),
  };
}
