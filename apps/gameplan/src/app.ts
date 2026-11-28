import {
  AREAS, SUGGESTED_METRICS, add, baselineRate, byStatus, checkinStreak, diff, discover, dk, freshState, habitPoints, isWeekly,
  launchNext, life, longestRun, makeHabit, mean, MIN_N, normalize, pauseInfo, pd, project, rateBetween, sampleState, scoreSummary,
  stats, testPair, val, weekCount, wk,
  type Checkin, type Habit, type Kind, type Metric, type Stack, type State, type Stats, type Status, type TestResult,
} from "./logic";
import { reminderList, focusTitle, suggestFocusTitle, lockInDate, schedule } from "./logic";
import * as cloud from "./cloud";
import * as lock from "./lock";

const KEY = "gameplan:v1";
const KINDS: Record<Kind, string> = { daily: "Daily habit", weekly: "Weekly rhythm", dont: "Don't", project: "Project block", auto: "Automate once" };
const STATUSES: Record<Status, string> = { building: "In focus", queued: "Up next", maintaining: "Locked in", watching: "Tracked from day one", parked: "Parked (add later)", automated: "Automate once" };
const STACKS: Record<Stack, string> = { morning: "Morning", day: "Daytime", evening: "Evening", shutdown: "Shutdown" };
const MTYPES: Record<Metric["type"], string> = { scale: "Slider 1–10", yesno: "Yes / no", number: "Number" };
const STLABEL = { locked: "Locked in", track: "On track", risk: "At risk", lost: "Lost ground", new: "Day 1" } as const;
const I = {
  l: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5l-5 5 5 5"/></svg>',
  r: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 5l5 5-5 5"/></svg>',
  u: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12l5-5 5 5"/></svg>',
  d: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8l5 5 5-5"/></svg>',
};

/* ---------- format helpers ---------- */
const pad = (x: number) => String(x).padStart(2, "0");
const fmt = (k: string) => pd(k).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtM = (k: string) => pd(k).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const tmin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const tfmt = (m: number) => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12) + 1 + ":" + pad(mm) + (h < 12 ? " AM" : " PM"); };
const n = (x: number) => Math.round(x).toLocaleString();
const pct = (x: number) => Math.round(x * 100) + "%";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const uid = (p: string) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- state ---------- */
let TODAY = dk(new Date());
let S: State = load();
let sum = scoreSummary(S, TODAY);

interface Sheet { type: "habit" | "metrics" | "metric" | "code" | "pin" | "focus" | "faceoffer"; id?: string | null }
const auth = { email: "", sent: false, busy: false, mode: "password" as "password" | "setup" | "code" };
const pinUi = { entry: "", first: "", step: "new" as "new" | "confirm", error: "", forgot: false };
let remindersEnabled = false;
const ui: { view: string; grid: boolean; sched: boolean; sheet: Sheet | null; confirmReset: string | null; confirmDel: boolean; trend: string } =
  { view: TODAY, grid: false, sched: false, sheet: null, confirmReset: null, confirmDel: false, trend: "mood" };

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = normalize(JSON.parse(raw), TODAY); if (s) return s; }
  } catch { /* storage blocked or corrupt: start fresh */ }
  return freshState(TODAY);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast("Couldn't save on this device. Export a backup in Settings."); } cloud.markDirty(); }

const HB = (id: string) => S.habits.find((h) => h.id === id);
const MT = (id: string) => S.metrics.find((m) => m.id === id);
const st = (h: Habit) => stats(S, h, TODAY);
const by = (s: Status) => byStatus(S, s);
const focusSet = () => S.habits.filter((h) => ["building", "maintaining", "watching"].includes(h.status));
const yLab = (h: Habit): [string, string] => (h.kind === "dont" ? ["Clean", "Setback"] : ["Did it", "Didn’t"]);
const ck = (k: string): Checkin => { const c = (S.checkins[k] ??= { m: {}, notes: {} }); c.m ??= {}; c.notes ??= {}; return c; };

/* ---------- components ---------- */
function metaHtml(h: Habit, s: Stats) {
  const lab = s.status === "new" ? (isWeekly(h) ? "Week 1" : "Day 1") : STLABEL[s.status];
  const tag = `<span class="${s.status}">${lab}</span>`;
  if (s.kind === "w") return `${tag} · ${s.thisWeek}/${s.target} this week · ${s.done}/${s.days} wk`;
  return `${tag} · ${s.done}/${s.days} of last ${S.settings.dailyWindow}${s.graces.length ? " · grace day used" : ""}`;
}
function chainTxt(h: Habit, s: Stats | null) {
  if (!s || !s.streak) return "";
  if (s.kind === "w") return `${s.streak} wk chain`;
  return h.kind === "dont" ? `${s.streak} clean` : `${s.streak} day chain`;
}
function strip(h: Habit, s: Stats | null, base: boolean) {
  if (isWeekly(h)) {
    let o = "";
    const cw = wk(TODAY), t = h.target ?? 1;
    for (let i = 7; i >= 0; i--) {
      const ws = add(cw, -7 * i), pre = !base && !!h.start && ws < wk(h.start);
      const c = pre ? 0 : weekCount(S, h, ws, TODAY, base ? null : h.start), miss = !pre && i > 0 && c < t;
      o += `<i class="${miss ? "miss" : ""}" title="Week of ${fmt(ws)}: ${c}/${t}"${pre ? ' style="background:transparent"' : ""}><b style="height:${pre ? 0 : Math.max(miss ? 20 : 0, Math.min(1, c / t) * 100)}%"></b></i>`;
    }
    return `<div class="wstrip">${o}</div>`;
  }
  let o = "";
  for (let i = 20; i >= 0; i--) {
    const k = add(TODAY, -i), v = val(S, h, k);
    let c: string;
    if (!base && h.start && k < h.start) c = "pre";
    else if (v === "y") c = "y";
    else if (v === "n") c = s && s.kind === "d" && s.graces.includes(k) ? "g" : "n";
    else c = k === TODAY ? "t" : "";
    o += `<i class="${c}" title="${fmt(k)}"></i>`;
  }
  return `<div class="strip${base ? " base" : ""}">${o}</div>`;
}
function baselineTxt(h: Habit) {
  if (isWeekly(h)) return `${weekCount(S, h, wk(TODAY), TODAY)}/${h.target ?? 1} this week`;
  const b = baselineRate(S, h, TODAY);
  return b.logged ? `Baseline ${b.done}/${b.logged} logged days` : "No baseline yet";
}
function row(h: Habit, k: string, base = false) {
  const v = val(S, h, k), s = base ? null : st(h), x = habitPoints(S, h, k);
  const [a, b] = h.kind === "dont" ? ["Clean", "Setback"] : isWeekly(h) ? ["Done", null] : ["Done", "Miss"];
  const pts = v === "y" ? `<span class="pts">+${x.pts} pts</span>` : `worth +${x.worth}`;
  const m = base || !s ? `${baselineTxt(h)} · ${pts}` : `${metaHtml(h, s)} · ${pts}${h.status === "maintaining" ? " · maintaining" : h.status === "watching" ? " · tracked" : ""}`;
  const ch = chainTxt(h, s);
  return `<div class="h${base ? " base" : ""}" id="r-${h.id}"><div style="min-width:0"><button class="hn" data-act="edit" data-id="${h.id}">${esc(h.name)}</button>${ch ? `<span class="chain">${ch}</span>` : ""}
    <div class="hm">${m}</div>${strip(h, s, base)}</div>
    <div class="btns"><button class="b y" data-act="log" data-id="${h.id}" data-v="y" aria-pressed="${v === "y"}">${a}</button>${b ? `<button class="b n" data-act="log" data-id="${h.id}" data-v="n" aria-pressed="${v === "n"}">${b}</button>` : ""}</div></div>`;
}
function board() {
  const d = sum.thisW - sum.lastTD, days = ["M", "T", "W", "T", "F", "S", "S"];
  const vals = days.map((_, i) => { const k = add(sum.cw, i); return k <= TODAY ? sum.day(k).pts : null; });
  const last = days.map((_, i) => sum.day(add(sum.lw, i)).pts);
  const mx = Math.max(10, ...vals.filter((v): v is number => v != null), ...last);
  const bars = days.map((dd, i) => {
    const v = vals[i] ?? null, h = ((v ?? last[i]!) / mx) * 100, cls = v == null ? "ghost" : i === sum.idx ? "today" : "";
    return `<div><div class="col" title="${v != null ? v + " pts" : "Last week: " + last[i] + " pts"}"><i class="${cls}" style="height:${Math.max(4, h)}%"></i>${v != null ? `<span class="lw" style="bottom:calc(${(last[i]! / mx) * 100}% - 1px)"></span>` : ""}</div><span class="${i === sum.idx ? "on" : ""}">${dd}</span></div>`;
  }).join("");
  const td = sum.day(TODAY);
  if (!sum.best && !last.some(Boolean))
    return `<section class="card board" aria-label="Weekly score"><div class="board-top"><div><div class="cap">This week</div><div class="huge" style="font-size:56px">${n(sum.thisW)}<small>pts</small></div></div>
      <div class="vs"><span class="cap">First week</span><span class="muted" style="font-size:12.5px;max-width:22ch">Next week you'll race this one.</span></div></div>
      <div class="board-foot"><span>Today <b>${n(td.pts)} pts</b>${td.rating != null ? ` · rating <b>${pct(td.rating)}</b>` : ""}</span><span class="lvl">Level <b>${sum.level}</b><span class="t"><i style="width:${sum.lvlPts / 10}%"></i></span>${n(sum.lvlPts)}/1,000</span></div></section>`;
  return `<section class="card board" aria-label="Weekly score">
    <div class="board-top"><div><div class="cap">This week</div><div class="huge">${n(sum.thisW)}<small>pts</small></div></div>
      <div class="vs"><span class="cap">vs last week, same day</span><b class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : "−"}${n(Math.abs(d))}</b><span class="cap">Best week ${n(sum.best)}</span></div></div>
    <div class="bars">${bars}</div>
    ${paceText()}
    <div class="board-foot"><span>Bars: this week · line: last week · dashed: last week's days still ahead</span></div>
    <div class="board-foot"><span>Today <b>${n(td.pts)} pts</b>${td.rating != null ? ` · rating <b>${pct(td.rating)}</b>` : ""}</span><span class="lvl">Level <b>${sum.level}</b><span class="t"><i style="width:${sum.lvlPts / 10}%"></i></span>${n(sum.lvlPts)}/1,000</span></div>
  </section>`;
}
/** Plain words: how the current focus block is going and when it finishes if you stay on course. */
function paceText() {
  const b = by("building");
  if (!b.length) return "";
  const s = S.settings, need = s.dailyTarget / s.dailyWindow;
  const parts: string[] = [], behind: string[] = [];
  let finish = TODAY, stuck = false;
  for (const h of b) {
    const x = st(h), when = lockInDate(S, h, TODAY);
    if (!when) stuck = true; else if (when > finish) finish = when;
    if (x.kind === "d") {
      const ok = x.l7.days === 0 || x.l7.done / x.l7.days >= need;
      parts.push(`${esc(h.name)} ${x.l7.done} of ${x.l7.days || 0}`);
      if (!ok) behind.push(esc(h.name));
    } else {
      parts.push(`${esc(h.name)} ${x.thisWeek} of ${x.target} this week`);
      if (x.status === "risk" || x.status === "lost") behind.push(esc(h.name));
    }
  }
  const days = diff(TODAY, finish);
  const status = behind.length ? `Behind on ${behind.join(" and ")}. Get back to ${s.pauseMin} of ${s.pauseWindow} days.` : "You're on pace.";
  const end = stuck ? "Stay on course and the dates will show here." : finish === TODAY ? "Everything in this block is ready to lock in today." : `Stay on course and the whole block locks in <b>${pd(finish).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>, ${days} ${days === 1 ? "day" : "days"} from now.`;
  return `<div class="pace"><p><b>${esc(focusTitle(S))}:</b> ${status} Last 7 days: ${parts.join(", ")}.</p><p>${end}</p></div>`;
}

function clock() {
  if (!S.settings.birth) return `<section class="card clock" aria-label="Life clock"><div class="cap">Life clock</div>
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Add your birth date to see how many weeks you have left. It stays on this phone.</p>
    <div class="set" style="padding:0;border:0"><label for="set-birth">Birth date</label><input id="set-birth" type="date" data-set="birth"></div></section>`;
  const L = life(S, TODAY), yrs = Math.ceil(S.settings.lifeExp), cur = Math.floor(L.ageExact);
  let cells = "";
  for (let y = 0; y < yrs; y++) cells += `<i class="${y < cur ? "l" : y === cur ? "c" : ""}"></i>`;
  return `<section class="card clock" aria-label="Life clock">
    <div class="clock-top"><div><div class="cap">Weeks left</div><b>${n(L.left)}</b></div><div class="years" role="img" aria-label="One square per year of life: ${cur} lived">${cells}</div></div>
    <div class="clock-foot"><span>Age ${L.age} · week ${n(L.lived)} of ${n(L.total)} · to ${S.settings.lifeExp}</span><button class="link" data-act="grid">${ui.grid ? "Hide weeks" : "Every week"}</button></div>
    ${ui.grid ? '<canvas id="grid" aria-label="One square per week of life"></canvas>' : ""}</section>`;
}
function drawGrid() {
  const c = document.getElementById("grid") as HTMLCanvasElement | null;
  if (!c) return;
  const L = life(S, TODAY), cs = getComputedStyle(document.documentElement), col = (v: string) => cs.getPropertyValue(v).trim();
  const rows = Math.ceil(S.settings.lifeExp), cols = 52, w = c.clientWidth, cell = w / cols, h = Math.ceil(rows * cell), dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + "px";
  const x = c.getContext("2d")!;
  x.scale(dpr, dpr);
  for (let i = 0; i < rows * cols && i < L.total; i++) {
    const r = Math.floor(i / cols), q = i % cols;
    x.fillStyle = i < L.lived ? col("--s3") : i === L.lived ? col("--ink") : col("--acc");
    x.fillRect(q * cell + 0.6, r * cell + 0.6, cell - 1.8, cell - 1.8);
  }
}
function notices() {
  const s = S.settings, b = by("building"), q = by("queued"), P = pauseInfo(S, TODAY);
  let o = "";
  for (const h of b) {
    const x = st(h);
    if (x.ready) o += `<div class="notice good"><p><b>${esc(h.name)}</b> hit ${x.done} of ${x.days} ${x.kind === "w" ? "weeks" : "days"}. Locked in. Graduate it for +${S.pts.grad}.</p><button class="btn sm" data-act="graduate" data-id="${h.id}">Graduate</button></div>`;
  }
  const open = b.length < s.maxActive && q.length > 0;
  if (P.paused) {
    const h = P.lost[0]!, x = st(h);
    o += `<div class="notice warn"><p>Queue paused. <b>${esc(h.name)}</b> is at ${x.kind === "w" ? "two missed weeks" : `${x.l7.done} of the last ${x.l7.days} days`}. Back to ${s.pauseMin} of ${s.pauseWindow} and the next habit launches.</p>${open ? `<button class="btn sm ghost" data-act="launch" data-force="1">Launch anyway</button>` : ""}</div>`;
  } else if (open) o += `<div class="notice info"><p>A slot is open. Next up: <b>${esc(q[0]!.name)}</b>.</p><button class="btn sm" data-act="launch">Start today</button></div>`;
  return o;
}
function installHint() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone || window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) return "";
  const phone = /iPhone|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && window.innerWidth < 900);
  if (!phone) return "";
  let dismissed = false;
  try { dismissed = localStorage.getItem("gameplan:hide-install") === "1"; } catch { /* ignore */ }
  if (dismissed) return "";
  return `<div class="install"><b>Put it on your home screen.</b> In Safari, tap Share, then <b>Add to Home Screen</b>. It opens full screen and works offline. <button class="link" data-act="hideinstall">Hide</button></div>`;
}

function lockHint() {
  if (lock.lockCfg()) return "";
  try { if (localStorage.getItem("gameplan:hide-lockhint") === "1") return ""; } catch { /* ignore */ }
  return `<div class="notice info"><p><b>Lock Game Plan.</b> Ask for Face ID or a passcode every time it opens, so your plan stays private.</p><div class="backup"><button class="btn sm" data-act="pinset">Set it up</button><button class="btn sm ghost" data-act="hidelockhint">Not now</button></div></div>`;
}

function focusCard() {
  const b = by("building");
  const start = b.map((h) => h.start!).sort()[0];
  const day = start ? diff(start, TODAY) + 1 : 0;
  const pen = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>';
  const tick = '<svg viewBox="0 0 20 20" fill="none" stroke="#06130D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10.5l3.2 3.2L15 7"/></svg>';
  const items = b.map((h) => {
    const v = val(S, h, TODAY), x = st(h);
    const need = x.kind === "w" ? S.settings.weeklyTarget : S.settings.dailyTarget;
    const prog = x.kind === "w" ? `${x.done}/${need} weeks` : `${x.done}/${need} days`;
    return `<div><div class="fitem"><span class="ck ${v ?? ""}">${v === "y" ? tick : ""}</span><b>${esc(h.name)}</b><small>${prog} to lock in</small></div><div class="fbar"><i style="width:${Math.min(100, (x.done / need) * 100)}%"></i></div></div>`;
  }).join("");
  return `<section class="focus" aria-label="Current focus"><div class="cap">Focus right now${day ? ` · day ${day}` : ""}</div>
    <button class="ftitle" data-act="focusedit" aria-label="Rename your focus">${esc(focusTitle(S))}${pen}</button>
    ${items ? `<div class="fitems">${items}</div>` : `<p class="lede" style="padding:0">Start a habit from the Plan tab and it shows up here.</p>`}</section>`;
}

function welcome() {
  return `<section class="card pad" style="display:flex;flex-direction:column;gap:14px">
    <div class="cap">Welcome</div>
    <h2 style="font-stretch:75%;font-weight:800;font-size:28px;text-transform:uppercase;line-height:1">Set up your game plan</h2>
    <p style="margin:0;color:var(--ink2);font-size:14px">If you have a plan code or file, load it. It sets your habits, queue order, check-in questions and birth date. You can also look around with example data, or build your plan from scratch on the Plan tab.</p>
    <div class="backup"><button class="btn" data-act="pastecode">Paste my plan code</button><button class="btn ghost" data-act="import">Load a plan file</button><button class="btn ghost" data-act="reset" data-v="sample-now">Try example data</button><a class="btn ghost" href="#plan" style="text-decoration:none">Start from scratch</a></div>
    <input type="file" accept="application/json,.json" id="importfile" class="filein" tabindex="-1" aria-hidden="true"></section>
    ${cloud.cloudAvailable ? `<section class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="cap">Already using Game Plan on your phone?</div>
      <p style="margin:0;color:var(--ink2);font-size:14px">Sign in with the same email to bring your plan here. Turn on sync on your phone first (Settings → Sync) so there's something to bring over.</p>
      ${cloud.syncInfo().email ? `<p style="margin:0;font-size:13.5px">Signed in as <b>${esc(cloud.syncInfo().email)}</b>. Nothing synced yet.</p><div class="backup"><button class="btn sm" data-act="syncnow">Sync now</button><button class="btn sm ghost" data-act="signout">Sign out</button></div>` : signInForm()}</section>` : ""}`;
}

/* ---------- views ---------- */
function vToday() {
  const k = ui.view, s = S.settings, c = S.checkins[k] ?? { m: {}, notes: {} };
  const rank = (h: Habit) => (h.status === "building" ? 0 : h.status === "watching" ? 1 : 2);
  const focus = focusSet().sort((a, b) => rank(a) - rank(b));
  const doHabits = focus.filter((h) => h.kind !== "dont"), avoids = focus.filter((h) => h.kind === "dont");
  let groups = "";
  if (doHabits.length) groups += `<div class="gh"><h3>Habits</h3><span>${doHabits.length}</span></div>${doHabits.map((h) => row(h, k)).join("")}`;
  if (avoids.length) groups += `<div class="gh"><h3>Avoid</h3><span>${avoids.length}</span></div>${avoids.map((h) => row(h, k)).join("")}`;
  if (!groups) groups = `<div class="card pad muted">Nothing in focus yet. Start the first habit on the Plan tab.</div>`;
  let rest = "";
  if (s.logAll) {
    const q = by("queued"), qh = q.filter((h) => h.kind !== "dont"), qa = q.filter((h) => h.kind === "dont");
    if (qh.length) rest += `<div class="gh"><h3>Habits</h3><span>+${S.pts.base} each</span></div>${qh.map((h) => row(h, k, true)).join("")}`;
    if (qa.length) rest += `<div class="gh"><h3>Avoid</h3><span>+${S.pts.base} each</span></div>${qa.map((h) => row(h, k, true)).join("")}`;
    rest = `<section><div class="sh"><h2>Not in focus yet</h2><span class="t">Builds your baseline</span></div><p class="lede">Log these if you did them. They don't move the queue. Insights uses them to show how focus changes each habit.</p>${rest}</section>`;
  }
  const mv = c.m ?? {};
  const q = (m: Metric) => {
    const v = mv[m.id];
    if (m.type === "scale") {
      const set = v != null, p = set ? ((v - 1) / 9) * 100 : 50;
      return `<div class="mq"><span class="ql">${esc(m.name)}<small>1 ${esc(m.lo)} · 10 ${esc(m.hi)}</small></span><input type="range" min="1" max="10" step="1" id="m-${m.id}" data-metric="${m.id}" value="${set ? v : 5.5}" class="${set ? "" : "unset"}" style="--p:${set ? p : 0}%" aria-label="${esc(m.name)}"><span class="qv ${set ? "" : "unset"}" id="qv-${m.id}">${set ? v : "–"}</span></div>`;
    }
    if (m.type === "yesno") return `<div class="mq"><span class="ql">${esc(m.name)}</span><div class="yn"><button class="b y" data-act="mset" data-id="${m.id}" data-v="1" aria-pressed="${v === 1}">Yes</button><button class="b n" data-act="mset" data-id="${m.id}" data-v="0" aria-pressed="${v === 0}">No</button></div></div>`;
    return `<div class="mq"><span class="ql">${esc(m.name)}</span><div class="numin"><input type="number" step="0.25" inputmode="decimal" id="m-${m.id}" data-metric="${m.id}" value="${v ?? ""}" aria-label="${esc(m.name)}"><span>${esc(m.unit)}</span></div></div>`;
  };
  const answered = S.metrics.filter((m) => mv[m.id] != null).length;
  const ci = c.locked
    ? `<div class="card done"><div class="dv">${S.metrics.filter((m) => m.type === "scale").slice(0, 3).map((m) => `<div><b>${mv[m.id] ?? "–"}</b><span>${esc(m.name)}</span></div>`).join("")}</div><div style="display:flex;gap:10px;align-items:center"><span class="muted" style="font-size:12.5px">Saved · +${S.pts.checkin} pts</span><button class="btn sm ghost" data-act="unlock">Edit</button></div></div>`
    : `<div class="card"><div class="ci">${S.metrics.map(q).join("")}
    <details class="notes"${Object.values(c.notes ?? {}).some(Boolean) ? " open" : ""}><summary>Notes by area</summary><div class="notes-grid">${S.noteAreas.map((a, i) => `<label>${esc(a)}<input type="text" id="note-${i}" data-note="${esc(a)}" value="${esc(c.notes?.[a] ?? "")}" placeholder="What happened"></label>`).join("")}</div></details></div>
    <div class="ci-foot"><button class="link" data-act="metrics">Edit questions</button><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><button class="btn" data-act="lock">Save check-in</button><span class="muted" style="font-size:11.5px">Earns +${S.pts.checkin} pts</span></div></div></div>`;
  const ago = diff(k, TODAY), ds = sum.day(k);
  if (!S.habits.length) return `${installHint()}${welcome()}`;
  return `${installHint()}${lockHint()}<div id="focuswrap">${focusCard()}</div><div id="boardwrap">${board()}</div>${clock()}<div id="noticewrap" style="display:contents">${notices()}</div>
  <div class="dayrow"><div><div class="sub">${ago === 0 ? "Today" : ago === 1 ? "Yesterday" : ago + " days ago"}</div><h2>${pd(k).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h2></div>
    <div class="arrows"><button class="ib" data-act="prev" aria-label="Previous day" ${ago >= 6 ? "disabled" : ""}>${I.l}</button><button class="ib" data-act="next" aria-label="Next day" ${ago === 0 ? "disabled" : ""}>${I.r}</button></div></div>
  <div class="tabs"><div class="tl"><button data-act="logall" data-v="0" aria-pressed="${!s.logAll}">In focus</button><button data-act="logall" data-v="1" aria-pressed="${!!s.logAll}">Everything</button></div>
    <span class="today-pts" id="todaypts"><b>${n(ds.pts)}</b> pts${ago === 0 ? " today" : ""}</span></div>
  <section>${groups}</section>
  ${rest}
  <section><div class="sh"><h2>Check-in</h2><span class="t">${tfmt(tmin(s.lightsOut) - 45)}</span></div>${ci}</section>
  ${S.sample ? `<p class="foot">Showing example history. Start fresh in Settings.</p>` : ""}`;
}

function vPlan() {
  const s = S.settings, b = by("building"), q = by("queued"), pj = project(S, TODAY, s.maxActive), pj2 = project(S, TODAY, s.maxActive + 1), pjm = s.maxActive > 1 ? project(S, TODAY, s.maxActive - 1) : null;
  const two = (h: Habit, right = "") => { const x = st(h), ct = chainTxt(h, x); return `<li class="li two"><div><button class="hn" data-act="edit" data-id="${h.id}">${esc(h.name)}</button>${ct ? `<span class="chain">${ct}</span>` : ""}<div class="hm">${metaHtml(h, x)}</div></div>${right}</li>`; };
  return `
  <div class="card"><div class="ctl"><div><h3>Habits in focus at once</h3><p>Locked-in and tracked-from-day-one items don't count toward this.</p></div>
    <div class="stepper"><button class="ib" data-act="max" data-v="-1" aria-label="Fewer">−</button><span class="v num">${s.maxActive}</span><button class="ib" data-act="max" data-v="1" aria-label="More">+</button></div></div>
    <div class="forecast"><span>Whole queue in focus by <b>~${fmtM(pj.last)}</b></span>${pjm ? `<span>${s.maxActive - 1} at once: ~${fmtM(pjm.last)}</span>` : ""}<span>${s.maxActive + 1} at once: ~${fmtM(pj2.last)}</span></div></div>
  ${notices()}
  <section><div class="sh"><h2>In focus</h2><span class="t num">${b.length} of ${s.maxActive}</span></div>
    ${b.length ? `<ul class="card list">${b.map((h) => two(h, `<span class="muted" style="font-size:12px">since ${fmt(h.start!)}</span>`)).join("")}</ul>` : `<div class="card pad muted">Nothing in focus. Start the first item below.</div>`}</section>
  <section><div class="sh"><h2>Up next</h2><span style="display:flex;gap:14px;align-items:baseline"><span class="t">${q.length} in order</span><button class="link" data-act="sched">${ui.sched ? "Hide schedule" : "Schedule"}</button></span></div>
    ${ui.sched ? scheduleView() : ""}
    <ol class="card list">${q.map((h, i) => { const bl = baselineRate(S, h, TODAY); return `<li class="li"><span class="n">${i + 1}</span><div><button class="hn" data-act="edit" data-id="${h.id}">${esc(h.name)}</button><div class="sub">${esc(h.area)} · ${KINDS[h.kind]}${h.target ? ` · ${h.target}×/wk` : ""}${!isWeekly(h) && bl.rate != null ? ` · now ${pct(bl.rate)}` : ""}</div></div>
      <div class="when">~${fmt(pj.at[h.id]!)}<small>est. start</small></div><div class="mv"><button class="ib" data-act="move" data-id="${h.id}" data-v="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${I.u}</button><button class="ib" data-act="move" data-id="${h.id}" data-v="1" aria-label="Move down" ${i === q.length - 1 ? "disabled" : ""}>${I.d}</button></div></li>`; }).join("")}</ol>
    <button class="btn ghost" data-act="add" style="align-self:flex-start">Add a habit</button></section>
  <section><div class="sh"><h2>Tracked from day one</h2><span class="t">Outside the queue · +${S.pts.tracked}/day</span></div>
    ${by("watching").length ? `<ul class="card list">${by("watching").map((h) => two(h, `<button class="btn sm ghost" data-act="park" data-id="${h.id}">Park</button>`)).join("")}</ul>` : '<div class="card pad muted">None.</div>'}</section>
  <section><div class="sh"><h2>Parked</h2><span class="t">Add in later</span></div>
    ${by("parked").length ? `<ul class="card list">${by("parked").map((h) => `<li class="li two"><div><button class="hn" data-act="edit" data-id="${h.id}">${esc(h.name)}</button><div class="sub">${esc(h.area)} · ${KINDS[h.kind]}</div></div><div class="pbtns"><button class="btn sm ghost" data-act="unpark" data-id="${h.id}" data-v="watching">Track now</button><button class="btn sm ghost" data-act="unpark" data-id="${h.id}" data-v="queued">Add to queue</button></div></li>`).join("")}</ul>` : '<div class="card pad muted">Nothing parked. Park any item from its edit screen.</div>'}</section>
  <section><div class="sh"><h2>Locked in</h2><span class="t">Maintenance · +${S.pts.kept}/day</span></div>
    ${by("maintaining").length ? `<ul class="card list">${by("maintaining").map((h) => two(h)).join("")}</ul>` : '<div class="card pad muted">Your first graduate lands here and stays on the check-in.</div>'}</section>
  <section><div class="sh"><h2>Automate once</h2><span class="t">Set up, then forget</span></div>
    <ul class="card list">${by("automated").map((h) => `<li class="li two"><div><button class="hn" data-act="edit" data-id="${h.id}">${esc(h.name)}</button><div class="sub">${esc(h.area)}</div></div><button class="b y" data-act="setup" data-id="${h.id}" aria-pressed="${h.setup}">${h.setup ? "Set up" : "Not yet"}</button></li>`).join("")}</ul></section>`;
}

const AREA_COLORS: Record<string, string> = {
  Foundation: "#F5B700", Faith: "#A78BFA", Marriage: "#F472B6", Finances: "#34D399",
  Fitness: "#FB923C", "Family & Friends": "#60A5FA", Work: "#94A3B8", "Don't": "#F87171",
};
const areaColor = (a: string) => AREA_COLORS[a] ?? "#C5CCD6";
/** Weeks as cells, one row per month. Each cell has a stripe for every habit in focus that week. */
function scheduleView() {
  const sc = schedule(S, TODAY, S.settings.maxActive);
  const rows: { key: string; label: string; weeks: string[] }[] = [];
  for (let ws = wk(TODAY); ws <= wk(sc.last); ws = add(ws, 7)) {
    const d = pd(ws), key = `${d.getFullYear()}-${d.getMonth()}`;
    if (rows[rows.length - 1]?.key !== key) {
      const yr = !rows.length || d.getMonth() === 0 ? ` '${String(d.getFullYear()).slice(2)}` : "";
      rows.push({ key, label: d.toLocaleDateString(undefined, { month: "short" }) + yr, weeks: [] });
    }
    rows[rows.length - 1]!.weeks.push(ws);
  }
  const active = (ws: string) => sc.items.filter((x) => x.start <= add(ws, 6) && x.end > ws);
  const grid = rows.map((r) => `<div class="srow"><span class="smon">${r.label}</span><div class="swk">${r.weeks.map((ws) => {
    const a = active(ws);
    return `<button class="scell${ws === wk(TODAY) ? " now" : ""}" data-act="weekinfo" data-v="${ws}" aria-label="Week of ${fmt(ws)}: ${esc(a.map((x) => x.h.name).join(", ") || "nothing")}">${a.map((x) => `<i style="background:${areaColor(x.h.area)}"></i>`).join("")}</button>`;
  }).join("")}</div></div>`).join("");
  const areas = [...new Set(sc.items.map((x) => x.h.area))];
  const starts: Record<string, typeof sc.items> = {};
  for (const x of sc.items) { const m = fmtM(x.start); (starts[m] ??= []).push(x); }
  return `<div class="card pad sched">
    <p class="lede" style="padding:0">If every habit locks in on schedule. Each square is a week; each stripe is a habit in focus that week. Tap a week to see which.</p>
    ${grid}
    <div class="slegend">${areas.map((a) => `<span><i style="background:${areaColor(a)}"></i>${esc(a)}</span>`).join("")}</div>
    <div class="sstarts">${Object.entries(starts).map(([m, xs]) => `<div><div class="cap">${m}</div>${xs.map((x) => `<div class="sitem"><i style="background:${areaColor(x.h.area)}"></i><span>${esc(x.h.name)}</span><small>${x.current ? `locks in ~${fmt(x.end)}` : `starts ~${fmt(x.start)}`}</small></div>`).join("")}</div>`).join("")}</div>
  </div>`;
}

function spark(h: Habit, startK: string) {
  const N = 60, pts: [number, number][] = [];
  for (let i = N - 1; i >= 0; i--) {
    const k = add(TODAY, -i);
    let d = 0, l = 0;
    for (let j = 0; j < 7; j++) { const v = val(S, h, add(k, -j)); if (v) { l++; if (v === "y") d++; } }
    if (l >= 3) pts.push([N - 1 - i, d / l]);
  }
  if (pts.length < 2) return '<svg viewBox="0 0 120 30"></svg>';
  const x = (i: number) => (i / (N - 1)) * 118 + 1, y = (v: number) => 27 - v * 24, mk = diff(startK, TODAY) < N ? x(N - 1 - diff(startK, TODAY)) : null;
  return `<svg viewBox="0 0 120 30" aria-hidden="true">${mk != null ? `<line x1="${mk}" x2="${mk}" y1="1" y2="29" stroke="var(--acc)" stroke-width="1.2" stroke-dasharray="2 2"/>` : ""}<path d="${pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ")}" fill="none" stroke="var(--ink2)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function focusEffect() {
  const started = S.habits.filter((h) => ["building", "maintaining"].includes(h.status) && h.start), first = started.map((h) => h.start!).sort()[0];
  type Row = { h: Habit; a: ReturnType<typeof rateBetween>; b: ReturnType<typeof rateBetween>; kind: "focus" | "ripple"; mark: string; d: number };
  const rows: Row[] = [], rip: Row[] = [];
  for (const h of started) { const a = rateBetween(S, h, null, h.start), b = rateBetween(S, h, h.start, null); if (a.l >= 5 && b.l >= 5) rows.push({ h, a, b, kind: "focus", mark: h.start!, d: b.r! - a.r! }); }
  if (first) for (const h of by("queued")) { const a = rateBetween(S, h, null, first), b = rateBetween(S, h, first, null); if (a.l >= 5 && b.l >= 5) { const d = b.r! - a.r!; if (Math.abs(d) >= 0.15) rip.push({ h, a, b, d, mark: first, kind: "ripple" }); } }
  rip.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const line = (x: Row) => `<div class="fx"><div><button class="hn" data-act="edit" data-id="${x.h.id}">${esc(x.h.name)}</button><div class="sub">${pct(x.a.r!)} before → ${pct(x.b.r!)} since ${fmt(x.mark)}</div></div>${spark(x.h, x.mark)}<div class="delta ${x.d >= 0 ? "up" : "down"}">${x.d >= 0 ? "+" : "−"}${Math.round(Math.abs(x.d) * 100)}<small>${x.kind === "focus" ? "in focus" : "not in focus"}</small></div></div>`;
  return { focus: rows.map(line).join(""), ripple: rip.slice(0, 5).map(line).join("") };
}
const fv = (m: Metric, v: number) => (m.type === "yesno" ? pct(v) : v.toFixed(1) + (m.type === "number" && m.unit ? " " + m.unit : ""));
const fd = (m: Metric, d: number) => (m.type === "yesno" ? Math.round(Math.abs(d) * 100) + " pts" : Math.abs(d).toFixed(1) + (m.type === "number" && m.unit ? " " + m.unit : " pts"));
const pfmt = (p: number) => (p < 0.001 ? "p < .001" : "p = " + p.toFixed(3).replace(/^0/, ""));

function findCard(t: TestResult, guessIdx: number | null) {
  const [ya, na] = yLab(t.h), isGuess = guessIdx != null;
  const head = `<span class="find-t">${esc(t.h.name)}<span class="arrow">→</span>${esc(t.m.name)}${t.lag ? ' <span class="muted">next day</span>' : ""}</span>`;
  const rm = isGuess ? `<button class="link" data-act="gdel" data-v="${guessIdx}">Remove</button>` : "";
  if (!t.ok) return `<div class="find"><div class="find-top">${head}${rm}</div><p class="find-s muted">${!(t.ny + t.nn) ? "No data yet. Turn on Everything on Today to start logging it." : `Needs more data: ${t.ny} ${ya.toLowerCase()}, ${t.nn} ${na.toLowerCase()}. Needs ${MIN_N} of each.`}</p></div>`;
  const mx = Math.max(t.a, t.b) * 1.15 || 1;
  const sc = (v: number) => (t.m.type === "yesno" ? v * 100 : t.m.type === "scale" ? ((v - 1) / 9) * 100 : (v / mx) * 100);
  let verdict: string, tag: string;
  if (isGuess) {
    if (t.p < 0.05) { verdict = t.good ? "Holds up" : "Opposite"; tag = t.good ? "good" : "bad"; }
    else if (t.p < 0.2 && t.good) { verdict = "Leaning yes"; tag = "meh"; }
    else { verdict = "No clear link"; tag = "meh"; }
  } else { tag = t.good ? "good" : "bad"; verdict = t.good ? "Helps" : "Hurts"; }
  return `<div class="find"><div class="find-top">${head}<span style="display:flex;gap:10px;align-items:center"><span class="tag ${tag}">${verdict}</span>${rm}</span></div>
    <div class="cmp"><span>${ya} (${t.ny})</span><span class="tr"><i style="width:${Math.max(2, sc(t.a))}%;background:linear-gradient(90deg,var(--sl1),var(--sl2))"></i></span><span class="v">${fv(t.m, t.a)}</span></div>
    <div class="cmp"><span>${na} (${t.nn})</span><span class="tr"><i style="width:${Math.max(2, sc(t.b))}%;background:var(--s3)"></i></span><span class="v">${fv(t.m, t.b)}</span></div>
    <p class="find-s">${esc(t.m.name)} ${t.lag ? "the next day " : ""}is ${fd(t.m, t.d)} ${t.d > 0 ? "higher" : "lower"} on ${ya.toLowerCase()} days.</p><span class="stat-line">${pfmt(t.p)}${t.q != null ? ` · adjusted ${pfmt(t.q).replace("p ", "q ")}` : ""}</span></div>`;
}

function vInsights() {
  const D = discover(S), FE = focusEffect();
  const trendable = S.metrics.filter((m) => m.type !== "yesno");
  if (!MT(ui.trend) || MT(ui.trend)!.type === "yesno") ui.trend = trendable[0]?.id ?? "";
  const tm = MT(ui.trend);
  let chart = "";
  if (tm) {
    const N = 42, keys: string[] = [];
    for (let i = N - 1; i >= 0; i--) keys.push(add(TODAY, -i));
    const vals = keys.map((k) => { const v = S.checkins[k]?.m?.[tm.id]; return v == null ? null : +v; });
    const got = vals.filter((v): v is number => v != null);
    let lo = 1, hi = 10;
    if (tm.type === "number" && got.length) { lo = Math.floor(Math.min(...got)); hi = Math.ceil(Math.max(...got)); if (hi === lo) hi = lo + 1; }
    const W = 600, Hh = 170, L = 30, R = 10, T = 10, B = 26, px = (i: number) => L + (i * (W - L - R)) / (N - 1), py = (v: number) => T + ((hi - v) / (hi - lo)) * (Hh - T - B);
    const roll = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null); return w.length >= 3 ? mean(w) : null; });
    const path = (a: (number | null)[]) => { let d = "", mv = true; a.forEach((v, i) => { if (v == null) { mv = true; return; } d += (mv ? "M" : "L") + px(i).toFixed(1) + " " + py(v).toFixed(1) + " "; mv = false; }); return d; };
    const ticks = tm.type === "scale" ? [1, 5, 10] : [lo, (lo + hi) / 2, hi];
    chart = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(tm.name)} over the last ${N} days">
      <defs><linearGradient id="slg" x1="0" x2="1"><stop offset="0" stop-color="#4FB3FF"/><stop offset="1" stop-color="#3EE39C"/></linearGradient></defs>
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}" stroke="var(--line2)" stroke-width="1"/><text x="${L - 8}" y="${py(v) + 4}" font-size="12" fill="var(--mut)" text-anchor="end">${+v.toFixed(1)}</text>`).join("")}
      ${[0, Math.floor(N / 2), N - 1].map((i) => `<text x="${px(i)}" y="${Hh - 6}" font-size="12" fill="var(--mut)" text-anchor="${i === 0 ? "start" : i === N - 1 ? "end" : "middle"}">${i === N - 1 ? "Today" : fmt(keys[i]!)}</text>`).join("")}
      ${vals.map((v, i) => (v == null ? "" : `<circle cx="${px(i)}" cy="${py(v)}" r="2.6" fill="var(--mut)" opacity=".5"/>`)).join("")}
      <path d="${path(roll)}" fill="none" stroke="url(#slg)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  const W8: { ws: string; p: number; cur: boolean }[] = [];
  for (let i = 7; i >= 0; i--) { const ws = add(sum.cw, -7 * i); W8.push({ ws, p: sum.weekPts(ws), cur: i === 0 }); }
  const mx = Math.max(10, ...W8.map((w) => w.p));
  const wchart = `<svg viewBox="0 0 600 150" role="img" aria-label="Weekly points, last 8 weeks">${W8.map((w, i) => { const bw = 56, x = 20 + i * 72, h = (w.p / mx) * 100; return `<rect x="${x}" y="${116 - h}" width="${bw}" height="${Math.max(2, h)}" rx="5" fill="${w.cur ? "var(--acc)" : "var(--s3)"}"/><text x="${x + bw / 2}" y="${108 - h}" font-size="13" font-weight="700" fill="var(--ink2)" text-anchor="middle">${n(w.p)}</text><text x="${x + bw / 2}" y="138" font-size="11.5" fill="var(--mut)" text-anchor="middle">${w.cur ? "This wk" : fmt(w.ws)}</text>`; }).join("")}
    ${sum.best ? `<line x1="14" x2="590" y1="${116 - (sum.best / mx) * 100}" y2="${116 - (sum.best / mx) * 100}" stroke="var(--acc)" stroke-dasharray="4 4" stroke-width="1.2" opacity=".7"/>` : ""}</svg>`;
  const guesses = S.guesses.map((g, i) => { const h = HB(g.h), m = MT(g.m); return h && m ? findCard(testPair(S, h, m, g.lag || 0), i) : ""; }).join("");
  const recs = [...by("building"), ...by("maintaining"), ...by("watching")].map((h) => ({ h, r: longestRun(S, h, TODAY) })).filter((x) => x.r > 0);
  let t7 = 0, c7 = 0;
  for (let i = 0; i < 7; i++) { const v = S.checkins[add(TODAY, -i)]?.m?.mood; if (v != null) { t7 += v; c7++; } }
  return `<div class="tiles">
    <div class="card tile"><b>${n(sum.total)}</b><span>lifetime pts · level ${sum.level}</span></div>
    <div class="card tile"><b>${checkinStreak(S, TODAY)}</b><span>check-ins in a row</span></div>
    <div class="card tile"><b>${c7 ? (t7 / c7).toFixed(1) : "–"}</b><span>mood, 7-day avg</span></div></div>
  <section><div class="sh"><h2>Weekly score</h2><span class="t">Dashed line = best week</span></div><div class="card chart">${wchart}</div></section>
  <section><div class="sh"><h2>Records</h2><span class="t">Beat these</span></div><div class="card">
    <div class="rec"><span>Best week<small>${sum.bestWs ? "Week of " + fmt(sum.bestWs) : "No full week yet"}</small></span><b>${n(sum.best)} pts</b></div>
    <div class="rec"><span>Best day rating<small>${sum.bestRk ? fmt(sum.bestRk) : "No days yet"} · points earned out of possible</small></span><b>${pct(sum.bestR)}</b></div>
    ${recs.map((x) => `<div class="rec"><span>${esc(x.h.name)}<small>${x.h.kind === "dont" ? "Most clean days in a row" : "Longest chain"}</small></span><b>${x.r} days</b></div>`).join("")}
  </div></section>
  ${tm ? `<section><div class="sh"><h2>Trend</h2><span class="t">7-day average</span></div><div class="card chart"><div class="chart-top"><div class="legend"><span><i style="background:linear-gradient(90deg,var(--sl1),var(--sl2))"></i>7-day average</span><span><i style="background:var(--mut);height:5px;width:5px;border-radius:50%"></i>Daily</span></div>
    <select id="trend" aria-label="Question to chart">${trendable.map((m) => `<option value="${m.id}"${m.id === tm.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>${chart}</div></section>` : ""}
  <section><div class="sh"><h2>Patterns found</h2><span class="t num">${D.found.length} of ${n(D.tests)} checked</span></div>
    <p class="lede">Every habit is checked against every check-in question, same day and next day. Only links that pass a false-discovery test show up. More days means fewer flukes. These are links, not proof of cause.</p>
    ${D.found.length ? `<div class="card">${D.found.slice(0, 10).map((t) => findCard(t, null)).join("")}</div>` : `<div class="card pad muted">Nothing passes the test yet. Most links show up after 3 to 4 weeks of check-ins.</div>`}</section>
  <section><div class="sh"><h2>Focus effect</h2><span class="t">Before vs. since</span></div>
    <p class="lede">The dashed line marks the day focus started. "Not in focus" rows moved anyway after you started, which is how one stack spills into another.</p>
    ${FE.focus ? `<div class="card">${FE.focus}</div>` : `<div class="card pad muted">Needs 5 logged days before and after a habit enters focus. Turn on Everything on Today to build a baseline.</div>`}
    ${FE.ripple ? `<div class="card">${FE.ripple}</div>` : ""}</section>
  <section><div class="sh"><h2>Your guesses</h2><span class="t">Check your instincts</span></div>
    <div class="card">${guesses || '<div class="find muted">No guesses yet.</div>'}
      <div class="addg"><select id="g-h" aria-label="Habit">${S.habits.filter((h) => h.kind !== "auto").map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("")}</select><select id="g-m" aria-label="Check-in question">${S.metrics.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select><select id="g-l" aria-label="Timing"><option value="0">Same day</option><option value="1">Next day</option></select><button class="btn" data-act="gadd">Add</button></div></div></section>`;
}

function vSettings() {
  const s = S.settings, P = S.pts, L = s.birth ? life(S, TODAY) : null, lo = tmin(s.lightsOut);
  const f = (key: string, label: string, sub: string, type = "number", extra = "", obj: "set" | "pt" = "set") =>
    `<div class="set"><label for="${obj}-${key}">${label}${sub ? `<small>${sub}</small>` : ""}</label><input id="${obj}-${key}" type="${type}" data-${obj}="${key}" value="${obj === "set" ? (s as unknown as Record<string, unknown>)[key] : (P as unknown as Record<string, unknown>)[key]}" ${extra}></div>`;
  return `${accountSection()}${remindersSection()}${lockSection()}<section><div class="sh"><h2>Backup</h2><span class="t">A copy you keep yourself</span></div><div class="card pad" style="display:flex;flex-direction:column;gap:12px">
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Export a backup or copy a backup code now and then. With sync on, your plan is also saved to your account.</p>
    <div class="backup"><button class="btn sm" data-act="export">Export backup</button><button class="btn sm ghost" data-act="import">Import backup</button><button class="btn sm ghost" data-act="copycode">Copy backup code</button><button class="btn sm ghost" data-act="pastecode">Paste a code</button><input type="file" accept="application/json,.json" id="importfile" class="filein" tabindex="-1" aria-hidden="true"></div></div></section>
  <section><div class="sh"><h2>Points</h2><span class="t">Misses never cost points</span></div><div class="card">
    ${f("focus", "In-focus habit done", "", "number", 'min="0"', "pt")}${f("kept", "Locked-in habit kept", "", "number", 'min="0"', "pt")}${f("tracked", "Tracked don’t kept clean", "Tracked from day one", "number", 'min="0"', "pt")}
    ${f("base", "Not-in-focus habit done", "With Everything on", "number", 'min="0"', "pt")}${f("checkin", "Check-in locked in", "", "number", 'min="0"', "pt")}${f("chain", "Chain bonus", "Per habit, 7+ days running", "number", 'min="0"', "pt")}${f("grad", "Graduation", "A habit locks in", "number", 'min="0"', "pt")}
  </div></section>
  <section><div class="sh"><h2>Competing with yourself</h2></div><div class="card explain">
    <ul><li><b>Weekly score</b> resets Monday. The headline compares this week with last week at the same day.</li>
    <li><b>Day rating</b> is points earned out of points possible for in-focus, locked-in and tracked items plus the check-in. It keeps records fair as you add habits.</li>
    <li><b>Levels</b> every 1,000 lifetime points. They only go up.</li></ul></div></section>
  <section><div class="sh"><h2>Queue rules</h2></div><div class="card">
    ${f("maxActive", "Habits in focus at once", "", "number", 'min="1" max="6"')}
    ${f("dailyTarget", "Locked in: days done", "Daily habits and don’ts", "number", 'min="1"')}
    ${f("dailyWindow", "…out of the last", "days", "number", 'min="7" max="60"')}
    ${f("weeklyTarget", "Locked in: weeks on target", "Weekly rhythms and projects", "number", 'min="1"')}
    ${f("weeklyWindow", "…out of the last", "weeks", "number", 'min="2" max="12"')}
    ${f("pauseMin", "Pause the queue below", "days done", "number", 'min="1"')}
    ${f("pauseWindow", "…out of the last", "days", "number", 'min="3" max="14"')}
    ${f("gracePer", "One grace day every", "days", "number", 'min="2" max="30"')}
  </div></section>
  <section><div class="sh"><h2>How streaks work</h2></div><div class="card explain">
    <p>The <b>chain</b> keeps you motivated. <b>Consistency</b> moves the queue. A broken chain never erases progress.</p>
    <h3>Daily habits</h3><ul><li>Each day done adds 1. Miss one day and the chain holds as a grace day (orange), one per ${s.gracePer} days.</li><li>Two misses in a row ends it. One miss marks it at risk. Not logging counts as a miss.</li></ul>
    <h3>Don'ts</h3><ul><li>Clean days since the last setback. Any drink is a setback for No alcohol and resets the count. No grace days.</li><li>Consistency still uses ${s.dailyTarget} of ${s.dailyWindow}, so one setback doesn't send you to the back of the line.</li></ul>
    <h3>Weekly rhythms</h3><ul><li>A week counts when you hit its target. The chain is weeks in a row on target.</li></ul>
    <h3>Moving the queue</h3><ul><li><b>Locked in</b> at ${s.dailyTarget} of ${s.dailyWindow} days or ${s.weeklyTarget} of ${s.weeklyWindow} weeks. Graduate it and the next item starts.</li><li><b>Lost ground</b> below ${s.pauseMin} of ${s.pauseWindow} days or two missed weeks pauses the queue until it recovers.</li></ul>
  </div></section>
  <section><div class="sh"><h2>Life clock and schedule</h2><span class="t num">${L ? n(L.left) + " weeks left" : "Add your birth date"}</span></div><div class="card">
    ${f("birth", "Birth date", "", "date")}${f("lifeExp", "Count toward age", "US male average is 75.8", "number", 'step="0.1" min="40" max="110"')}${f("lightsOut", "Lights out", "", "time")}${f("wake", "Wake up", "", "time")}
  </div></section>
  <section><div class="sh"><h2>Check-in</h2></div><div class="card"><div class="set"><label>Questions<small>${S.metrics.length} questions · ${S.noteAreas.length} note areas</small></label><button class="btn sm ghost" data-act="metrics">Edit</button></div></div></section>
  <section><div class="sh"><h2>Daily rhythm</h2><span class="t">Reminders come in a later update</span></div><div class="card">
    <div class="prompt"><b>${tfmt(tmin(s.wake))}</b><span>Morning stack.</span></div>
    <div class="prompt"><b>${tfmt(lo - 45)}</b><span>Check-in. 60 seconds, before the phone goes down.</span></div>
    <div class="prompt"><b>${tfmt(lo - 30)}</b><span>Shutdown. Phone on the charger outside the bedroom.</span></div>
    <div class="prompt"><b>SUN 4 PM</b><span>Weekly review: your score vs. last week, graduate, re-order the queue.</span></div></div></section>
  <section><div class="sh"><h2>Start over</h2></div><div class="card pad" style="display:flex;flex-direction:column;gap:12px">
    ${S.sample ? `<p style="margin:0;font-size:13.5px;color:var(--ink2)">You're looking at example data.</p>` : ""}
    ${ui.confirmReset ? `<div class="notice warn"><p>${ui.confirmReset === "fresh" ? "Clear all history and points, and start Phase 1 today? Your habit list, order and questions stay." : "Replace everything, including your own history, with example data?"}</p><div style="display:flex;gap:6px"><button class="btn sm danger" data-act="doreset">Yes, reset</button><button class="btn sm ghost" data-act="cancelreset">Cancel</button></div></div>`
      : `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="reset" data-v="fresh">Start fresh today</button><button class="btn ghost sm" data-act="reset" data-v="sample">Look at example data</button></div>`}
  </div></section>`;
}

/* ---------- sheets ---------- */
function sheet() {
  const root = $("sheet-root");
  if (!ui.sheet) { root.innerHTML = ""; return; }
  const opt = (o: Record<string, string>, v: string) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("");
  let body = "";
  if (ui.sheet.type === "habit") {
    const h: Pick<Habit, "name" | "area" | "kind" | "target" | "stack" | "status"> = (ui.sheet.id && HB(ui.sheet.id)) || { name: "", area: "Faith", kind: "daily", target: 1, stack: "morning", status: "queued" };
    body = `<h2 id="sh-t">${ui.sheet.id ? "Edit habit" : "Add a habit"}</h2>
    <div class="field"><label for="e-name">Name</label><input id="e-name" type="text" value="${esc(h.name)}"></div>
    <div class="two"><div class="field"><label for="e-area">Area</label><select id="e-area">${AREAS.map((a) => `<option${a === h.area ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
    <div class="field"><label for="e-kind">Type</label><select id="e-kind">${opt(KINDS, h.kind)}</select></div></div>
    <div class="field"><label for="e-target">Times per week (weekly rhythms and projects)</label><input id="e-target" type="number" min="1" max="7" value="${h.target ?? 1}"></div>
    <div class="field"><label for="e-status">Where it lives</label><select id="e-status">${opt(STATUSES, h.status)}</select></div>
    <div class="actions">${ui.sheet.id ? (ui.confirmDel ? `<button class="btn danger" data-act="del">Delete for good</button>` : `<button class="btn ghost" data-act="askdel">Delete</button>`) : "<span></span>"}
      <div style="display:flex;gap:8px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="savehabit">Save</button></div></div>`;
  } else if (ui.sheet.type === "faceoffer") {
    body = `<h2 id="sh-t">Use Face ID too?</h2>
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Unlock with your face instead of typing the passcode. The passcode still works as a backup.</p>
    <div class="actions"><button class="btn ghost" data-act="close">Not now</button><button class="btn" data-act="faceon">Turn on Face ID</button></div>`;
  } else if (ui.sheet.type === "focus") {
    const sug = suggestFocusTitle(S);
    body = `<h2 id="sh-t">Name your focus</h2>
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">A short name for what you're working on right now. It sits at the top of Today.</p>
    <div class="field"><label for="focustitle">Focus</label><input id="focustitle" type="text" maxlength="40" value="${esc(S.settings.focusTitle || focusTitle(S))}"></div>
    <button class="link" data-act="focusauto" style="align-self:flex-start">Use the suggestion: ${esc(sug)}</button>
    <div class="actions"><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="focussave">Save</button></div></div>`;
  } else if (ui.sheet.type === "pin") {
    body = `<h2 id="sh-t">${pinUi.step === "new" ? "Choose a passcode" : "Enter it again"}</h2>
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">${pinUi.error ? `<span style="color:var(--bad)">${esc(pinUi.error)}</span>` : pinUi.step === "new" ? "4 to 6 digits." : "To make sure it's right."}</p>
    ${dots(pinUi.entry.length, Math.max(4, pinUi.step === "confirm" ? pinUi.first.length : Math.min(6, Math.max(4, pinUi.entry.length))))}${keypad("pinsetkey")}
    <div class="actions"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="pinnext" ${pinUi.entry.length < 4 ? "disabled" : ""}>${pinUi.step === "new" ? "Next" : "Save passcode"}</button></div>`;
  } else if (ui.sheet.type === "code") {
    body = `<h2 id="sh-t">Paste a plan code</h2>
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Copy the whole code, then tap the box below and tap Paste. This replaces what's in the app now.</p>
    <textarea id="codein" rows="6" autocapitalize="off" autocorrect="off" spellcheck="false" style="font:inherit;font-size:13px;color:var(--ink);background:var(--s2);border:1px solid transparent;border-radius:10px;padding:10px;width:100%;resize:vertical" placeholder="GP1…"></textarea>
    <div class="actions"><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn" data-act="loadcode">Load</button></div></div>`;
  } else if (ui.sheet.type === "metrics") {
    const sug = SUGGESTED_METRICS.filter((x) => !MT(x.id));
    body = `<h2 id="sh-t">Check-in questions</h2>
    <ul class="mlist">${S.metrics.map((m, i) => `<li><div><button class="hn" data-act="metric" data-id="${m.id}">${esc(m.name)}</button><div class="sub">${MTYPES[m.type]}${m.unit ? " · " + esc(m.unit) : ""} · ${m.better === "low" ? "lower is better" : "higher is better"}</div></div>
      <div class="mv"><button class="ib" data-act="mmove" data-id="${m.id}" data-v="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${I.u}</button><button class="ib" data-act="mmove" data-id="${m.id}" data-v="1" aria-label="Move down" ${i === S.metrics.length - 1 ? "disabled" : ""}>${I.d}</button></div></li>`).join("")}</ul>
    <button class="btn ghost" data-act="metric" style="align-self:flex-start">Write your own</button>
    ${sug.length ? `<div class="field"><label>Suggested, one tap to add</label><ul class="mlist">${sug.map((x) => `<li><div>${esc(x.name)}<div class="sub">${MTYPES[x.type]}${x.unit ? " · " + x.unit : ""}</div></div><button class="btn sm ghost" data-act="sugadd" data-id="${x.id}">Add</button></li>`).join("")}</ul></div>` : ""}
    <div class="field"><label for="e-areas">Note areas, separated by commas</label><input id="e-areas" type="text" value="${esc(S.noteAreas.join(", "))}"></div>
    <div class="actions"><span></span><div style="display:flex;gap:8px"><button class="btn ghost" data-act="close">Close</button><button class="btn" data-act="saveareas">Save</button></div></div>`;
  } else {
    const m: Metric = (ui.sheet.id && MT(ui.sheet.id)) || { id: "", name: "", type: "scale", lo: "", hi: "", unit: "", better: "high" };
    body = `<h2 id="sh-t">${ui.sheet.id ? "Edit question" : "Add a question"}</h2>
    <div class="field"><label for="q-name">Question</label><input id="q-name" type="text" value="${esc(m.name)}" placeholder="e.g. Patience with the kids"></div>
    <div class="two"><div class="field"><label for="q-type">Answer type</label><select id="q-type">${opt(MTYPES, m.type)}</select></div>
    <div class="field"><label for="q-better">Better is</label><select id="q-better"><option value="high"${m.better !== "low" ? " selected" : ""}>Higher / yes</option><option value="low"${m.better === "low" ? " selected" : ""}>Lower / no</option></select></div></div>
    <div class="two"><div class="field"><label for="q-lo">1 means (slider)</label><input id="q-lo" type="text" value="${esc(m.lo)}" placeholder="Rough"></div>
    <div class="field"><label for="q-hi">10 means (slider)</label><input id="q-hi" type="text" value="${esc(m.hi)}" placeholder="Great"></div></div>
    <div class="field"><label for="q-unit">Unit (number)</label><input id="q-unit" type="text" value="${esc(m.unit)}" placeholder="h, lb, $"></div>
    <div class="actions">${ui.sheet.id ? (ui.confirmDel ? `<button class="btn danger" data-act="mdel">Delete question</button>` : `<button class="btn ghost" data-act="askdel">Delete</button>`) : "<span></span>"}
      <div style="display:flex;gap:8px"><button class="btn ghost" data-act="metrics">Back</button><button class="btn" data-act="savemetric">Save</button></div></div>`;
  }
  root.innerHTML = `<div class="scrim" data-act="close"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" data-stop="1"><div class="grab"></div>${body}</div></div>`;
}


/* ---------- account, reminders, lock ---------- */
function accountSection() {
  if (!cloud.cloudAvailable) return "";
  const i = cloud.syncInfo();
  if (i.email) {
    const status = i.status === "error" ? "Couldn't reach the server. It will try again." : i.dirty ? "Changes waiting to sync" : i.at ? `Synced ${new Date(i.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Synced";
    return `<section><div class="sh"><h2>Sync</h2><span class="t">On</span></div><div class="card pad" style="display:flex;flex-direction:column;gap:12px">
      <p style="margin:0;font-size:13.5px;color:var(--ink2)">Signed in as <b>${esc(i.email)}</b>. Your plan and history are saved to your account and restored if you sign in on another phone.</p>
      <p style="margin:0;font-size:12.5px;color:var(--mut)">${status}</p>
      <div class="backup"><button class="btn sm" data-act="syncnow">Sync now</button><button class="btn sm ghost" data-act="signout">Sign out</button></div></div></section>`;
  }
  return `<section><div class="sh"><h2>Sync</h2><span class="t">Off</span></div><div class="card pad" style="display:flex;flex-direction:column;gap:12px">
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Sign in to back up your plan to your account and to turn on reminders. Sign in with your email and password.</p>
    ${signInForm()}
  </div></section>`;
}
function signInForm() {
  const tabs = `<div class="tabs" style="padding:0;gap:16px"><div class="tl">${(["password", "setup", "code"] as const).map((m) => `<button data-act="authmode" data-v="${m}" aria-pressed="${auth.mode === m}" style="font-size:13px">${m === "password" ? "Password" : m === "setup" ? "First time" : "Email code"}</button>`).join("")}</div></div>`;
  const email = `<div class="field"><label for="authemail">Email</label><input id="authemail" type="email" autocomplete="email" value="${esc(auth.email)}" placeholder="you@example.com"></div>`;
  const dis = auth.busy ? "disabled" : "";
  if (auth.mode === "password")
    return `${tabs}${email}<div class="field"><label for="authpw">Password</label><input id="authpw" type="password" autocomplete="current-password"></div>
      <div class="backup"><button class="btn sm" data-act="pwsignin" ${dis}>Sign in</button></div>`;
  if (auth.mode === "setup")
    return `${tabs}<p style="margin:0;font-size:12.5px;color:var(--mut)">Have a setup code? Use it once to choose your password. After that, sign in with email and password.</p>${email}
      <div class="field"><label for="authsetup">Setup code</label><input id="authsetup" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX"></div>
      <div class="field"><label for="authnew">New password (8+ characters)</label><input id="authnew" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="authnew2">Same password again</label><input id="authnew2" type="password" autocomplete="new-password"></div>
      <div class="backup"><button class="btn sm" data-act="pwsetup" ${dis}>Save password and sign in</button></div>`;
  return `${tabs}${auth.sent
    ? `<p style="margin:0;font-size:12.5px;color:var(--mut)">Type the 6-digit code from the email.</p><div class="field"><label for="authcode">Code sent to ${esc(auth.email)}</label><input id="authcode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></div>
       <div class="backup"><button class="btn sm" data-act="verifycode" ${dis}>Sign in</button><button class="btn sm ghost" data-act="authback">Use a different email</button></div>`
    : `${email}<div class="backup"><button class="btn sm" data-act="sendcode" ${dis}>Email me a code</button></div>`}`;
}
function remindersSection() {
  if (!cloud.cloudAvailable) return "";
  const s = S.settings, r = s.reminders, lo = tmin(s.lightsOut);
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = nav.standalone || window.matchMedia("(display-mode: standalone)").matches;
  const row = (id: keyof typeof r, label: string, when: string) =>
    `<div class="set"><label>${label}<small>${when}</small></label><button class="b y" data-act="remtoggle" data-id="${id}" aria-pressed="${r[id]}" style="justify-self:end">${r[id] ? "On" : "Off"}</button></div>`;
  let top: string;
  if (!cloud.syncInfo().email) top = `<p style="margin:0;font-size:13.5px;color:var(--ink2)">Sign in above first, so reminders know which phone to go to.</p>`;
  else if (!installed) top = `<p style="margin:0;font-size:13.5px;color:var(--ink2)">Open Game Plan from its home screen icon to turn on reminders. iPhone only allows them for installed apps.</p>`;
  else if (remindersEnabled) top = `<div class="backup"><button class="btn sm ghost" data-act="remtest">Send a test</button><button class="btn sm ghost" data-act="remoff">Turn off on this phone</button></div>`;
  else top = `<div class="backup"><button class="btn sm" data-act="remon">Turn on reminders</button></div>`;
  return `<section><div class="sh"><h2>Reminders</h2><span class="t">${remindersEnabled ? "On" : "Off"}</span></div><div class="card">
    <div class="pad" style="display:flex;flex-direction:column;gap:10px">${top}<p style="margin:0;font-size:12px;color:var(--mut)">They show on your lock screen, so they never name a habit.</p></div>
    ${row("morning", "Morning", tfmt(tmin(s.wake)))}${row("checkin", "Check-in", tfmt(lo - 45))}${row("shutdown", "Shutdown", tfmt(lo - 30))}${row("weekly", "Weekly review", "Sundays, 4:00 PM")}
  </div></section>`;
}
function lockSection() {
  const c = lock.lockCfg();
  if (!c) return `<section><div class="sh"><h2>App lock</h2><span class="t">Off</span></div><div class="card pad" style="display:flex;flex-direction:column;gap:12px">
    <p style="margin:0;font-size:13.5px;color:var(--ink2)">Ask for a passcode (and Face ID if you like) when Game Plan opens. The screen is also hidden in the app switcher.</p>
    <div class="backup"><button class="btn sm" data-act="pinset">Set a passcode</button></div></div></section>`;
  const after = [[0, "Right away"], [1, "After 1 minute"], [5, "After 5 minutes"], [15, "After 15 minutes"]] as const;
  return `<section><div class="sh"><h2>App lock</h2><span class="t">On</span></div><div class="card">
    <div class="set"><label for="lockafter">Lock again<small>After you leave the app</small></label><select id="lockafter">${after.map(([v, l]) => `<option value="${v}"${c.after === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    ${lock.faceIdSupported() ? `<div class="set"><label>Face ID<small>Unlock without the passcode</small></label><button class="b y" data-act="${c.credId ? "faceoff" : "faceon"}" aria-pressed="${!!c.credId}" style="justify-self:end">${c.credId ? "On" : "Off"}</button></div>` : ""}
    <div class="pad backup"><button class="btn sm ghost" data-act="pinset">Change passcode</button><button class="btn sm ghost" data-act="lockoff">Turn off lock</button></div>
  </div></section>`;
}
function keypad(act: string) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return `<div class="keypad">${keys.map((k) => (k === "" ? "<span></span>" : `<button class="key" data-act="${act}" data-v="${k}" aria-label="${k === "del" ? "Delete" : k}">${k === "del" ? "⌫" : k}</button>`)).join("")}</div>`;
}
function dots(n: number, len: number) {
  return `<div class="pindots" aria-hidden="true">${Array.from({ length: len }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;
}
function lockScreen() {
  const c = lock.lockCfg()!;
  return `<div class="lockscreen"><div class="brand">Second Half <span>Game Plan</span></div>
    <p class="lockmsg">${pinUi.error ? `<span class="err">${esc(pinUi.error)}</span>` : "Enter your passcode"}</p>
    ${c.credId ? `<button class="btn face" data-act="faceunlock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0"/></svg>Unlock with Face ID</button><p class="lockmsg" style="font-size:13px">or enter your passcode</p>` : ""}
    ${dots(pinUi.entry.length, c.len)}${keypad("pinkey")}
    ${pinUi.forgot ? `<div class="notice warn"><p>Forgot it? You can erase Game Plan on this phone and start over.${cloud.syncInfo().email ? " Sign in again afterwards and your synced plan comes back." : " Without sync, your history on this phone is lost."}</p><div class="backup"><button class="btn sm danger" data-act="erase">Erase and start over</button><button class="btn sm ghost" data-act="forgotno">Cancel</button></div></div>`
      : `<button class="link" data-act="forgot">Forgot passcode?</button>`}</div>`;
}

/* ---------- render ---------- */
const VIEWS: Record<string, () => string> = { today: vToday, plan: vPlan, insights: vInsights, settings: vSettings };
const tab = () => { const t = location.hash.slice(1); return VIEWS[t] ? t : "today"; };
let faceTried = false;
export function render() {
  if (lock.isLocked()) {
    document.documentElement.classList.add("is-locked");
    $("view").innerHTML = lockScreen();
    $("topr").innerHTML = "";
    $("sheet-root").innerHTML = "";
    // Try Face ID once each time the app locks. If iPhone wants a tap first, the button is there.
    if (!faceTried && lock.lockCfg()?.credId && document.visibilityState === "visible") {
      faceTried = true;
      void lock.unlockWithFaceId().then((ok) => { if (ok) { lock.unlock(); render(); void cloud.pull(); } });
    }
    return;
  }
  faceTried = false;
  document.documentElement.classList.remove("is-locked");
  const now = dk(new Date());
  if (now !== TODAY) { if (ui.view === TODAY) ui.view = now; TODAY = now; }
  sum = scoreSummary(S, TODAY);
  const t = tab();
  document.querySelectorAll(".nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + t ? "page" : "false"));
  $("topr").innerHTML = `Lvl <b>${sum.level}</b> · ${checkinStreak(S, TODAY)}-day chain`;
  $("view").innerHTML = VIEWS[t]!();
  if (t === "today" && ui.grid) drawGrid();
  sheet();
}
let tt: number | undefined;
function toast(m: string) {
  const r = $("toast-root");
  r.innerHTML = `<div class="toast" role="status">${esc(m)}</div>`;
  clearTimeout(tt);
  tt = window.setTimeout(() => (r.innerHTML = ""), 2600);
}

async function exportBackup() {
  const json = JSON.stringify(S, null, 1), name = `game-plan-backup-${TODAY}.json`;
  const file = new File([json], name, { type: "application/json" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: "Game Plan backup" }); return; }
  } catch (e) { if ((e as Error).name === "AbortError") return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const b64u = { enc: (b: Uint8Array) => { let x = ""; b.forEach((c) => (x += String.fromCharCode(c))); return btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: (t: string) => { const x = atob(t.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(x, (c) => c.charCodeAt(0)); } };
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
}
/** A plan code is "GP1" + base64url(deflate-raw(JSON)). Raw JSON is accepted too. */
async function decodeCode(text: string): Promise<unknown> {
  const t = text.replace(/\s+/g, "");
  if (t.startsWith("{")) return JSON.parse(text);
  if (!t.startsWith("GP1")) throw new Error("bad");
  return JSON.parse(new TextDecoder().decode(await pipe(b64u.dec(t.slice(3)), new DecompressionStream("deflate-raw"))));
}
async function encodeCode(state: State) {
  return "GP1" + b64u.enc(await pipe(new TextEncoder().encode(JSON.stringify(state)), new CompressionStream("deflate-raw")));
}
function loadState(raw: unknown) {
  const s = normalize(raw, TODAY);
  if (!s) throw new Error("bad");
  // A plan with no history yet: start the clock on the day you load it.
  if (!Object.keys(s.logs).length && !Object.keys(s.checkins).length)
    for (const h of s.habits) h.start = h.status === "building" || h.status === "watching" ? TODAY : null;
  S = s; ui.sheet = null; ui.view = TODAY; save(); render();
}
async function copyCode() {
  try { await navigator.clipboard.writeText(await encodeCode(S)); toast("Backup code copied. Paste it into Notes to keep it."); }
  catch { toast("Couldn't copy. Use Export backup instead."); }
}
async function loadCode() {
  const el = document.getElementById("codein") as HTMLTextAreaElement | null;
  try { loadState(await decodeCode(el?.value ?? "")); toast("Plan loaded. Phase 1 starts today."); }
  catch { toast("That code didn't work. Copy the whole thing and try again."); }
}
async function importBackup(f: File) {
  try {
    const s = normalize(JSON.parse(await f.text()), TODAY);
    if (!s) throw new Error("bad");
    // A plan file with no history yet: start the clock on the day you load it.
    if (!Object.keys(s.logs).length && !Object.keys(s.checkins).length)
      for (const h of s.habits) h.start = h.status === "building" || h.status === "watching" ? TODAY : null;
    S = s; save(); render(); toast("Backup restored.");
  } catch { toast("That file isn't a Game Plan backup."); }
}

/** After logging one habit: redraw that row, the scoreboard and the day's points, not the whole screen. */
function refreshAfterLog(id: string) {
  const h = HB(id), el = document.getElementById("r-" + id), k = ui.view;
  if (!h || !el || tab() !== "today") { render(); return; }
  sum = scoreSummary(S, TODAY);
  el.outerHTML = row(h, k, h.status === "queued");
  const bw = document.getElementById("boardwrap"); if (bw) bw.innerHTML = board();
  const fw = document.getElementById("focuswrap"); if (fw) fw.innerHTML = focusCard();
  const nw = document.getElementById("noticewrap"); if (nw) nw.innerHTML = notices();
  const tp = document.getElementById("todaypts"); if (tp) tp.innerHTML = `<b>${n(sum.day(k).pts)}</b> pts${k === TODAY ? " today" : ""}`;
  $("topr").innerHTML = `Lvl <b>${sum.level}</b> · ${checkinStreak(S, TODAY)}-day chain`;
}

function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!t) return;
  if (t.classList.contains("scrim") && (e.target as HTMLElement).closest("[data-stop]")) return;
  const a = t.dataset.act!, id = t.dataset.id ?? "", v = t.dataset.v ?? "", k = ui.view;
  const field = (x: string) => ($(x) as HTMLInputElement).value;
  switch (a) {
    case "log": {
      const day = (S.logs[k] ??= {});
      if (day[id] === v) delete day[id];
      else { day[id] = v as "y" | "n"; if (v === "y") { const x = habitPoints(S, HB(id)!, k); if (x.pts) toast(`+${x.pts} pts`); } }
      refreshAfterLog(id); save();
      return;
    }
    case "mset": {
      const c = ck(k); c.m[id] = c.m[id] === +v ? null : +v;
      document.querySelectorAll<HTMLElement>(`[data-act=mset][data-id="${id}"]`).forEach((b) => b.setAttribute("aria-pressed", String(c.m[id] === +(b.dataset.v ?? ""))));
      save();
      return;
    }
    case "lock": ck(k).locked = true; toast(`Check-in saved. +${S.pts.checkin} pts.`); break;
    case "unlock": ck(k).locked = false; break;
    case "prev": ui.view = add(k, -1); break;
    case "next": ui.view = add(k, 1); break;
    case "grid": ui.grid = !ui.grid; break;
    case "logall": S.settings.logAll = v === "1"; break;
    case "hideinstall": try { localStorage.setItem("gameplan:hide-install", "1"); } catch { /* ignore */ } break;
    case "graduate": {
      const h = HB(id)!;
      h.status = "maintaining"; h.grad = TODAY;
      const r = launchNext(S, TODAY, false); S = r.state;
      toast(r.launched ? `${h.name} locked in. +${S.pts.grad} pts. ${r.launched.name} starts today.` : `${h.name} locked in. +${S.pts.grad} pts.`);
      break;
    }
    case "launch": { const r = launchNext(S, TODAY, !!t.dataset.force); S = r.state; if (r.launched) toast(`${r.launched.name} starts today.`); break; }
    case "max": S.settings.maxActive = Math.max(1, Math.min(6, S.settings.maxActive + +v)); break;
    case "move": {
      const q = by("queued"), i = q.findIndex((h) => h.id === id), j = i + +v;
      if (j < 0 || j >= q.length) break;
      const ai = S.habits.indexOf(q[i]!), aj = S.habits.indexOf(q[j]!);
      [S.habits[ai], S.habits[aj]] = [S.habits[aj]!, S.habits[ai]!];
      break;
    }
    case "park": { const h = HB(id)!; h.status = "parked"; toast(`${h.name} parked.`); break; }
    case "unpark": {
      const h = HB(id)!;
      h.status = v as Status; h.start = v === "watching" ? TODAY : null;
      if (v === "queued") { S.habits.splice(S.habits.indexOf(h), 1); const lastQ = by("queued").pop(); S.habits.splice(lastQ ? S.habits.indexOf(lastQ) + 1 : S.habits.length, 0, h); }
      toast(v === "watching" ? `Tracking ${h.name} from today.` : `${h.name} added to the end of the queue.`);
      break;
    }
    case "setup": { const h = HB(id)!; h.setup = !h.setup; break; }
    case "edit": ui.sheet = { type: "habit", id }; ui.confirmDel = false; break;
    case "add": ui.sheet = { type: "habit", id: null }; ui.confirmDel = false; break;
    case "metrics": ui.sheet = { type: "metrics" }; ui.confirmDel = false; break;
    case "metric": ui.sheet = { type: "metric", id: id || null }; ui.confirmDel = false; break;
    case "sugadd": { const x = SUGGESTED_METRICS.find((z) => z.id === id); if (x && !MT(id)) S.metrics.push({ ...x }); break; }
    case "close": ui.sheet = null; break;
    case "askdel": ui.confirmDel = true; break;
    case "del": { const did = ui.sheet?.id; S.habits = S.habits.filter((h) => h.id !== did); S.guesses = S.guesses.filter((g) => g.h !== did); ui.sheet = null; toast("Deleted."); break; }
    case "mdel": { const did = ui.sheet?.id; S.metrics = S.metrics.filter((m) => m.id !== did); S.guesses = S.guesses.filter((g) => g.m !== did); ui.sheet = { type: "metrics" }; toast("Question removed. Past answers are kept."); break; }
    case "mmove": {
      const i = S.metrics.findIndex((m) => m.id === id), j = i + +v;
      if (j < 0 || j >= S.metrics.length) break;
      [S.metrics[i], S.metrics[j]] = [S.metrics[j]!, S.metrics[i]!];
      break;
    }
    case "savehabit": {
      const name = field("e-name").trim();
      if (!name) { $("e-name").focus(); return; }
      let h = ui.sheet?.id ? HB(ui.sheet.id) : undefined;
      if (!h) { h = makeHabit(uid("h"), name, "Faith", "daily"); S.habits.push(h); }
      h.name = name; h.area = field("e-area"); h.kind = field("e-kind") as Kind;
      h.target = isWeekly(h) ? Math.max(1, Math.min(7, +field("e-target") || 1)) : null;
      const ns = field("e-status") as Status;
      if (ns !== h.status) {
        if ((ns === "building" || ns === "watching") && !h.start) h.start = TODAY;
        if (ns === "maintaining") h.grad = TODAY;
        if (ns === "queued" || ns === "parked") h.start = null;
        h.status = ns;
      }
      ui.sheet = null; toast("Saved.");
      break;
    }
    case "savemetric": {
      const name = field("q-name").trim();
      if (!name) { $("q-name").focus(); return; }
      let m = ui.sheet?.id ? MT(ui.sheet.id) : undefined;
      if (!m) { m = { id: uid("m"), name, type: "scale", better: "high" }; S.metrics.push(m); }
      Object.assign(m, { name, type: field("q-type"), better: field("q-better"), lo: field("q-lo").trim(), hi: field("q-hi").trim(), unit: field("q-unit").trim() });
      ui.sheet = { type: "metrics" }; toast("Saved.");
      break;
    }
    case "saveareas": S.noteAreas = field("e-areas").split(",").map((x) => x.trim()).filter(Boolean); ui.sheet = null; toast("Saved."); break;
    case "gadd": S.guesses.push({ h: field("g-h"), m: field("g-m"), lag: +field("g-l") }); break;
    case "gdel": S.guesses.splice(+v, 1); break;
    case "export": void exportBackup(); return;
    case "pastecode": ui.sheet = { type: "code" }; sheet(); return;
    case "loadcode": void loadCode(); return;
    case "copycode": void copyCode(); return;
    case "import": ($("importfile") as HTMLInputElement).click(); return;
    case "reset": if (v === "sample-now") { S = sampleState(TODAY); ui.view = TODAY; break; } ui.confirmReset = v; break;
    case "cancelreset": ui.confirmReset = null; break;
    case "doreset": {
      if (ui.confirmReset === "sample") S = sampleState(TODAY);
      else {
        S.logs = {}; S.checkins = {}; S.sample = false;
        for (const h of S.habits) {
          h.grad = h.status === "maintaining" ? TODAY : null;
          h.start = ["building", "watching", "maintaining"].includes(h.status) ? TODAY : null;
        }
      }
      ui.confirmReset = null; ui.view = TODAY; toast("Reset.");
      break;
    }
    case "pinkey": {
      const c = lock.lockCfg(); if (!c) return;
      pinUi.error = "";
      if (v === "del") pinUi.entry = pinUi.entry.slice(0, -1); else if (pinUi.entry.length < c.len) pinUi.entry += v;
      if (pinUi.entry.length === c.len) {
        const tryPin = pinUi.entry;
        void lock.checkPin(tryPin).then((ok) => { if (ok) { lock.unlock(); pinUi.entry = ""; pinUi.forgot = false; render(); void cloud.pull(); } else { pinUi.entry = ""; pinUi.error = "Wrong passcode. Try again."; render(); } });
      }
      render(); return;
    }
    case "faceunlock": void lock.unlockWithFaceId().then((ok) => { if (ok) { lock.unlock(); render(); void cloud.pull(); } }); return;
    case "forgot": pinUi.forgot = true; render(); return;
    case "forgotno": pinUi.forgot = false; render(); return;
    case "erase": {
      void cloud.signOut().finally(() => {
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("gameplan")) localStorage.removeItem(k); } catch { /* ignore */ }
        location.reload();
      });
      return;
    }
    case "pinset": pinUi.entry = ""; pinUi.first = ""; pinUi.step = "new"; pinUi.error = ""; ui.sheet = { type: "pin" }; break;
    case "pinsetkey": {
      pinUi.error = "";
      const max = pinUi.step === "confirm" ? pinUi.first.length : 6;
      if (v === "del") pinUi.entry = pinUi.entry.slice(0, -1); else if (pinUi.entry.length < max) pinUi.entry += v;
      sheet(); return;
    }
    case "pinnext": {
      if (pinUi.entry.length < 4) return;
      if (pinUi.step === "new") { pinUi.first = pinUi.entry; pinUi.entry = ""; pinUi.step = "confirm"; sheet(); return; }
      if (pinUi.entry !== pinUi.first) { pinUi.entry = ""; pinUi.first = ""; pinUi.step = "new"; pinUi.error = "Those didn't match. Start again."; sheet(); return; }
      void lock.setPin(pinUi.entry).then(() => {
        pinUi.entry = ""; pinUi.first = "";
        ui.sheet = lock.faceIdSupported() ? { type: "faceoffer" } : null;
        render(); toast("Passcode set. Game Plan will ask for it when it opens.");
      });
      return;
    }
    case "hidelockhint": try { localStorage.setItem("gameplan:hide-lockhint", "1"); } catch { /* ignore */ } break;
    case "sched": ui.sched = !ui.sched; break;
    case "weekinfo": { const ws = v, xs = schedule(S, TODAY, S.settings.maxActive).items.filter((x) => x.start <= add(ws, 6) && x.end > ws); toast(`Week of ${fmt(ws)}: ${xs.map((x) => x.h.name).join(", ") || "nothing scheduled"}`); return; }
    case "focusedit": ui.sheet = { type: "focus" }; break;
    case "focusauto": S.settings.focusTitle = ""; ui.sheet = null; toast("Using the suggested name."); break;
    case "focussave": S.settings.focusTitle = field("focustitle").trim(); ui.sheet = null; toast("Focus renamed."); break;
    case "lockoff": lock.removeLock(); toast("App lock is off."); break;
    case "faceon": void lock.enableFaceId().then(() => { ui.sheet = null; render(); toast("Face ID is on."); }).catch((err: Error) => toast(err.message || "Face ID wasn't set up.")); return;
    case "faceoff": lock.disableFaceId(); break;
    case "sendcode": {
      const email = (($("authemail") as HTMLInputElement).value || "").trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { toast("Enter your email address."); return; }
      auth.email = email; auth.busy = true; render();
      void cloud.sendCode(email).then(() => { auth.sent = true; toast("Code sent. Check your email."); })
        .catch((err: Error) => toast(err.message.includes("rate") ? "Too many tries. Wait a few minutes and try again." : "Couldn't send the code. Try again."))
        .finally(() => { auth.busy = false; render(); });
      return;
    }
    case "verifycode": {
      const code = (($("authcode") as HTMLInputElement).value || "").replace(/\D/g, "");
      if (code.length < 6) { toast("Enter the code from the email."); return; }
      auth.busy = true; render();
      void cloud.verifyCode(auth.email, code).then(() => { auth.sent = false; toast(S.habits.length ? "Signed in. Your plan is synced." : "Signed in, but nothing is synced yet. Turn on sync on your phone, then tap Sync now here."); })
        .catch(() => toast("That code didn't work. Check it, or send a new one."))
        .finally(() => { auth.busy = false; render(); });
      return;
    }
    case "authback": auth.sent = false; break;
    case "authmode": { const em = document.getElementById("authemail") as HTMLInputElement | null; if (em) auth.email = em.value.trim(); auth.mode = v as typeof auth.mode; break; }
    case "pwsignin": {
      const email = field("authemail").trim(), pw = field("authpw");
      if (!email || !pw) { toast("Enter your email and password."); return; }
      auth.email = email; auth.busy = true; render();
      void cloud.signInPassword(email, pw).then(() => toast(S.habits.length ? "Signed in. Your plan is synced." : "Signed in, but nothing is synced yet. Sign in on your phone too."))
        .catch(() => toast("That email and password don't match. First time? Use the First time tab."))
        .finally(() => { auth.busy = false; render(); });
      return;
    }
    case "pwsetup": {
      const email = field("authemail").trim(), code = field("authsetup").trim(), pw = field("authnew"), pw2 = field("authnew2");
      if (!email || !code) { toast("Enter your email and the setup code."); return; }
      if (pw.length < 8) { toast("Use at least 8 characters for the password."); return; }
      if (pw !== pw2) { toast("The two passwords don't match."); return; }
      auth.email = email; auth.busy = true; render();
      void cloud.setupPassword(email, code, pw).then(() => { auth.mode = "password"; toast("Password saved. You're signed in."); })
        .catch((err: Error) => toast(err.message))
        .finally(() => { auth.busy = false; render(); });
      return;
    }
    case "syncnow": void cloud.syncNow().then(() => { render(); toast(cloud.syncInfo().status === "error" ? "Couldn't reach the server." : "Synced."); }); return;
    case "signout": void cloud.disableReminders().catch(() => {}).finally(() => cloud.signOut().then(() => { remindersEnabled = false; render(); toast("Signed out. Your data stays on this phone."); })); return;
    case "remon": void cloud.enableReminders(reminderList(S.settings)).then(() => { remindersEnabled = true; render(); toast("Reminders are on."); }).catch((err: Error) => toast(err.message)); return;
    case "remoff": void cloud.disableReminders().then(() => { remindersEnabled = false; render(); toast("Reminders are off on this phone."); }); return;
    case "remtest": void cloud.testReminder().then(() => toast("Test sent. It should arrive in a few seconds.")).catch((err: Error) => toast(err.message)); return;
    case "remtoggle": {
      const key = id as keyof State["settings"]["reminders"];
      S.settings.reminders[key] = !S.settings.reminders[key];
      void cloud.updateReminders(reminderList(S.settings)).catch(() => {});
      break;
    }
    default: return;
  }
  save(); render();
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.note) { ck(ui.view).notes[el.dataset.note] = el.value; save(); return; }
  if (el.type === "range" && el.dataset.metric) {
    const v = +el.value;
    el.classList.remove("unset");
    el.style.setProperty("--p", ((v - 1) / 9) * 100 + "%");
    const q = document.getElementById("qv-" + el.dataset.metric);
    if (q) { q.textContent = String(v); q.classList.remove("unset"); }
    ck(ui.view).m[el.dataset.metric] = v;
    save();
  }
}
function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.id === "importfile") { const f = el.files?.[0]; if (f) void importBackup(f); el.value = ""; return; }
  if (el.id === "trend") { ui.trend = el.value; render(); return; }
  if (el.id === "lockafter") { lock.setAfter(+el.value); return; }
  if (el.dataset.metric && el.type !== "range") { ck(ui.view).m[el.dataset.metric] = el.value === "" ? null : +el.value; save(); return; }
  if (el.dataset.pt) { const x = parseInt(el.value, 10); if (isFinite(x) && x >= 0) { (S.pts as unknown as Record<string, number>)[el.dataset.pt] = x; save(); render(); } return; }
  const key = el.dataset.set;
  if (!key) return;
  const s = S.settings as unknown as Record<string, unknown>;
  if (["birth", "lightsOut", "wake"].includes(key)) { if (el.value) s[key] = el.value; }
  else { const x = parseFloat(el.value); if (!isFinite(x)) return; s[key] = key === "lifeExp" ? x : Math.round(x); }
  const t = S.settings;
  t.maxActive = Math.max(1, Math.min(6, t.maxActive));
  t.dailyTarget = Math.max(1, Math.min(t.dailyWindow, t.dailyTarget));
  t.weeklyTarget = Math.max(1, Math.min(t.weeklyWindow, t.weeklyTarget));
  t.pauseMin = Math.max(1, Math.min(t.pauseWindow, t.pauseMin));
  if (key === "lightsOut" || key === "wake") void cloud.updateReminders(reminderList(S.settings)).catch(() => {});
  save(); render();
}

export function start() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.sheet) { ui.sheet = null; render(); } });
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  window.addEventListener("resize", () => { if (ui.grid) drawGrid(); });
  // An installed app can sit in memory overnight: re-render when it comes back so the date rolls over.
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    lock.onVisibility(visible);
    if (visible) { render(); if (!lock.isLocked()) void cloud.pull(); }
  });
  void navigator.storage?.persist?.();
  render();
  void cloud.initCloud({
    get: () => S,
    set: (s) => { S = s; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } },
    changed: () => { if (!lock.isLocked()) render(); },
    today: () => TODAY,
  }).then(async () => { remindersEnabled = await cloud.remindersOn().catch(() => false); if (!lock.isLocked()) render(); });
}
