"use client";

import type { ReactNode } from "react";
import type { CheckInResult, GameState, Habit, RulesConfig } from "@second-half/contracts";
import type { Draft, DraftAction } from "@/lib/checkin";
import { unanswered } from "@/lib/checkin";
import { AREA_META, RESISTANCE_META, RESISTANCE_ORDER } from "@/lib/labels";
import { Sheet } from "./Sheet";

interface Props {
  open: boolean;
  state: GameState;
  rules: RulesConfig;
  habits: Habit[];
  draft: Draft;
  dispatch: (a: DraftAction) => void;
  busy: boolean;
  onClose: () => void;
  onCloseDay: () => void;
}

const RESULTS: { result: CheckInResult; label: string; cls: string }[] = [
  { result: "full", label: "Done", cls: "d" },
  { result: "minimum", label: "Minimum", cls: "m" },
  { result: "missed", label: "Missed", cls: "x" },
];

/** Tonight's check-in: one card per active habit. Done, Minimum or Missed, then a one-tap reason for a miss. */
export function CheckInSheet({ open, state, rules, habits, draft, dispatch, busy, onClose, onCloseDay }: Props) {
  const left = unanswered(draft, habits.map((h) => h.id)).length;
  const grace = state.character.graceDaysLeft;

  const footer = (
    <>
      <span className="small muted" aria-live="polite">
        {left ? `${left} left` : "All answered"} · {grace} grace {grace === 1 ? "day" : "days"}
      </span>
      <button className="btn primary" onClick={onCloseDay} disabled={left > 0 || busy || habits.length === 0}>
        {busy ? "Closing…" : "Close the day"}
      </button>
    </>
  );

  return (
    <Sheet open={open} title="Tonight's check-in" onClose={onClose} footer={footer}>
      {state.recovery ? (
        <Coach>
          Recovery mode, day {state.recovery.day} of {rules.recovery.days}. Decay and Resistance are frozen. Only one thing counts tonight.
        </Coach>
      ) : null}
      {habits.length === 0 ? <p className="muted">No habits are due tonight. Rest areas sit this one out.</p> : null}
      {habits.map((h) => {
        const entry = draft[h.id];
        const area = AREA_META[h.area];
        return (
          <article key={h.id} className="card" aria-label={h.title}>
            <div>
              <span className="tag">{area.name}</span>
              <b className="title">{h.title}</b>
              <div className="small muted">Full: {h.fullDose}</div>
              <div className="small muted">Minimum: {h.minimumDose}</div>
            </div>
            <div className="seg" role="group" aria-label={`${h.title} result`}>
              {RESULTS.map((r) => (
                <button
                  key={r.result}
                  className={r.cls}
                  aria-pressed={entry?.result === r.result}
                  onClick={() => dispatch({ type: "result", habitId: h.id, result: r.result })}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {entry?.result === "missed" ? (
              <div className="why" role="group" aria-label="What got in the way?">
                <span>What got in the way?</span>
                {RESISTANCE_ORDER.map((id) => (
                  <button key={id} aria-pressed={entry.reason === id} onClick={() => dispatch({ type: "reason", habitId: h.id, reason: id })}>
                    {RESISTANCE_META[id].reason}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </Sheet>
  );
}

export function Coach({ children }: { children: ReactNode }) {
  return (
    <div className="coach">
      <span className="who">Coach</span>
      {children}
    </div>
  );
}
