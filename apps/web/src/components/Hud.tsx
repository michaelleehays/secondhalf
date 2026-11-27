import type { ReactNode } from "react";
import { AREAS, type AreaId } from "@second-half/contracts";
import type { HudModel } from "@/lib/hud";
import { AREA_META, fmt } from "@/lib/labels";

export type HudTarget = { kind: "athlete" } | { kind: "vision" } | { kind: "area"; area: AreaId };

/**
 * Top-of-screen readout over the scene: level, score, credits, life clock, health, strength and
 * status pills. The badge and pills are buttons, so every sheet the scene opens on a tap can also be
 * reached by keyboard and screen reader.
 */
export function Hud({ hud, actions, onOpen }: { hud: HudModel; actions?: ReactNode; onOpen: (t: HudTarget) => void }) {
  return (
    <header className="hud">
      <nav className="skip" aria-label="Areas">
        {AREAS.map((a) => (
          <button key={a} onClick={() => onOpen({ kind: "area", area: a })}>
            {AREA_META[a].name}
          </button>
        ))}
      </nav>
      <div className="hrow">
        <button className="lvl" onClick={() => onOpen({ kind: "vision" })} aria-label={`Level ${hud.levelCode}, ${hud.levelName}. Open the Vision`}>
          <b>{hud.levelCode}</b>
          <span>{hud.levelName}</span>
        </button>
        <dl className="stats">
          <div>
            <dt>Score</dt>
            <dd key={hud.score} className="bump">
              {fmt(hud.score)}
            </dd>
          </div>
          <div className="cr">
            <dt>Credits</dt>
            <dd key={hud.credits} className="bump">
              {fmt(hud.credits)}
            </dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd title={`${fmt(hud.daysLeft)} days left in the game`}>{fmt(hud.daysLeft)}d</dd>
          </div>
        </dl>
      </div>
      <div className="hrow">
        <div className="pills">
          <Meter label="Health" value={hud.health} max={hud.healthMax} tone={hud.healthTone} onClick={() => onOpen({ kind: "athlete" })} />
          <Meter label="Strength" value={hud.strength} max={hud.strengthMax} tone="cool" onClick={() => onOpen({ kind: "athlete" })} />
          {hud.recovery ? (
            <button className="pill rec" onClick={() => onOpen({ kind: "athlete" })}>
              Recovery · day {hud.recovery.day} of {hud.recovery.of}
            </button>
          ) : (
            hud.atRisk.map((g) => (
              <button key={g.goalId} className="pill risk" onClick={() => onOpen({ kind: "area", area: g.area })}>
                {g.label} at risk · {g.risk}%
              </button>
            ))
          )}
        </div>
        {actions}
      </div>
    </header>
  );
}

function Meter({ label, value, max, tone, onClick }: { label: string; value: number; max: number; tone: string; onClick: () => void }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <button className="pill" onClick={onClick} aria-label={`${label} ${value} of ${max}. Open your athlete`}>
      {label}
      <span className="m" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <i className={`tone-${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="mono">{value}</span>
    </button>
  );
}
