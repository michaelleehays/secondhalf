import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, type GameState, type RulesConfig, type StepResult } from "@second-half/contracts";
import { toGameState, toSaveArgs, type GameSnapshot } from "./rows";

/** A loaded game and the version it was loaded at. */
export interface VersionedGameState {
  state: GameState;
  version: number;
}

/** Postgres code for "the game changed since it was loaded". Load again and retry. */
export const STALE_SAVE = "40001";

export class GameApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GameApiError";
  }
}

export interface GameApi {
  /** The player's saved game, or null if they have none (or it is not theirs to read). */
  loadGameState(userId: string): Promise<GameState | null>;
  /** The saved game with its version, for saves that must not overwrite a newer one. */
  loadVersioned(userId: string): Promise<VersionedGameState | null>;
  /**
   * Saves the new state, its ledger rows and its events in one transaction and returns the new version.
   * With `expectedVersion`, the save is refused (GameApiError code STALE_SAVE) if the game changed since then.
   */
  saveStepResult(userId: string, result: StepResult, options?: { expectedVersion?: number }): Promise<number>;
}

/**
 * Typed game data client. Pass a supabase-js client signed in as the player,
 * or a service-role client for server jobs.
 */
export function createGameApi(supabase: SupabaseClient, config: RulesConfig = DEFAULT_RULES): GameApi {
  async function loadVersioned(userId: string): Promise<VersionedGameState | null> {
    const { data, error } = await supabase.rpc("load_game_state", {
      p_user_id: userId,
      p_history_days: config.history.days,
    });
    if (error) throw new GameApiError(`Could not load the game: ${error.message}`, error.code);
    if (!data) return null;
    const snap = data as GameSnapshot;
    return { state: toGameState(snap), version: snap.profile.version };
  }

  return {
    loadVersioned,

    async loadGameState(userId) {
      return (await loadVersioned(userId))?.state ?? null;
    },

    async saveStepResult(userId, result, options = {}) {
      const { data, error } = await supabase.rpc("save_step_result", toSaveArgs(userId, result, options.expectedVersion));
      if (error) throw new GameApiError(`Could not save the game: ${error.message}`, error.code);
      return data as number;
    },
  };
}
