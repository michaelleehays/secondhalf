/**
 * A trail for the demo and tests, built from a GameState until the engine fills WorldView.trail
 * (workstream A). Demo-only: the real trail comes from the engine.
 */
import type { AreaId, GameState, JournalEntry, Level, TrailView } from "@second-half/contracts";

const SAMPLE_MOMENTS: Partial<Record<AreaId, JournalEntry[]>> = {
  body: [
    { date: "2026-06-02", kind: "setback", area: "body", goalId: "body-101", label: "Fatigue setback: −7 health" },
    { date: "2026-07-14", kind: "at_risk", area: "body", goalId: "body-101", label: "Run a 5K at risk · 40%" },
    { date: "2026-07-20", kind: "risk_cleared", area: "body", goalId: "body-101", label: "Back on track" },
    { date: "2026-09-20", kind: "locked_in", area: "body", goalId: "body-101", label: "Locked in: Run a 5K" },
    { date: "2026-10-04", kind: "verified", area: "body", goalId: "body-101", label: "Verified: 5K in 27:40" },
    { date: "2026-11-10", kind: "setback", area: "body", goalId: "body-201", label: "Fatigue setback: −7 health" },
  ],
  money: [
    { date: "2026-08-01", kind: "locked_in", area: "money", goalId: "money-101", label: "Locked in: $5,000 emergency fund" },
    { date: "2026-11-18", kind: "at_risk", area: "money", goalId: "money-101", label: "Temptation: Money 101 at risk · 60%" },
  ],
};

export function sampleTrail(state: GameState, area: AreaId): TrailView {
  const stops = state.goals
    .filter((g) => g.area === area)
    .sort((a, b) => a.level - b.level)
    .map((g) => ({ goalId: g.id, level: g.level, title: g.title, status: g.status, progress: g.progress, frozen: g.frozen || g.level > state.level }));
  const moments = (state.journal?.filter((j) => j.area === area) ?? SAMPLE_MOMENTS[area] ?? []).slice();
  return { area, stops, moments };
}

export const SAMPLE_LEVEL_NAMES: Record<Level, string> = {
  1: "Foundations",
  2: "Momentum",
  3: "Mastery",
  4: "Legacy",
  5: "The Vision",
};
