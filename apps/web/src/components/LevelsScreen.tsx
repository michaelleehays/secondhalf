"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GameState, Goal, Level, PlanEdit } from "@second-half/contracts";
import { AREA_META } from "@/lib/labels";
import { KIND_LABEL, ladder, MAX_LEVEL_NAME, MAX_VISION, renameLevelEdit } from "@/lib/plan";
import { goalStatusText } from "@/lib/coach";
import type { RulesConfig } from "@second-half/contracts";

/** What happened to an edit, for the form that sent it. */
export type EditOutcome = { status: "applied" } | { status: "unchanged" } | { status: "rejected"; reason: string } | { status: "coming_soon" } | { status: "failed" };

export const outcomeText = (o: EditOutcome | null): { text: string; tone: "ok" | "bad" | "muted" } | null => {
  if (!o) return null;
  switch (o.status) {
    case "applied":
      return { text: "Saved.", tone: "ok" };
    case "unchanged":
      return { text: "Nothing changed.", tone: "muted" };
    case "rejected":
      return { text: o.reason, tone: "bad" };
    case "coming_soon":
      return { text: "Coming soon: saving plan edits lands with the next engine update.", tone: "muted" };
    case "failed":
      return { text: "That didn't save. Try again.", tone: "bad" };
  }
};

export function Outcome({ outcome }: { outcome: EditOutcome | null }) {
  const o = outcomeText(outcome);
  return (
    <p className={`small outcome ${o?.tone ?? ""}`} role="status" aria-live="polite">
      {o?.text ?? ""}
    </p>
  );
}

interface Props {
  state: GameState;
  rules: RulesConfig;
  canEdit: boolean;
  onBack: () => void;
  onGoal: (goal: Goal) => void;
  apply: (edit: PlanEdit | null) => Promise<EditOutcome>;
  saveVision: (text: string) => Promise<EditOutcome>;
}

/** "Your levels": the ladder from 101 to 501. Each level's name is editable; tap a goal to edit it. */
export function LevelsScreen({ state, rules, canEdit, onBack, onGoal, apply, saveVision }: Props) {
  const rungs = ladder(state);
  const currentRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    currentRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <section className="screen" aria-labelledby="levels-title">
      <header className="screen-head">
        <button ref={backRef} className="iconbtn" onClick={onBack}>
          ← Map
        </button>
        <h1 id="levels-title">Your levels</h1>
      </header>
      <div className="screen-body">
        <div className="coach">
          <span className="who">Coach</span>
          Each level is one goal in each area, and each goal builds on the one below it. Name the levels, set the goals, and pick the habits that move them.
        </div>
        {!canEdit ? (
          <p className="banner" role="note">
            Coming soon: saving edits arrives with the next engine update. You can look around and try the forms now.
          </p>
        ) : null}
        {rungs.map((r) => (
          <article key={r.level} ref={r.current ? currentRef : undefined} className={`rung${r.current ? " current" : ""}`} aria-label={`Level ${r.code}`}>
            <LevelName level={r.level} code={r.code} name={r.name} current={r.current} held={r.held} total={r.goals.length} state={state} apply={apply} />
            {r.level === 5 ? (
              <VisionField vision={state.vision ?? ""} save={saveVision} />
            ) : (
              <ul className="goals">
                {r.goals.map((g) => (
                  <li key={g.id}>
                    <button className="goal" style={{ "--c": AREA_META[g.area].color } as CSSProperties} onClick={() => onGoal(g)}>
                      <span className="tag">
                        {AREA_META[g.area].name} · {KIND_LABEL[g.kind]}
                      </span>
                      <b>{g.title}</b>
                      <span className={`small ${g.status === "at_risk" || g.status === "lost" ? "risk-ink" : "muted"}`}>{goalStatusText(g, rules)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function VisionField({ vision, save }: { vision: string; save: (text: string) => Promise<EditOutcome> }) {
  const [value, setValue] = useState(vision);
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(vision), [vision]);
  const changed = value.trim() !== vision.trim();
  return (
    <form
      className="form vision-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed) return setOutcome({ status: "unchanged" });
        setBusy(true);
        setOutcome(await save(value));
        setBusy(false);
      }}
    >
      <label htmlFor="vision-text">Your Vision, in your own words</label>
      <textarea
        id="vision-text"
        rows={3}
        maxLength={MAX_VISION}
        value={value}
        placeholder="e.g. Strong at 84. Free with my time. Surrounded by people I love."
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="actions">
        <Outcome outcome={outcome} />
        <span className="small muted">
          {value.length} / {MAX_VISION}
        </span>
        <button className="btn primary" disabled={busy || !changed}>
          Save Vision
        </button>
      </div>
    </form>
  );
}

function LevelName({
  level,
  code,
  name,
  current,
  held,
  total,
  state,
  apply,
}: {
  level: Level;
  code: string;
  name: string;
  current: boolean;
  held: number;
  total: number;
  state: GameState;
  apply: (edit: PlanEdit | null) => Promise<EditOutcome>;
}) {
  const [value, setValue] = useState(name);
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(name), [name]);

  const save = async () => {
    const r = renameLevelEdit(state, level, value);
    if (!r.ok) return setOutcome({ status: "rejected", reason: r.error });
    setBusy(true);
    setOutcome(await apply(r.value));
    setBusy(false);
  };

  return (
    <div className="rung-head">
      <div className="rung-title">
        <span className="code">{code}</span>
        <span className="small muted">{current ? "You are here" : level === 5 ? "The Vision" : `${held} of ${total} locked in`}</span>
      </div>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="sr-only" htmlFor={`level-${level}`}>
          Name for level {code}
        </label>
        <input id={`level-${level}`} value={value} maxLength={MAX_LEVEL_NAME} onChange={(e) => setValue(e.target.value)} />
        <button className="btn" disabled={busy || value.trim() === name}>
          Rename
        </button>
      </form>
      <Outcome outcome={outcome} />
    </div>
  );
}
