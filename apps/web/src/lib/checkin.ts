import type { CheckIn, CheckInResult, IsoDate, ResistanceId } from "@second-half/contracts";

/** What the player has tapped so far tonight, by habit id. */
export type Draft = Record<string, { result: CheckInResult; reason?: ResistanceId }>;

export type DraftAction =
  | { type: "result"; habitId: string; result: CheckInResult }
  | { type: "reason"; habitId: string; reason: ResistanceId }
  | { type: "reset" };

export function draftReducer(draft: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "result": {
      const prev = draft[action.habitId];
      // Keep a picked reason only while the answer stays "missed".
      const keep = action.result === "missed" && prev?.result === "missed" && prev.reason ? { reason: prev.reason } : {};
      return { ...draft, [action.habitId]: { result: action.result, ...keep } };
    }
    case "reason": {
      const prev = draft[action.habitId];
      if (prev?.result !== "missed") return draft;
      return { ...draft, [action.habitId]: { result: "missed", reason: action.reason } };
    }
    case "reset":
      return {};
  }
}

/** Habits still needing an answer. A miss needs a reason before it counts as answered. */
export function unanswered(draft: Draft, habitIds: readonly string[]): string[] {
  return habitIds.filter((id) => {
    const e = draft[id];
    return !e || (e.result === "missed" && !e.reason);
  });
}

export function toCheckIn(draft: Draft, habitIds: readonly string[], date: IsoDate): CheckIn {
  const missing = unanswered(draft, habitIds);
  if (missing.length) throw new Error(`Check-in is not complete: ${missing.join(", ")}`);
  return {
    date,
    entries: habitIds.map((habitId) => {
      const e = draft[habitId]!;
      return e.result === "missed" ? { habitId, result: e.result, reason: e.reason! } : { habitId, result: e.result };
    }),
  };
}
