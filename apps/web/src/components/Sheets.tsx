"use client";

import { useState, type CSSProperties } from "react";
import type { AreaId, GameEvent, GameState, Goal, IsoDate, Level, ResistanceId, RulesConfig } from "@second-half/contracts";
import { areaView, athleteView, MODE_LABEL, resistanceView, visionView } from "@/lib/coach";
import { shortDate } from "@/lib/dates";
import { AREA_META, RESISTANCE_META, levelCode } from "@/lib/labels";
import { readyToVerify } from "@/lib/plan";
import { Coach } from "./CheckInSheet";

const style = (vars: Record<string, string>) => vars as CSSProperties;

export function Bar({ value, max = 1, color, label }: { value: number; max?: number; color: string; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100}>
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ---------- Area ---------- */

export function AreaSheetBody({
  state,
  area,
  level,
  rules,
  events,
  onResistance,
  onVerify,
  busy,
}: {
  state: GameState;
  area: AreaId;
  level?: Level;
  rules: RulesConfig;
  events: readonly GameEvent[];
  onResistance: (id: ResistanceId) => void;
  onVerify: (goalId: string, note: string) => void;
  busy: boolean;
}) {
  const v = areaView(state, area, rules, events, level);
  const res = Object.values(state.resistance).find((r) => r.targetArea === area);
  return (
    <>
      <Coach>{v.coach}</Coach>
      {v.rows.map((row) => (
        <article
          key={row.goal.id}
          className={`card${row.current ? " current" : ""}`}
          style={style({ "--c": row.current ? v.color : "var(--line)" })}
          aria-current={row.current ? "true" : undefined}
        >
          <div className="top">
            <div>
              <span className="tag" style={style({ "--c": v.color })}>
                {row.tag}
              </span>
              <b className={`title${row.goal.status === "hidden" ? " muted" : ""}`}>{row.title}</b>
            </div>
            <span className={`small status ${row.tone}`}>{row.status}</span>
          </div>
          {row.fill !== null ? (
            <Bar value={row.fill} color={row.tone === "risk" ? "var(--risk)" : row.tone === "muted" ? "var(--muted)" : v.color} label={`${row.tag} progress`} />
          ) : null}
          {readyToVerify(row.goal, rules.progress.milestoneVerifyAt) ? <VerifyRow goal={row.goal} busy={busy} onVerify={onVerify} /> : null}
        </article>
      ))}
      <section className="card plain" aria-label={`${v.name} habits`}>
        <div className="top">
          <b>Habits</b>
          <span className="small muted">{v.mode} this season</span>
        </div>
        {v.habits.length ? (
          <ul className="list">
            {v.habits.map((h) => (
              <li key={h.id}>
                <span>{h.title}</span>
                <span className="small muted">
                  {h.weeklyTarget[state.modes[area]]}× a week · min: {h.minimumDose}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No habits feed {v.name} yet.</p>
        )}
      </section>
      {res ? (
        <button className="btn row" onClick={() => onResistance(res.id)}>
          <span>
            Resistance here: <b>{RESISTANCE_META[res.id].name}</b>
          </span>
          <span className="mono small">
            {res.strength} / {rules.resistance.max}
          </span>
        </button>
      ) : null}
    </>
  );
}

/** "I did it": the player confirms the real achievement behind a milestone at the verify mark. */
function VerifyRow({ goal, busy, onVerify }: { goal: Goal; busy: boolean; onVerify: (goalId: string, note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open)
    return (
      <div className="verify">
        <p className="small">{goal.verification ? `Ready when you've done it: ${goal.verification}.` : "Ready when you've done the real thing."}</p>
        <button className="btn primary" onClick={() => setOpen(true)}>
          I did it
        </button>
      </div>
    );
  return (
    <form
      className="verify form"
      onSubmit={(e) => {
        e.preventDefault();
        onVerify(goal.id, note.trim());
      }}
    >
      <label htmlFor={`${goal.id}-note`}>Add a note (optional)</label>
      <input id={`${goal.id}-note`} value={note} placeholder="e.g. 27:41 at the Turkey Trot" maxLength={140} onChange={(e) => setNote(e.target.value)} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Not yet
        </button>
        <button className="btn primary" disabled={busy}>
          Lock it in
        </button>
      </div>
    </form>
  );
}

/* ---------- Athlete ---------- */

export function AthleteSheetBody({
  state,
  rules,
  events,
  busy,
  onLifeEvent,
}: {
  state: GameState;
  rules: RulesConfig;
  events: readonly GameEvent[];
  busy: boolean;
  onLifeEvent: () => void;
}) {
  const v = athleteView(state, rules, events);
  const { health, strength } = state.character;
  return (
    <>
      <Coach>{v.coach}</Coach>
      <article className="card">
        <div className="kv">
          <span>Health</span>
          <Bar value={health} max={rules.health.max} color={health < rules.recovery.healthBelow ? "var(--risk)" : "var(--ok)"} label="Health" />
          <span className="mono small">{Math.round(health)}</span>
          <span>Strength</span>
          <Bar value={strength} max={rules.strength.max} color="var(--cool)" label="Strength" />
          <span className="mono small">{Math.round(strength)}</span>
        </div>
        <p className="small">
          <b>{v.condition}</b> · {v.build} · {v.graceText}
        </p>
        {v.knockedDownText ? <p className="small risk-ink">{v.knockedDownText}</p> : null}
        {v.recoveryText ? <p className="small cool-ink">{v.recoveryText}</p> : null}
      </article>
      <article className="card plain">
        <b>How the body changes</b>
        <p className="small muted">
          Strength sets the build, a little each week. Health sets posture: low health drops the head and rounds the shoulders. Setbacks hit visibly.
        </p>
      </article>
      <article className="card plain">
        <b>Life got in the way?</b>
        <p className="small muted">
          Illness, a family emergency or heavy travel. Logging it starts {rules.recovery.days} days of Recovery: decay, risk and Resistance freeze, and one small habit
          counts. You get one per season.
        </p>
        <button className="btn" onClick={onLifeEvent} disabled={!v.canLogLifeEvent || busy}>
          {state.recovery ? "In Recovery now" : state.season.lifeEventPauseUsed ? "Used this season" : "Log a life event"}
        </button>
      </article>
    </>
  );
}

/* ---------- Vision ---------- */

export function VisionSheetBody({ state, projected, date, onLevels }: { state: GameState; projected: number; date: IsoDate; onLevels: () => void }) {
  const v = visionView(state, projected, date);
  return (
    <>
      <Coach>{v.coach}</Coach>
      <article className="card" style={style({ "--c": "var(--gold)" })}>
        <span className="tag" style={style({ "--c": "var(--gold)" })}>
          501 · {v.name}
        </span>
        {state.vision?.trim() ? (
          <b className="title">{state.vision}</b>
        ) : (
          <>
            <b className="title muted">Not written yet</b>
            <p className="small muted">Your Vision is the life you're playing for, in your own words. It sits at the summit and every ring below climbs toward it.</p>
          </>
        )}
      </article>
      <button className="btn row" onClick={onLevels}>
        <span>
          <b>Your levels</b> · name them, set the goals and habits
        </span>
        <span aria-hidden="true">→</span>
      </button>
      <article className="card plain">
        <dl className="figures">
          <div>
            <dt>Score now</dt>
            <dd>{v.score}</dd>
          </div>
          <div>
            <dt>At 84, this pace</dt>
            <dd className="gold">{v.projected}</dd>
          </div>
          <div>
            <dt>Weeks left</dt>
            <dd>{v.weeksLeft}</dd>
          </div>
        </dl>
      </article>
      <article className="card plain">
        <b>The climb</b>
        <ul className="list">
          {v.rings.map((r) => (
            <li key={r.level}>
              <span>
                {levelCode(r.level)} · {r.name}
              </span>
              <span className="small muted">{r.held} of 5 locked in</span>
            </li>
          ))}
        </ul>
      </article>
    </>
  );
}

/* ---------- Resistance ---------- */

export function ResistanceSheetBody({
  state,
  id,
  rules,
  events,
  busy,
  onEquip,
}: {
  state: GameState;
  id: ResistanceId;
  rules: RulesConfig;
  events: readonly GameEvent[];
  busy: boolean;
  onEquip: (gamePlanId: string, equipped: boolean) => void;
}) {
  const v = resistanceView(state, id, rules, events);
  return (
    <>
      <Coach>{v.coach}</Coach>
      <article className="card" style={style({ "--c": "var(--risk)" })}>
        <div className="kv">
          <span>Strength</span>
          <Bar value={v.strength} max={v.max} color="var(--risk)" label={`${v.name} strength`} />
          <span className="mono small">
            {v.strength} / {v.max}
          </span>
        </div>
        <p className="small muted">
          Picked as &ldquo;{v.reason}&rdquo; {v.reports} {v.reports === 1 ? "time" : "times"} in two weeks · usually hits {v.area}
        </p>
        {v.attacking ? <p className="small risk-ink">{v.attacking}</p> : null}
      </article>
      <section className="card plain" aria-label="Game plans">
        <div className="top">
          <b>Game plans</b>
          <span className="small muted">
            {v.equippedCount} of {rules.resistance.maxEquippedPlans} running
          </span>
        </div>
        {v.plans.length ? (
          v.plans.map((p) => (
            <div key={p.id} className="plan">
              <p>{p.text}</p>
              <button className={`btn${p.equipped ? " on" : ""}`} aria-pressed={p.equipped} disabled={busy} onClick={() => onEquip(p.id, !p.equipped)}>
                {p.equipped ? "Running" : "Equip"}
              </button>
            </div>
          ))
        ) : (
          <p className="small muted">No game plan for {v.name} yet. An if-then plan, equipped, halves its setbacks.</p>
        )}
      </section>
      {v.rules.length ? (
        <section className="card plain" aria-label="Rule changes">
          <b>Rules adjusted for you</b>
          {v.rules.map((r) => (
            <p key={r.id} className="small">
              {r.message} <span className="muted">Until {shortDate(r.endsOn)}.</span>
            </p>
          ))}
        </section>
      ) : null}
    </>
  );
}

export const sheetTitle = (
  t: { kind: "area"; area: AreaId } | { kind: "athlete" } | { kind: "vision" } | { kind: "resistance"; id: ResistanceId } | { kind: "goal"; goalId: string },
  state: GameState,
): string => {
  switch (t.kind) {
    case "area":
      return `${AREA_META[t.area].name} · ${MODE_LABEL[state.modes[t.area]]}`;
    case "athlete":
      return "Your athlete";
    case "vision":
      return "The Vision";
    case "resistance":
      return RESISTANCE_META[t.id].name;
    case "goal": {
      const g = state.goals.find((x) => x.id === t.goalId);
      return g ? `${AREA_META[g.area].name} ${levelCode(g.level)}` : "Goal";
    }
  }
};
