/**
 * Scene demo. Not shipped. Drives the scene from SAMPLE_STATE through the engine's toWorldView,
 * so the scene sees exactly what the app will give it. The state edits below are demo stand-ins
 * for what the engine will do; they are not game rules.
 */
import { AREAS, DEFAULT_RULES, type GameEvent, type GameState, type SceneTarget } from "@second-half/contracts";
import { SAMPLE_STATE } from "@second-half/contracts/fixtures";
import { toWorldView } from "@second-half/engine";
import { createScene } from "../src/index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let state: GameState = structuredClone(SAMPLE_STATE);

const scene = await createScene($("scene"), { assetsBaseUrl: "" });
const render = () => {
  scene.update(toWorldView(state));
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
  ["Reset", () => {
    state = structuredClone(SAMPLE_STATE);
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

scene.onSelect((target) => {
  log(`onSelect(${JSON.stringify(target)})`);
  scene.focus(target);
});

Object.assign(window, { scene });
