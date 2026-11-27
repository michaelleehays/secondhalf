import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, type GameState, type RulesConfig, type StepResult } from "@second-half/contracts";
import { toGameState, toSaveArgs, type GameSnapshot } from "./rows";

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
  /** Saves the new state, its ledger rows and its events in one transaction. */
  saveStepResult(userId: string, result: StepResult): Promise<void>;
}

/**
 * Typed game data client. Pass a supabase-js client signed in as the player,
 * or a service-role client for server jobs.
 */
export function createGameApi(supabase: SupabaseClient, config: RulesConfig = DEFAULT_RULES): GameApi {
  return {
    async loadGameState(userId) {
      const { data, error } = await supabase.rpc("load_game_state", {
        p_user_id: userId,
        p_history_days: config.history.days,
      });
      if (error) throw new GameApiError(`Could not load the game: ${error.message}`, error.code);
      return data ? toGameState(data as GameSnapshot) : null;
    },

    async saveStepResult(userId, result) {
      const { error } = await supabase.rpc("save_step_result", toSaveArgs(userId, result));
      if (error) throw new GameApiError(`Could not save the game: ${error.message}`, error.code);
    },
  };
}
