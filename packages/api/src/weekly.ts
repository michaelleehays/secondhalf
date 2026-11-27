import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, type GameState, type IsoDate, type RulesConfig, type StepResult } from "@second-half/contracts";
import { createEngine } from "@second-half/engine";
import { createGameApi, STALE_SAVE } from "./client";
import { toSaveArgs } from "./rows";

/** The one engine call the weekly job needs. The engine's is synchronous; tests may return a promise. */
export type CloseWeek = (state: GameState, weekEnding: IsoDate) => StepResult | Promise<StepResult>;

/**
 * Adapter over the engine's closeWeek (engine #21). If it throws for a player, that player shows up
 * under `failed`, nothing is written for them, and the next hourly run retries.
 */
export function engineCloseWeek(config: RulesConfig = DEFAULT_RULES): CloseWeek {
  const engine = createEngine(config);
  return (state, weekEnding) => engine.closeWeek(state, weekEnding);
}

export interface RolloverReport {
  due: number;
  closed: { userId: string; weekEnding: IsoDate; events: number }[];
  /** Nothing to do: no saved game, or another run closed the week first. */
  skipped: { userId: string; reason: "no_game" | "already_closed" }[];
  /** The game changed (a check-in) between load and save. Nothing written; the next run retries. */
  retry: { userId: string }[];
  /** Nothing written; the next run retries. */
  failed: { userId: string; error: string }[];
}

/** Counts only: safe to return to the scheduler, whose responses pg_net stores. */
export function rolloverCounts(r: RolloverReport) {
  return { due: r.due, closed: r.closed.length, skipped: r.skipped.length, retry: r.retry.length, failed: r.failed.length };
}

interface DueRow { user_id: string; week_start: IsoDate; week_ending: IsoDate }

/**
 * Closes the week for every player whose local Sunday 23:00 has passed and whose week is still open.
 * `supabase` must be a service-role client. `now` comes in as an argument; this module never reads the clock.
 * Safe to run twice or concurrently: save_week_rollover refuses a week that is already closed, and refuses
 * a save built from a load older than the stored game (a check-in landed meanwhile).
 */
export async function runWeeklyRollover(
  supabase: SupabaseClient,
  closeWeek: CloseWeek,
  now: Date,
  options: { config?: RulesConfig; limit?: number } = {},
): Promise<RolloverReport> {
  const config = options.config ?? DEFAULT_RULES;
  const api = createGameApi(supabase, config);
  const report: RolloverReport = { due: 0, closed: [], skipped: [], retry: [], failed: [] };

  const { data, error } = await supabase.rpc("due_week_rollovers", {
    p_now: now.toISOString(),
    p_limit: options.limit ?? 500,
  });
  if (error) throw new Error(`Could not list players due a weekly rollover: ${error.message}`);
  const due = (data ?? []) as DueRow[];
  report.due = due.length;

  for (const row of due) {
    try {
      const loaded = await api.loadVersioned(row.user_id);
      if (!loaded) {
        report.skipped.push({ userId: row.user_id, reason: "no_game" });
        continue;
      }
      const result = await closeWeek(loaded.state, row.week_ending);
      const { error: saveError } = await supabase.rpc("save_week_rollover", {
        ...toSaveArgs(row.user_id, result, loaded.version),
        p_week_ending: row.week_ending,
      });
      if (saveError?.code === "23505") {
        report.skipped.push({ userId: row.user_id, reason: "already_closed" });
      } else if (saveError?.code === STALE_SAVE) {
        report.retry.push({ userId: row.user_id });
      } else if (saveError) {
        report.failed.push({ userId: row.user_id, error: saveError.message });
      } else {
        report.closed.push({ userId: row.user_id, weekEnding: row.week_ending, events: result.events.length });
      }
    } catch (e) {
      report.failed.push({ userId: row.user_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}
