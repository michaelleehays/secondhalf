// Sign-in, sync and reminders through Supabase. Everything here is optional: without the two
// VITE_SUPABASE_* variables the app runs on the device only.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { mergeStates, normalize, type State } from "./logic";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
const META = "gameplan:sync";
const FN = () => `${URL_}/functions/v1/gameplan-push`;

export const cloudAvailable = !!(URL_ && KEY);
const sb: SupabaseClient | null = cloudAvailable
  ? createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "gameplan:auth" } })
  : null;

interface Meta { last: string | null; dirty: boolean; at: string | null }
const readMeta = (): Meta => { try { return { last: null, dirty: false, at: null, ...JSON.parse(localStorage.getItem(META) ?? "{}") }; } catch { return { last: null, dirty: false, at: null }; } };
const writeMeta = (m: Meta) => { try { localStorage.setItem(META, JSON.stringify(m)); } catch { /* ignore */ } };

interface Hooks { get: () => State; set: (s: State) => void; changed: () => void; today: () => string }
let hooks: Hooks;
let session: Session | null = null;
export let syncStatus: "off" | "syncing" | "synced" | "error" = "off";
export const syncInfo = () => ({ email: session?.user.email ?? null, ...readMeta(), status: syncStatus });

export async function initCloud(h: Hooks) {
  hooks = h;
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  session = data.session;
  // Arrived from an emailed sign-in link: drop the tokens from the address bar.
  if (/access_token=|error_description=/.test(location.hash)) history.replaceState(null, "", location.pathname + "#settings");
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
  if (session) void pull();
}

export async function sendCode(email: string) {
  if (!sb) throw new Error("Sync isn't set up.");
  // The code works everywhere. The link also works on a computer, as long as this site is on the
  // project's allowed redirect list; otherwise Supabase sends the link to its main Site URL.
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/` } });
  if (error) throw error;
}
export async function verifyCode(email: string, token: string) {
  if (!sb) throw new Error("Sync isn't set up.");
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  session = data.session;
  await pull();
}
export async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
  session = null;
  writeMeta({ last: null, dirty: false, at: null });
  syncStatus = "off";
}

/* ---------- sync ---------- */
let timer: number | undefined;
let busy = false;
/** Call after every local save. Pushes 2 seconds after the last change. */
export function markDirty() {
  const m = readMeta();
  if (!m.dirty) writeMeta({ ...m, dirty: true });
  if (!session) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void push(), 2000);
}
async function push() {
  if (!sb || !session || busy) return;
  busy = true; syncStatus = "syncing";
  try {
    const { data, error } = await sb.from("gameplan_states")
      .upsert({ user_id: session.user.id, state: hooks.get(), updated_at: new Date().toISOString(), device: navigator.platform || "device" })
      .select("updated_at").single();
    if (error) throw error;
    writeMeta({ last: data.updated_at as string, dirty: false, at: new Date().toISOString() });
    syncStatus = "synced";
  } catch { syncStatus = "error"; }
  finally { busy = false; }
}
/** Bring in changes made on another device. Local unsynced changes are merged, never dropped. */
export async function pull() {
  if (!sb || !session || busy) return;
  busy = true; syncStatus = "syncing";
  let then: (() => Promise<void>) | null = null;
  try {
    const { data, error } = await sb.from("gameplan_states").select("state, updated_at").eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    const m = readMeta();
    if (!data) then = push;
    else if (data.updated_at === m.last) { if (m.dirty) then = push; else syncStatus = "synced"; }
    else {
      const remote = normalize(data.state, hooks.today());
      if (remote) {
        const local = hooks.get();
        const hasLocal = Object.keys(local.logs).length > 0 || Object.keys(local.checkins).length > 0 || local.habits.length > 0;
        if (m.dirty && hasLocal) { hooks.set(mergeStates(local, remote)); writeMeta({ ...m, last: data.updated_at as string }); then = push; }
        else { hooks.set(remote); writeMeta({ last: data.updated_at as string, dirty: false, at: new Date().toISOString() }); syncStatus = "synced"; }
        hooks.changed();
      }
    }
  } catch { syncStatus = "error"; }
  finally { busy = false; }
  if (then) await then();
}
export const syncNow = async () => { await pull(); };

/* ---------- reminders (Web Push) ---------- */
export interface Reminder { id: string; time: string; days: number[] | null; title: string; body: string }

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const pushPermission = () => (("Notification" in window) ? Notification.permission : "unsupported");

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
export async function remindersOn() { if (!pushSupported()) return false; return !!(await currentSub()); }

/** Ask for permission (must be called from a tap), subscribe this device, and store its reminders. */
export async function enableReminders(reminders: Reminder[]) {
  if (!sb || !session) throw new Error("Sign in first, so reminders know where to go.");
  if (!pushSupported()) throw new Error("Open Game Plan from your home screen icon to turn on reminders.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are off for Game Plan. Turn them on in iPhone Settings → Notifications → Game Plan.");
  const { publicKey } = await (await fetch(`${FN()}?action=key`)).json();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  await saveSub(sub, reminders);
}
async function saveSub(sub: PushSubscription, reminders: Reminder[]) {
  const j = sub.toJSON();
  const { error } = await sb!.from("gameplan_push_subscriptions").upsert({
    endpoint: sub.endpoint, user_id: session!.user.id, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
/** Re-save the reminder times (after a settings change). Quietly does nothing if reminders are off. */
export async function updateReminders(reminders: Reminder[]) {
  if (!sb || !session || !pushSupported()) return;
  const sub = await currentSub();
  if (sub) await saveSub(sub, reminders);
}
export async function disableReminders() {
  if (!pushSupported()) return;
  const sub = await currentSub();
  if (!sub) return;
  if (sb && session) await sb.from("gameplan_push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
export async function testReminder() {
  if (!session) throw new Error("Sign in first.");
  const r = await fetch(FN(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: "test" }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "That didn't work.");
  if (!j.devices) throw new Error("This phone isn't set up for reminders yet.");
}
