import { DEFAULT_RULES, type CheckIn, type GameState, type RulesConfig, type StepResult, type WorldView } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { toWorldView } from "@second-half/engine";
import { mockCloseDay } from "./mockEngine";

/**
 * Everything the screens need from the game. Today it is a local mock; later the same
 * interface is backed by the real engine (workstream A) and Supabase (workstream B).
 */
export interface GameAdapter {
  readonly rules: RulesConfig;
  load(): Promise<GameState>;
  closeDay(state: GameState, checkIn: CheckIn): Promise<StepResult>;
  toWorldView(state: GameState): WorldView;
}

export function createMockAdapter(options: { rules?: RulesConfig; initial?: GameState } = {}): GameAdapter {
  const rules = options.rules ?? DEFAULT_RULES;
  const initial = options.initial ?? SAMPLE_STATE;
  return {
    rules,
    load: async () => structuredClone(initial),
    closeDay: async (state, checkIn) => mockCloseDay(state, checkIn, rules),
    toWorldView,
  };
}
