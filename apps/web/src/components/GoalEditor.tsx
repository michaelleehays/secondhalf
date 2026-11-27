"use client";

import { useEffect, useState } from "react";
import type { GameState, Goal, GoalKind, Habit, PlanEdit } from "@second-half/contracts";
import { AREA_META, STATUS_COLOR, levelCode } from "@/lib/labels";
import {
  addHabitEdit,
  emptyHabitForm,
  goalForm,
  habitForm,
  isLocked,
  KIND_LABEL,
  lockedNote,
  MAX_WEEKLY_TARGET,
  setGoalEdit,
  updateHabitEdit,
  type GoalForm,
  type HabitForm,
} from "@/lib/plan";
import { Coach } from "./CheckInSheet";
import { Outcome, type EditOutcome } from "./LevelsScreen";

type Apply = (edit: PlanEdit | null) => Promise<EditOutcome>;

const PROOF_HINT: Record<GoalKind, string> = {
  milestone: "e.g. Run a timed 5K",
  system: "e.g. 30 days logged in a row",
};

/** Sheet body for one goal: title, kind, what proves it, and its habits. */
export function GoalEditor({ state, goalId, apply }: { state: GameState; goalId: string; apply: Apply }) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return <p className="muted">That goal isn't in your plan any more.</p>;
  const locked = isLocked(goal);
  const habits = state.habits.filter((h) => h.goalId === goal.id);
  return (
    <>
      {locked ? <Coach>{lockedNote(goal)}</Coach> : null}
      <GoalFields key={goal.id} goal={goal} apply={apply} />
      <section className="card plain" aria-label="Habits">
        <div className="top">
          <b>Habits that move it</b>
          <span className="small muted">{habits.length}</span>
        </div>
        {habits.length === 0 ? <p className="small muted">{locked ? "No habits on this goal." : "No habits yet. Add one below."}</p> : null}
        {habits.map((h) => (
          <HabitFields key={h.id} habit={h} locked={locked} apply={apply} />
        ))}
      </section>
      {locked ? null : <NewHabit state={state} goal={goal} apply={apply} />}
    </>
  );
}

function GoalFields({ goal, apply }: { goal: Goal; apply: Apply }) {
  const locked = isLocked(goal);
  const [form, setForm] = useState<GoalForm>(goalForm(goal));
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const id = goal.id;

  const save = async () => {
    const r = setGoalEdit(goal, form);
    if (!r.ok) return setOutcome({ status: "rejected", reason: r.error });
    setBusy(true);
    setOutcome({ status: "saving" });
    setOutcome(await apply(r.value));
    setBusy(false);
  };

  return (
    <form
      className="card form"
      style={{ ["--c" as string]: STATUS_COLOR[goal.status] }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="tag">
        {AREA_META[goal.area].name} {levelCode(goal.level)}
      </span>
      <label htmlFor={`${id}-title`}>Goal</label>
      <input id={`${id}-title`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <span className="label" id={`${id}-kind`}>
        Kind
      </span>
      <div className="seg two" role="group" aria-labelledby={`${id}-kind`}>
        {(["system", "milestone"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={form.kind === k} disabled={locked} onClick={() => setForm({ ...form, kind: k })}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="small muted">{form.kind === "system" ? "Ongoing: a behavior you keep, like meditating or weekly dinners." : "One-time: an achievement, like a 5K or an emergency fund."}</p>
      <label htmlFor={`${id}-proof`}>What proves it</label>
      <input id={`${id}-proof`} value={form.verification} placeholder={PROOF_HINT[form.kind]} onChange={(e) => setForm({ ...form, verification: e.target.value })} />
      <div className="actions">
        <Outcome outcome={outcome} />
        <button className="btn primary" disabled={busy}>
          Save goal
        </button>
      </div>
    </form>
  );
}

function TargetInput({ id, label, value, disabled, onChange }: { id: string; label: string; value: number; disabled: boolean; onChange: (n: number) => void }) {
  return (
    <div className="target">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_WEEKLY_TARGET}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      <span className="small muted">× a week</span>
    </div>
  );
}

function HabitInputs({ id, form, setForm, disabled }: { id: string; form: HabitForm; setForm: (f: HabitForm) => void; disabled: boolean }) {
  return (
    <>
      <label htmlFor={`${id}-title`}>Habit</label>
      <input id={`${id}-title`} value={form.title} disabled={disabled} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <label htmlFor={`${id}-full`}>Full version</label>
      <input id={`${id}-full`} value={form.fullDose} disabled={disabled} placeholder="e.g. 25 minutes" onChange={(e) => setForm({ ...form, fullDose: e.target.value })} />
      <label htmlFor={`${id}-min`}>Minimum</label>
      <input id={`${id}-min`} value={form.minimumDose} disabled={disabled} placeholder="e.g. A 10-minute walk" onChange={(e) => setForm({ ...form, minimumDose: e.target.value })} />
      <div className="targets">
        <TargetInput id={`${id}-focus`} label="Focus" value={form.focus} disabled={disabled} onChange={(n) => setForm({ ...form, focus: n })} />
        <TargetInput id={`${id}-maintain`} label="Maintain" value={form.maintain} disabled={disabled} onChange={(n) => setForm({ ...form, maintain: n })} />
      </div>
    </>
  );
}

function HabitFields({ habit, locked, apply }: { habit: Habit; locked: boolean; apply: Apply }) {
  const [form, setForm] = useState<HabitForm>(habitForm(habit));
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  useEffect(() => {
    if (!confirmRetire) return;
    const t = setTimeout(() => setConfirmRetire(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRetire]);

  const run = async (edit: PlanEdit | null) => {
    setBusy(true);
    setOutcome({ status: "saving" });
    setOutcome(await apply(edit));
    setBusy(false);
  };
  const save = () => {
    const r = updateHabitEdit(habit, form);
    if (!r.ok) return setOutcome({ status: "rejected", reason: r.error });
    void run(r.value);
  };
  const retire = () => {
    if (!confirmRetire) return setConfirmRetire(true);
    setConfirmRetire(false);
    void run({ kind: "retire_habit", habitId: habit.id });
  };

  return (
    <form
      className="habit-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <HabitInputs id={habit.id} form={form} setForm={setForm} disabled={locked} />
      {habit.maintenance ? <p className="small muted">Weekly maintenance habit for locked-in ground.</p> : null}
      {locked ? null : (
        <div className="actions">
          <Outcome outcome={outcome} />
          <button type="button" className={`btn${confirmRetire ? " danger" : ""}`} disabled={busy} onClick={retire}>
            {confirmRetire ? "Tap again to retire" : "Retire"}
          </button>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      )}
    </form>
  );
}

function NewHabit({ state, goal, apply }: { state: GameState; goal: Goal; apply: Apply }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HabitForm>(emptyHabitForm());
  const [outcome, setOutcome] = useState<EditOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open)
    return (
      <button className="btn row" onClick={() => setOpen(true)}>
        <span>+ Add a habit</span>
      </button>
    );

  const add = async () => {
    const r = addHabitEdit(state, goal, form);
    if (!r.ok) return setOutcome({ status: "rejected", reason: r.error });
    setBusy(true);
    setOutcome({ status: "saving" });
    const o = await apply(r.value);
    setBusy(false);
    setOutcome(o);
    if (o.status === "applied") setForm(emptyHabitForm());
  };

  return (
    <form
      className="card form"
      aria-label="New habit"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <b>New habit</b>
      <HabitInputs id={`${goal.id}-new`} form={form} setForm={setForm} disabled={false} />
      <div className="actions">
        <Outcome outcome={outcome} />
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          Add habit
        </button>
      </div>
    </form>
  );
}
