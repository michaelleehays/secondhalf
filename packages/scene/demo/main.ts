/**
 * Scene demo. Not shipped. Drives the scene from SAMPLE_STATE through the engine's toWorldView,
 * so the scene sees exactly what the app will give it. The state edits below are demo stand-ins
 * for what the engine will do; they are not game rules.
 */
import { AREAS, DEFAULT_RULES, type AreaId, type GameEvent, type GameState, type JournalEntry, type SceneTarget } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { toWorldView } from "@second-half/engine";
import { createScene } from "../src/index";
import { SAMPLE_LEVEL_NAMES, sampleTrail } from "./trailFixture";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let state: GameState = structuredClone(SAMPLE_STATE);

// ?quality=auto|high|low (default auto). The chosen level shows on the canvas as data-quality.
const q = new URLSearchParams(location.search).get("quality");
const quality = q === "high" || q === "low" ? q : "auto";
const scene = await createScene($("scene"), { assetsBaseUrl: "", quality });
/** The section the trail climbs (the engine will choose it; the demo lets you pick). */
let trailArea: AreaId = "body";
// Seed the journal with the fixture's moments so demo events can add to it.
state = { ...state, journal: AREAS.flatMap((a) => sampleTrail({ ...state, journal: undefined }, a).moments) };
const addMoment = (m: Omit<JournalEntry, "date">) => {
  state = { ...state, journal: [...(state.journal ?? []), { ...m, date: state.today }] };
};
/** The engine's trail when it's for the section picked here; otherwise the demo builds one for that section. */
const view = (s: GameState) => {
  const v = toWorldView(s);
  return { ...v, trail: v.trail?.area === trailArea ? v.trail : sampleTrail(s, trailArea), levelNames: v.levelNames ?? SAMPLE_LEVEL_NAMES };
};
const render = () => {
  scene.update(view(state));
  $<HTMLInputElement>("health").value = String(state.character.health);
  $<HTMLInputElement>("strength").value = String(state.character.strength);
  $("healthV").textContent = String(Math.round(state.character.health));
  $("strengthV").textContent = String(Math.round(state.character.strength));
};
render();

const setCharacter = (patch: Partial<GameState["character"]>) => {
  state = { ...state, character: { ...state.character, ...patch } };
  render();
};
$<HTMLInputElement>("health").oninput = (e) => setCharacter({ health: Number((e.target as HTMLInputElement).value) });
$<HTMLInputElement>("strength").oninput = (e) => setCharacter({ strength: Number((e.target as HTMLInputElement).value) });

const log = (text: string) => ($("log").textContent = text);

/** The trail's current goal: the first one in the section not yet locked in. */
const currentGoal = () =>
  state.goals.filter((g) => g.area === trailArea && g.status !== "locked_in").sort((a, b) => a.level - b.level)[0]?.id ??
  `${trailArea}-401`;

const setGoal = (id: string, patch: Partial<GameState["goals"][number]>) => {
  state = { ...state, goals: state.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
  render();
};
const setState = (patch: Partial<GameState>) => {
  state = { ...state, ...patch };
  render();
};

const EVENTS: [string, () => GameEvent][] = [
  ["Setback", () => {
    const damage = DEFAULT_RULES.health.setbackDamage;
    addMoment({ kind: "setback", area: trailArea, goalId: currentGoal(), label: `Setback: −${damage} health` });
    setCharacter({ health: Math.max(0, state.character.health - damage) });
    return { type: "setback", resistance: "temptation", damage };
  }],
  ["Knocked down", () => {
    setCharacter({ health: DEFAULT_RULES.health.knockedDownAt });
    return { type: "knocked_down" };
  }],
  ["Get up", () => {
    setCharacter({ health: DEFAULT_RULES.health.getUpHealth });
    return { type: "health_changed", delta: DEFAULT_RULES.health.getUpHealth, reason: "recovery" };
  }],
  ["Locked in", () => {
    setGoal("people-101", { status: "locked_in", progress: 1 });
    return { type: "locked_in", goalId: "people-101" };
  }],
  ["At risk", () => {
    setGoal("money-101", { status: "at_risk", risk: 80 });
    return { type: "at_risk", goalId: "money-101", risk: 80 };
  }],
  ["Risk cleared", () => {
    setGoal("money-101", { status: "locked_in", risk: 0 });
    return { type: "risk_cleared", goalId: "money-101" };
  }],
  ["Ground lost", () => {
    setGoal("money-101", { status: "lost", risk: 0, progress: 0.5 });
    return { type: "ground_lost", goalId: "money-101" };
  }],
  ["Level up", () => {
    const level = Math.min(5, state.level + 1) as GameState["level"];
    setState({ level });
    return { type: "level_up", level };
  }],
  ["Level lost", () => {
    const level = Math.max(1, state.level - 1) as GameState["level"];
    setState({ level });
    return { type: "level_lost", level };
  }],
  ["Fatigue +1", () => {
    const r = state.resistance.fatigue;
    const strength = Math.min(DEFAULT_RULES.resistance.max, r.strength + 1);
    setState({ resistance: { ...state.resistance, fatigue: { ...r, strength } } });
    return { type: "resistance_changed", id: "fatigue", strength };
  }],
  ["Recovery", () => {
    setState({ recovery: { cause: "auto", startedOn: state.today, day: 1, daysDone: 0, habitTitle: "10-minute walk" } });
    return { type: "recovery_started", cause: "auto" };
  }],
  ["Recovery ends", () => {
    setState({ recovery: null });
    return { type: "recovery_ended", completed: true };
  }],
  ["Climb +20%", () => {
    const id = currentGoal();
    const g = state.goals.find((x) => x.id === id)!;
    const progress = Math.min(1, (g.status === "open" || g.status === "hidden" ? 0 : g.progress) + 0.2);
    if (progress >= 1) {
      addMoment({ kind: "locked_in", area: g.area, goalId: id, label: `Locked in: ${g.title}` });
      setGoal(id, { status: "locked_in", progress: 1 });
      return { type: "locked_in", goalId: id };
    }
    setGoal(id, { status: "in_progress", progress });
    return { type: "progress", goalId: id, from: g.progress, to: progress };
  }],
  ["Reset", () => {
    state = { ...structuredClone(SAMPLE_STATE), journal: AREAS.flatMap((a) => sampleTrail({ ...SAMPLE_STATE, journal: undefined }, a).moments) };
    render();
    return { type: "risk_cleared", goalId: "none" };
  }],
];
for (const [label, make] of EVENTS) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => {
    const ev = make();
    scene.play(ev);
    log(`play(${JSON.stringify(ev)})`);
  };
  $("events").append(b);
}

const VIEWS: [string, SceneTarget][] = [
  ["Home", { kind: "home" }],
  ["Athlete", { kind: "athlete" }],
  ...AREAS.map((area): [string, SceneTarget] => [area[0]!.toUpperCase() + area.slice(1), { kind: "area", area }]),
  ["Vision", { kind: "vision" }],
];
for (const [label, target] of VIEWS) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => scene.focus(target);
  $("views").append(b);
}

// Section the trail climbs.
for (const area of AREAS) {
  const b = document.createElement("button");
  b.textContent = `Trail: ${area}`;
  b.onclick = () => {
    trailArea = area;
    render();
    scene.focus({ kind: "home" });
  };
  $("trail").append(b);
}

// Simulated app sheets, reported to the scene with setInsets (the overlay just shows the covered area).
const sheet = $("sheet");
const SHEETS: [string, () => { top: number; right: number; bottom: number; left: number }][] = [
  ["No sheet", () => ({ top: 0, right: 0, bottom: 0, left: 0 })],
  ["Right sheet", () => ({ top: 0, right: Math.min(440, innerWidth * 0.45), bottom: 0, left: 0 })],
  ["Bottom sheet", () => ({ top: 0, right: 0, bottom: Math.round(innerHeight * 0.55), left: 0 })],
];
for (const [label, insets] of SHEETS) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => {
    const i = insets();
    Object.assign(sheet.style, { display: i.right || i.bottom ? "block" : "none", top: i.right ? "0" : "auto", bottom: "0", right: "0", width: i.right ? `${i.right}px` : "100%", height: i.bottom ? `${i.bottom}px` : "100%" });
    scene.setInsets?.(i);
  };
  $("sheets").append(b);
}

scene.onSelect((target) => {
  log(`onSelect(${JSON.stringify(target)})`);
  scene.focus(target);
});

Object.assign(window, { scene });
