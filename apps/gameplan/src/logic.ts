// Game Plan core: data model, dates, habit stats, queue, scoring and statistics.
// Every function here is pure. "today" always comes in as an argument; nothing reads the clock.

export type Status = "building" | "queued" | "maintaining" | "watching" | "parked" | "automated";
export type Kind = "daily" | "weekly" | "dont" | "project" | "auto";
export type Stack = "morning" | "day" | "evening" | "shutdown";
export type Mark = "y" | "n";

export interface Habit {
  id: string;
  name: string;
  area: string;
  kind: Kind;
  target: number | null;
  stack: Stack;
  status: Status;
  start: string | null;
  grad?: string | null;
  setup: boolean;
}
export interface Metric {
  id: string;
  name: string;
  type: "scale" | "yesno" | "number";
  lo?: string;
  hi?: string;
  unit?: string;
  better: "high" | "low";
}
export interface Checkin {
  m: Record<string, number | null>;
  notes: Record<string, string>;
  locked?: boolean;
}
export interface Settings {
  maxActive: number;
  dailyWindow: number;
  dailyTarget: number;
  weeklyWindow: number;
  weeklyTarget: number;
  pauseWindow: number;
  pauseMin: number;
  gracePer: number;
  birth: string;
  lifeExp: number;
  lightsOut: string;
  wake: string;
  logAll: boolean;
  reminders: { morning: boolean; shutdown: boolean; checkin: boolean; weekly: boolean };
  /** The name of what you're focused on now. Empty means use suggestFocusTitle. */
  focusTitle: string;
}
export interface Points {
  focus: number;
  kept: number;
  tracked: number;
  base: number;
  checkin: number;
  chain: number;
  grad: number;
}
export interface Guess {
  h: string;
  m: string;
  lag: number;
}
export interface State {
  version: 1;
  settings: Settings;
  pts: Points;
  metrics: Metric[];
  noteAreas: string[];
  habits: Habit[];
  logs: Record<string, Record<string, Mark>>;
  checkins: Record<string, Checkin>;
  guesses: Guess[];
  sample: boolean;
}

/* ---------------- dates (YYYY-MM-DD, local) ---------------- */
const pad = (n: number) => String(n).padStart(2, "0");
export const dk = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const pd = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
export const add = (k: string, n: number) => {
  const d = pd(k);
  d.setDate(d.getDate() + n);
  return dk(d);
};
/** Days from a to b (b - a). */
export const diff = (a: string, b: string) => Math.round((pd(b).getTime() - pd(a).getTime()) / 864e5);
/** Monday of the week containing k. */
export const wk = (k: string) => {
  const d = pd(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dk(d);
};

/* ---------------- defaults ---------------- */
export const AREAS = ["Foundation", "Faith", "Marriage", "Finances", "Fitness", "Family & Friends", "Work", "Don't"];
export const DEFAULT_PTS: Points = { focus: 10, kept: 5, tracked: 5, base: 2, checkin: 5, chain: 3, grad: 100 };
export const DEFAULT_SETTINGS: Settings = {
  maxActive: 2, dailyWindow: 21, dailyTarget: 17, weeklyWindow: 4, weeklyTarget: 3, pauseWindow: 7, pauseMin: 5, gracePer: 7,
  birth: "", lifeExp: 75.8, lightsOut: "21:30", wake: "05:30", logAll: true,
  reminders: { morning: true, shutdown: true, checkin: true, weekly: true },
  focusTitle: "",
};
export const METRICS: Metric[] = [
  { id: "mood", name: "Mood", type: "scale", lo: "Rough", hi: "Great", better: "high" },
  { id: "energy", name: "Energy", type: "scale", lo: "Empty", hi: "Full tank", better: "high" },
  { id: "peace", name: "Sense of peace", type: "scale", lo: "Restless", hi: "At peace", better: "high" },
];
export const SUGGESTED_METRICS: Metric[] = [
  { id: "stress", name: "Stress", type: "scale", lo: "Calm", hi: "Maxed out", better: "low" },
  { id: "connect", name: "Connection with my wife", type: "scale", lo: "Distant", hi: "Close", better: "high" },
  { id: "budget", name: "Stayed on budget", type: "yesno", better: "high" },
  { id: "sex", name: "Sex", type: "yesno", better: "high" },
  { id: "atewell", name: "Ate well", type: "yesno", better: "high" },
  { id: "rushed", name: "Rushed morning", type: "yesno", better: "low" },
  { id: "sleep", name: "Hours slept", type: "number", unit: "h", better: "high" },
  { id: "screen", name: "Phone screen time", type: "number", unit: "h", better: "low" },
];

export type PlanRow = [id: string, name: string, area: string, kind: Kind, target: number | null, stack: Stack];
/** A plan to start from. Personal plans are imported as a backup file; only this neutral example ships in the app. */
export interface PlanSpec {
  focus: PlanRow[];
  watching: PlanRow[];
  queue: PlanRow[];
  parked: PlanRow[];
  automated: PlanRow[];
  metrics: Metric[];
  guesses: Guess[];
}
export const DEMO_PLAN: PlanSpec = {
  focus: [["lights", "Lights out on time", "Foundation", "daily", null, "shutdown"], ["alcohol", "No alcohol", "Foundation", "dont", null, "evening"]],
  watching: [["nojunk", "No fast food", "Don't", "dont", null, "day"]],
  queue: [
    ["phone", "Phone charges outside the bedroom", "Foundation", "daily", null, "shutdown"],
    ["wake", "Up early", "Foundation", "daily", null, "morning"],
    ["prayer", "Prayer or meditation, 5 minutes", "Faith", "daily", null, "morning"],
    ["read", "Read 10 pages", "Work", "daily", null, "morning"],
    ["vitamins", "Vitamins + water with coffee", "Fitness", "daily", null, "morning"],
    ["finances", "Log spending and plan the day", "Finances", "daily", null, "morning"],
    ["workout", "Workout", "Fitness", "weekly", 3, "morning"],
    ["date", "Date night", "Marriage", "weekly", 1, "day"],
    ["kids", "1:1 time with the kids", "Family & Friends", "weekly", 2, "evening"],
    ["message", "Message a friend", "Family & Friends", "weekly", 3, "day"],
    ["eatwell", "Log what I eat", "Fitness", "daily", null, "day"],
    ["doomscroll", "No doom scrolling", "Don't", "dont", null, "day"],
  ],
  parked: [["nosoda", "No soda", "Don't", "dont", null, "day"]],
  automated: [["autosave", "Save: automatic transfer", "Finances", "auto", null, "day"]],
  metrics: METRICS,
  guesses: [{ h: "alcohol", m: "energy", lag: 1 }, { h: "prayer", m: "peace", lag: 0 }, { h: "lights", m: "mood", lag: 0 }],
};

export function makeHabit(id: string, name: string, area: string, kind: Kind, o: Partial<Habit> = {}): Habit {
  return { id, name, area, kind, target: o.target ?? null, stack: o.stack ?? "day", status: o.status ?? "queued", start: o.start ?? null, grad: o.grad ?? null, setup: false };
}

/** A new game plan from a spec: the focus items start `today`, nothing logged. */
export function buildPlan(today: string, spec: PlanSpec, settings: Partial<Settings> = {}): State {
  const mk = (r: PlanRow, status: Status, start: string | null) => makeHabit(r[0], r[1], r[2], r[3], { target: r[4], stack: r[5], status, start });
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    pts: { ...DEFAULT_PTS },
    metrics: spec.metrics.map((m) => ({ ...m })),
    noteAreas: ["Faith", "Marriage", "Finances", "Fitness", "Family & Friends", "Work"],
    habits: [
      ...spec.focus.map((r) => mk(r, "building", today)),
      ...spec.watching.map((r) => mk(r, "watching", today)),
      ...spec.queue.map((r) => mk(r, "queued", null)),
      ...spec.parked.map((r) => mk(r, "parked", null)),
      ...spec.automated.map((r) => mk(r, "automated", null)),
    ],
    logs: {},
    checkins: {},
    guesses: spec.guesses.map((g) => ({ ...g })),
    sample: false,
  };
}

/** An empty plan: no habits yet, the default check-in questions. */
export function freshState(today: string): State {
  return buildPlan(today, { focus: [], watching: [], queue: [], parked: [], automated: [], metrics: METRICS, guesses: [] });
}

/** 40 days of made-up history so every screen has something to show. Deterministic. */
export function sampleState(today: string): State {
  const st = buildPlan(add(today, -22), DEMO_PLAN, { birth: "1985-06-01" });
  st.sample = true;
  const prob: Record<string, [number, number]> = {
    phone: [0.25, 0.5], wake: [0.2, 0.5], prayer: [0.3, 0.45], read: [0.2, 0.25], vitamins: [0.5, 0.55], finances: [0.3, 0.3],
    workout: [0.3, 0.4], date: [0.1, 0.12], kids: [0.3, 0.3], message: [0.3, 0.3], eatwell: [0.3, 0.35], doomscroll: [0.35, 0.55],
  };
  let s = 11;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const N = 40, S0 = 18, first = add(today, -N);
  const lightsMiss = [27, 28, 35], drink = [20, 23, 24, 30, 33, 37, 38];
  const days: Record<string, Mark>[] = [];
  for (let i = 0; i < N; i++) {
    const k = add(first, i), dow = pd(k).getDay(), focus = i >= S0, L: Record<string, Mark> = {};
    L.lights = focus ? (lightsMiss.includes(i) ? "n" : "y") : r() < 0.4 ? "y" : "n";
    L.alcohol = focus ? (drink.includes(i) ? "n" : "y") : r() < 0.35 ? "y" : "n";
    if (focus) L.nojunk = i === 26 ? "n" : "y";
    for (const id of Object.keys(prob)) {
      const p = prob[id]![focus ? 1 : 0];
      if (id === "date" && dow !== 5 && dow !== 6) continue;
      const pp = id === "wake" && L.lights === "y" ? p + 0.15 : p;
      L[id] = r() < pp ? "y" : "n";
    }
    days.push(L);
    st.logs[k] = L;
  }
  const notes: Record<number, Record<string, string>> = {
    6: { Marriage: "Good talk after dinner" }, 12: { Finances: "Overspent at Costco" },
    24: { Fitness: "Two beers at the game, slept badly" }, 29: { Faith: "Prayed in the car, short but real" }, 38: { Marriage: "Tense evening, I was tired" },
  };
  for (let i = 0; i < N; i++) {
    const k = add(first, i), L = days[i]!, P = i > 0 ? days[i - 1]! : L;
    const y = (x: Mark | undefined) => (x === "y" ? 1 : 0), no = () => r() - 0.5, cl = (x: number) => Math.max(1, Math.min(10, Math.round(x)));
    st.checkins[k] = {
      m: {
        mood: cl(4.6 + 1.2 * y(L.lights) + 0.8 * y(L.alcohol) + 0.8 * y(L.workout) + 0.6 * y(L.prayer) + no() * 2.6),
        energy: cl(4.2 + 1.0 * y(L.lights) + 1.9 * y(P.alcohol) + 0.6 * y(P.workout) + no() * 2.4),
        peace: cl(3.6 + 2.1 * y(L.prayer) + 1.4 * y(L.read) + 0.5 * y(L.alcohol) + no() * 2.4),
      },
      notes: notes[i] ?? {},
      locked: true,
    };
  }
  return st;
}

/** Fill in anything a saved state from an older version is missing. */
export function normalize(raw: unknown, today: string): State | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<State>;
  if (!Array.isArray(s.habits) || !Array.isArray(s.metrics)) return null;
  const base = freshState(today);
  return {
    version: 1,
    settings: { ...base.settings, ...(s.settings ?? {}), reminders: { ...base.settings.reminders, ...(s.settings?.reminders ?? {}) } },
    pts: { ...base.pts, ...(s.pts ?? {}) },
    metrics: s.metrics,
    noteAreas: Array.isArray(s.noteAreas) ? s.noteAreas : base.noteAreas,
    habits: s.habits.map((h) => ({ ...h, grad: h.grad ?? null, setup: !!h.setup })),
    logs: s.logs ?? {},
    checkins: s.checkins ?? {},
    guesses: Array.isArray(s.guesses) ? s.guesses : [],
    sample: !!s.sample,
  };
}

/* ---------------- habit stats ---------------- */
export const isWeekly = (h: Habit) => h.kind === "weekly" || h.kind === "project";
export const val = (S: State, h: Habit, k: string): Mark | undefined => S.logs[k]?.[h.id];
export const byStatus = (S: State, st: Status) => S.habits.filter((h) => h.status === st);

export type HabitStatus = "locked" | "track" | "risk" | "lost" | "new";
export interface DailyStats { kind: "d"; done: number; days: number; streak: number; graces: string[]; l7: { done: number; days: number }; ready: boolean; status: HabitStatus }
export interface WeeklyStats { kind: "w"; done: number; days: number; streak: number; thisWeek: number; target: number; ready: boolean; status: HabitStatus }
export type Stats = DailyStats | WeeklyStats;

export function dailyStats(S: State, h: Habit, today: string): DailyStats {
  const s = S.settings, st = h.start ?? today;
  const end = val(S, h, today) !== undefined ? today : add(today, -1);
  const win = (len: number) => {
    let done = 0, days = 0;
    for (let i = 0; i < len; i++) { const k = add(end, -i); if (k < st) break; days++; if (val(S, h, k) === "y") done++; }
    return { done, days };
  };
  const W = win(s.dailyWindow), L = win(s.pauseWindow);
  let streak = 0, prevMiss = false, lastGrace: string | null = null;
  const graces: string[] = [];
  for (let k = end; k >= st; k = add(k, -1)) {
    if (val(S, h, k) === "y") { streak++; prevMiss = false; continue; }
    if (h.kind === "dont" || prevMiss) break;
    if (lastGrace && diff(k, lastGrace) < s.gracePer) break;
    lastGrace = k; prevMiss = true; graces.push(k);
  }
  if (prevMiss) graces.pop();
  const misses7 = L.days - L.done, ready = W.days >= s.dailyWindow && W.done >= s.dailyTarget;
  let status: HabitStatus;
  if (W.days === 0) status = "new";
  else if (ready) status = "locked";
  else if (misses7 > s.pauseWindow - s.pauseMin) status = "lost";
  else if (val(S, h, end) !== "y") status = "risk";
  else status = "track";
  return { kind: "d", done: W.done, days: W.days, streak, graces, l7: L, ready, status };
}

export function weekCount(S: State, h: Habit, ws: string, today: string, from?: string | null) {
  let c = 0;
  for (let i = 0; i < 7; i++) { const k = add(ws, i); if (k > today) break; if (from && k < from) continue; if (val(S, h, k) === "y") c++; }
  return c;
}

export function weeklyStats(S: State, h: Habit, today: string): WeeklyStats {
  const s = S.settings, st = h.start ?? today, t = h.target ?? 1, cw = wk(today), sw = wk(st);
  let streak = weekCount(S, h, cw, today, st) >= t ? 1 : 0;
  for (let ws = add(cw, -7); ws >= sw; ws = add(ws, -7)) { if (weekCount(S, h, ws, today, st) >= t) streak++; else break; }
  let hit = 0, wn = 0;
  const rec: boolean[] = [];
  for (let ws = add(cw, -7); ws >= sw && wn < s.weeklyWindow; ws = add(ws, -7)) { wn++; const ok = weekCount(S, h, ws, today, st) >= t; if (ok) hit++; rec.push(ok); }
  const ready = wn >= s.weeklyWindow && hit >= s.weeklyTarget;
  let status: HabitStatus;
  if (wn === 0) status = "new";
  else if (ready) status = "locked";
  else if (rec[0] === false && rec[1] === false) status = "lost";
  else if (rec[0] === false) status = "risk";
  else status = "track";
  return { kind: "w", done: hit, days: wn, streak, thisWeek: weekCount(S, h, cw, today, st), target: t, ready, status };
}

export const stats = (S: State, h: Habit, today: string): Stats => (isWeekly(h) ? weeklyStats(S, h, today) : dailyStats(S, h, today));

export function baselineRate(S: State, h: Habit, today: string) {
  let d = 0, l = 0;
  for (let i = 0; i < 21; i++) { const v = val(S, h, add(today, -i)); if (v) { l++; if (v === "y") d++; } }
  return { done: d, logged: l, rate: l ? d / l : null };
}

export function pauseInfo(S: State, today: string) {
  const lost = byStatus(S, "building").filter((h) => stats(S, h, today).status === "lost");
  return { paused: lost.length > 0, lost };
}

/**
 * The date a habit in focus locks in if every day (or week) from now on goes to plan.
 * Today counts as done unless it is already logged. Null if it can't within a year.
 */
export function lockInDate(S: State, h: Habit, today: string): string | null {
  const s = S.settings, start = h.start ?? today;
  const done = (k: string) => {
    if (k < start) return false;
    const v = val(S, h, k);
    if (k > today || (k === today && v === undefined)) return true;
    return v === "y";
  };
  if (!isWeekly(h)) {
    for (let d = today, i = 0; i < 400; i++, d = add(d, 1)) {
      if (diff(start, d) + 1 < s.dailyWindow) continue;
      let c = 0;
      for (let j = 0; j < s.dailyWindow; j++) if (done(add(d, -j))) c++;
      if (c >= s.dailyTarget) return d;
    }
    return null;
  }
  // Weekly: judged on completed weeks, so it locks in the Monday after the qualifying week.
  const t = h.target ?? 1, cw = wk(today), sw = wk(start);
  const hit = (ws: string) => {
    if (ws >= cw) return true;
    let c = 0;
    for (let i = 0; i < 7; i++) { const k = add(ws, i); if (k < start) continue; if (k > today) c++; else if (val(S, h, k) === "y") c++; }
    return ws === cw || c >= t; // the current week is assumed to go to plan
  };
  for (let we = add(cw, 7), i = 0; i < 60; i++, we = add(we, 7)) {
    const weeks: string[] = [];
    for (let ws = add(we, -7); ws >= sw && weeks.length < s.weeklyWindow; ws = add(ws, -7)) weeks.push(ws);
    if (weeks.length < s.weeklyWindow) continue;
    if (weeks.filter(hit).length >= s.weeklyTarget) return we;
  }
  return null;
}

export interface Slot { h: Habit; start: string; end: string; current: boolean }
/**
 * When everything lands if you stay on course: habits in focus run until they lock in,
 * then each freed slot takes the next item in the queue for its own lock-in window.
 */
export function schedule(S: State, today: string, max: number) {
  const s = S.settings, dur = (h: Habit) => (isWeekly(h) ? s.weeklyWindow * 7 : s.dailyWindow);
  const items: Slot[] = by(S, "building").map((h) => ({ h, start: h.start ?? today, end: lockInDate(S, h, today) ?? add(today, dur(h)), current: true }));
  let slots = items.map((x) => x.end).sort();
  if (slots.length > max) slots = slots.slice(slots.length - max);
  while (slots.length < max) slots.push(today);
  for (const h of by(S, "queued")) {
    let i = 0;
    for (let j = 1; j < slots.length; j++) if (slots[j]! < slots[i]!) i = j;
    const start = slots[i]!, end = add(start, dur(h));
    items.push({ h, start, end, current: false });
    slots[i] = end;
  }
  const last = items.reduce((m, x) => (x.end > m ? x.end : m), today);
  return { items, last };
}
const by = (S: State, st: Status) => S.habits.filter((h) => h.status === st);

/** Estimated start date for every queued item, given `max` habits in focus at once. */
export function project(S: State, today: string, max: number) {
  const sc = schedule(S, today, max), at: Record<string, string> = {};
  let last = today;
  for (const x of sc.items) if (!x.current) { at[x.h.id] = x.start; if (x.start > last) last = x.start; }
  return { at, last };
}

/** Start the next queued habit if there is room (and, unless forced, the queue isn't paused). Mutates a copy. */
export function launchNext(S: State, today: string, force: boolean): { state: State; launched: Habit | null } {
  const q = byStatus(S, "queued");
  if (!q.length || byStatus(S, "building").length >= S.settings.maxActive) return { state: S, launched: null };
  if (!force && pauseInfo(S, today).paused) return { state: S, launched: null };
  const id = q[0]!.id;
  const state: State = { ...S, habits: S.habits.map((h) => (h.id === id ? { ...h, status: "building" as Status, start: today } : h)) };
  return { state, launched: state.habits.find((h) => h.id === id)! };
}

export function life(S: State, today: string) {
  const s = S.settings, b = pd(s.birth), days = (pd(today).getTime() - b.getTime()) / 864e5;
  const lived = Math.floor(days / 7), total = Math.round((s.lifeExp * 365.25) / 7);
  return {
    lived, total, left: Math.max(0, total - lived), age: Math.floor(days / 365.25), ageExact: days / 365.25,
    pct: Math.min(100, (lived / total) * 100), endYear: new Date(b.getTime() + s.lifeExp * 365.25 * 864e5).getFullYear(),
  };
}

export function checkinStreak(S: State, today: string) {
  let k = S.checkins[today]?.locked ? today : add(today, -1), c = 0;
  while (S.checkins[k]?.locked) { c++; k = add(k, -1); }
  return c;
}

export function longestRun(S: State, h: Habit, today: string) {
  if (!h.start) return 0;
  let best = 0, cur = 0;
  for (let k = h.start; k <= today; k = add(k, 1)) {
    if (val(S, h, k) === "y") { cur++; best = Math.max(best, cur); } else if (k < today) cur = 0;
  }
  return best;
}

/* ---------------- scoring ---------------- */
export type Role = "focus" | "kept" | "tracked" | "base";
export function role(h: Habit, k: string): Role | null {
  if (h.kind === "auto" || h.status === "parked") return null;
  if (!h.start || k < h.start) return "base";
  if (h.status === "watching") return "tracked";
  if (h.grad && k >= h.grad) return "kept";
  return "focus";
}
const chain7 = (S: State, h: Habit, k: string) => {
  for (let i = 0; i < 7; i++) if (val(S, h, add(k, -i)) !== "y") return false;
  return true;
};
export function habitPoints(S: State, h: Habit, k: string) {
  const r = role(h, k);
  if (!r) return { pts: 0, worth: 0, role: r };
  const P = S.pts, worth = P[r];
  let pts = 0;
  if (val(S, h, k) === "y") { pts = worth; if (r !== "base" && !isWeekly(h) && chain7(S, h, k)) pts += P.chain; }
  return { pts, worth, role: r };
}
export interface DayScore { pts: number; rating: number | null }
/** Points for one day, and the day rating: core points earned out of core points possible. */
export function dayScore(S: State, k: string): DayScore {
  const P = S.pts;
  let pts = 0, core = 0, poss = 0, any = false;
  for (const h of S.habits) {
    const x = habitPoints(S, h, k);
    if (!x.role) continue;
    const v = val(S, h, k);
    if (v) any = true;
    pts += x.pts;
    if (x.role !== "base") {
      if (!isWeekly(h)) { poss += x.worth; if (v === "y") core += x.worth; }
      else if (v === "y") { poss += x.worth; core += x.worth; }
    }
    if (h.grad === k) pts += P.grad;
  }
  const c = S.checkins[k];
  if (c) any = true;
  poss += P.checkin;
  if (c?.locked) { pts += P.checkin; core += P.checkin; }
  return { pts, rating: any && poss ? Math.min(1, core / poss) : null };
}
export function firstDay(S: State, today: string) {
  const ks = [...Object.keys(S.logs), ...Object.keys(S.checkins)].sort();
  return ks[0] && ks[0] < today ? ks[0] : today;
}
export function scoreSummary(S: State, today: string) {
  const memo: Record<string, DayScore> = {};
  const day = (k: string) => (memo[k] ??= dayScore(S, k));
  const weekPts = (ws: string, upto = 6) => { let t = 0; for (let i = 0; i <= upto; i++) { const k = add(ws, i); if (k > today) break; t += day(k).pts; } return t; };
  const cw = wk(today), idx = diff(cw, today), lw = add(cw, -7), fd = firstDay(S, today);
  let best = 0, bestWs: string | null = null;
  for (let ws = wk(fd); ws < cw; ws = add(ws, 7)) { const p = weekPts(ws); if (p > best) { best = p; bestWs = ws; } }
  let total = 0, bestR = 0, bestRk: string | null = null;
  for (let k = fd; k <= today; k = add(k, 1)) { const d = day(k); total += d.pts; if (d.rating != null && d.rating > bestR && k < today) { bestR = d.rating; bestRk = k; } }
  return {
    thisW: weekPts(cw), lastTD: weekPts(lw, idx), best, bestWs, total,
    level: Math.floor(total / 1000) + 1, lvlPts: total % 1000, bestR, bestRk, cw, lw, idx, day, weekPts,
  };
}

/* ---------------- statistics ---------------- */
function lgamma(x: number) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const ci of c) s += ci / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betacf(a: number, b: number, x: number) {
  const F = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < F) d = F;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function ibeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const variance = (a: number[], m: number) => a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1);
/** Welch's two-sample t-test, two-sided. */
export function welch(A: number[], B: number[]) {
  const n1 = A.length, n2 = B.length, m1 = mean(A), m2 = mean(B), v1 = variance(A, m1), v2 = variance(B, m2), se2 = v1 / n1 + v2 / n2;
  if (se2 <= 0) return { p: m1 === m2 ? 1 : 0, a: m1, b: m2 };
  const t = (m1 - m2) / Math.sqrt(se2), df = (se2 * se2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  return { p: ibeta(df / (df + t * t), df / 2, 0.5), a: m1, b: m2 };
}
const lC = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
/** Fisher's exact test on [[a,b],[c,d]], two-sided. */
export function fisher(a: number, b: number, c: number, d: number) {
  const r1 = a + b, r2 = c + d, c1 = a + c, N = r1 + r2, lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const P = (x: number) => Math.exp(lC(r1, x) + lC(r2, c1 - x) - lC(N, c1)), p0 = P(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) { const q = P(x); if (q <= p0 * (1 + 1e-7)) p += q; }
  return Math.min(1, p);
}

export const MIN_N = 5;
export interface TestResult { h: Habit; m: Metric; lag: number; ny: number; nn: number; ok: boolean; p: number; a: number; b: number; d: number; good: boolean; q?: number }
/** Compare a check-in answer on days the habit was done vs. missed (lag 1 = the next day's answer). */
export function testPair(S: State, h: Habit, m: Metric, lag: number): TestResult {
  const ys: number[] = [], ns: number[] = [];
  for (const k in S.logs) {
    const v = S.logs[k]![h.id];
    if (v !== "y" && v !== "n") continue;
    const x = S.checkins[add(k, lag)]?.m?.[m.id];
    if (x == null) continue;
    (v === "y" ? ys : ns).push(+x);
  }
  const base = { h, m, lag, ny: ys.length, nn: ns.length, ok: false, p: 1, a: 0, b: 0, d: 0, good: false };
  if (ys.length < MIN_N || ns.length < MIN_N) return base;
  let r: { p: number; a: number; b: number };
  if (m.type === "yesno") {
    const a = ys.reduce((x, y) => x + y, 0), c = ns.reduce((x, y) => x + y, 0);
    r = { p: fisher(a, ys.length - a, c, ns.length - c), a: a / ys.length, b: c / ns.length };
  } else r = welch(ys, ns);
  const d = r.a - r.b;
  return { ...base, ok: true, p: r.p, a: r.a, b: r.b, d, good: d > 0 === (m.better !== "low") };
}
/** Test every habit against every question (same day and next day); keep what survives Benjamini–Hochberg at q < .05. */
export function discover(S: State) {
  const res: TestResult[] = [];
  for (const h of S.habits.filter((x) => x.kind !== "auto"))
    for (const m of S.metrics)
      for (const lag of [0, 1]) { const t = testPair(S, h, m, lag); if (t.ok) res.push(t); }
  res.sort((x, y) => x.p - y.p);
  const M = res.length;
  let minq = 1;
  for (let i = M - 1; i >= 0; i--) { minq = Math.min(minq, (res[i]!.p * M) / (i + 1)); res[i]!.q = minq; }
  const seen = new Set<string>(), found: TestResult[] = [];
  for (const t of res) {
    if ((t.q ?? 1) >= 0.05) break;
    const key = t.h.id + "|" + t.m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(t);
  }
  return { found, tests: M };
}

/** Rate before vs. since a date, over logged days only. */
export function rateBetween(S: State, h: Habit, from: string | null, to: string | null) {
  let d = 0, l = 0;
  for (const k in S.logs) {
    if (from && k < from) continue;
    if (to && k >= to) continue;
    const v = S.logs[k]![h.id];
    if (v) { l++; if (v === "y") d++; }
  }
  return { d, l, r: l ? d / l : null };
}

/* ---------------- sync ---------------- */
/**
 * Combine this device's state with the cloud copy when both changed. Nothing logged is lost:
 * day logs and check-ins are unioned (this device wins a clash, a saved check-in beats an unsaved one),
 * habits and questions only on the other side are added. Plan settings come from this device.
 */
export function mergeStates(local: State, remote: State): State {
  const logs: State["logs"] = {};
  for (const k of new Set([...Object.keys(remote.logs), ...Object.keys(local.logs)])) logs[k] = { ...(remote.logs[k] ?? {}), ...(local.logs[k] ?? {}) };
  const checkins: State["checkins"] = { ...remote.checkins };
  for (const [k, c] of Object.entries(local.checkins)) {
    const r = remote.checkins[k];
    checkins[k] = r && r.locked && !c.locked ? r : { m: { ...(r?.m ?? {}), ...c.m }, notes: { ...(r?.notes ?? {}), ...c.notes }, locked: c.locked || r?.locked };
  }
  const ids = new Set(local.habits.map((h) => h.id)), mids = new Set(local.metrics.map((m) => m.id));
  return {
    ...local,
    habits: [...local.habits, ...remote.habits.filter((h) => !ids.has(h.id))],
    metrics: [...local.metrics, ...remote.metrics.filter((m) => !mids.has(m.id))],
    logs,
    checkins,
    sample: local.sample && remote.sample,
  };
}

/** Reminder times from the plan. The text is generic on purpose: it shows on the lock screen. */
export function reminderList(s: Settings) {
  const t = (m: number) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const [lh, lm] = s.lightsOut.split(":").map(Number), lo = lh! * 60 + lm!;
  const all = [
    { id: "morning", time: s.wake, days: null, title: "Morning", body: "Start your morning stack." },
    { id: "checkin", time: t(lo - 45), days: null, title: "Check-in", body: "60 seconds: log today and save your check-in." },
    { id: "shutdown", time: t(lo - 30), days: null, title: "Shutdown", body: "Phone on the charger. Lights out soon." },
    { id: "weekly", time: "16:00", days: [0], title: "Weekly review", body: "See how this week stacks up." },
  ] as const;
  return all.filter((r) => s.reminders[r.id]).map((r) => ({ ...r, days: r.days ? [...r.days] : null }));
}

const AREA_TITLES: Record<string, string> = {
  Foundation: "Build the foundation", Faith: "Put God first", Marriage: "Invest in her", Finances: "Own the money",
  Fitness: "Get strong", "Family & Friends": "Show up for them", Work: "Level up at work", "Don't": "Cut what holds you back",
};
/** A starting name for the current focus, from the areas of the habits in focus. */
export function suggestFocusTitle(S: State) {
  const b = byStatus(S, "building");
  if (!b.length) return "Pick your first focus";
  const count: Record<string, number> = {};
  for (const h of b) count[h.area] = (count[h.area] ?? 0) + 1;
  const top = Object.entries(count).sort((x, y) => y[1] - x[1] || b.findIndex((h) => h.area === x[0]) - b.findIndex((h) => h.area === y[0]))[0]![0];
  return AREA_TITLES[top] ?? `Focus: ${top}`;
}
export const focusTitle = (S: State) => S.settings.focusTitle.trim() || suggestFocusTitle(S);
