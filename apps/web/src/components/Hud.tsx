import type { HudModel } from "@/lib/hud";
import { fmt } from "@/lib/labels";

/** Top-of-screen readout over the scene: level, score, credits, life clock, health, strength and status pills. */
export function Hud({ hud }: { hud: HudModel }) {
  return (
    <header className="hud">
      <div className="hrow">
        <div className="lvl">
          <b>{hud.levelCode}</b>
          <span>{hud.levelName}</span>
        </div>
        <dl className="stats">
          <div>
            <dt>Score</dt>
            <dd key={hud.score} className="bump">{fmt(hud.score)}</dd>
          </div>
          <div className="cr">
            <dt>Credits</dt>
            <dd key={hud.credits} className="bump">{fmt(hud.credits)}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd title={`${fmt(hud.daysLeft)} days left in the game`}>{fmt(hud.daysLeft)}d</dd>
          </div>
        </dl>
      </div>
      <div className="pills">
        <Meter label="Health" value={hud.health} tone={hud.healthTone} />
        <Meter label="Strength" value={hud.strength} tone="cool" />
        {hud.recovery ? (
          <span className="pill rec">
            Recovery · day {hud.recovery.day} of {hud.recovery.of}
          </span>
        ) : (
          hud.atRisk.map((g) => (
            <span key={g.goalId} className="pill risk">
              {g.label} at risk · {g.risk}%
            </span>
          ))
        )}
      </div>
    </header>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="pill">
      {label}
      <span className="m" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <i className={`tone-${tone}`} style={{ width: `${value}%` }} />
      </span>
      <span className="mono">{value}</span>
    </span>
  );
}
