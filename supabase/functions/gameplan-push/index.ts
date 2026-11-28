// Game Plan reminders over Web Push (see migration 20261127001200_gameplan.sql).
//
// verify_jwt is off: callers prove themselves another way.
//   GET  ?action=key           anyone: the VAPID public key the app subscribes with (created on first use).
//   POST {action: "cron"}      the scheduler, with X-Gameplan-Secret: sends reminders that are due.
//   POST {action: "test"}      a signed-in user (Authorization: Bearer <access token>): one test push to their devices.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "@std/crypto/timing-safe-equal";
import webpush from "web-push";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sha256 = async (t: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const secretMatches = async (given: string, expected: string) => !!expected && timingSafeEqual(await sha256(given), await sha256(expected));

/** How late a reminder may still go out (cron runs every 5 minutes and can lag). */
const WINDOW_MIN = 15;
const SUBJECT = "https://gameplan-neon-phi.vercel.app";

interface Reminder { id: string; time: string; days?: number[] | null; title: string; body: string }
interface Sub { endpoint: string; user_id: string; p256dh: string; auth: string; timezone: string; reminders: Reminder[]; last_sent: Record<string, string> }

function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function config(db: SupabaseClient) {
  const { data, error } = await db.rpc("gameplan_push_config");
  if (error) throw error;
  let cfg = data as { cron_secret: string; vapid_public: string | null; vapid_private: string | null };
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    const { data: stored, error: e2 } = await db.rpc("gameplan_store_vapid", { p_public: k.publicKey, p_private: k.privateKey });
    if (e2) throw e2;
    cfg = { ...cfg, ...(stored as { vapid_public: string; vapid_private: string }) };
  }
  webpush.setVapidDetails(SUBJECT, cfg.vapid_public!, cfg.vapid_private!);
  return cfg;
}

/** The device's local date (YYYY-MM-DD), minutes since midnight and weekday (0 = Sunday). */
export function localNow(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: days.indexOf(parts.weekday!) };
}

/** Reminders due now: at or past their time, inside the window, on an allowed weekday, not yet sent today. */
export function dueReminders(sub: Pick<Sub, "timezone" | "reminders" | "last_sent">, now: Date) {
  const L = localNow(now, sub.timezone);
  return sub.reminders.filter((r) => {
    const [h, m] = r.time.split(":").map(Number);
    const at = h! * 60 + m!, late = L.minutes - at;
    if (late < 0 || late >= WINDOW_MIN) return false;
    if (r.days && r.days.length && !r.days.includes(L.weekday)) return false;
    return sub.last_sent?.[r.id] !== L.date;
  }).map((r) => ({ r, date: L.date }));
}

async function send(db: SupabaseClient, sub: Sub, payload: Record<string, unknown>) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 30, urgency: "high" });
    return "sent";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) { await db.from("gameplan_push_subscriptions").delete().eq("endpoint", sub.endpoint); return "gone"; }
    console.error("push failed", code, (e as Error).message);
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const db = admin();
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.get("action") !== "key") return json({ error: "Unknown action." }, 400);
      const cfg = await config(db);
      return json({ publicKey: cfg.vapid_public });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
    const body = await req.json().catch(() => ({}));
    const cfg = await config(db);

    if (body.action === "cron") {
      if (!(await secretMatches(req.headers.get("x-gameplan-secret") ?? "", cfg.cron_secret))) return json({ error: "Only the reminder job can call this." }, 403);
      const { data, error } = await db.from("gameplan_push_subscriptions").select("*");
      if (error) throw error;
      const now = new Date();
      let sent = 0, skipped = 0;
      for (const sub of (data ?? []) as Sub[]) {
        let due: ReturnType<typeof dueReminders>;
        try { due = dueReminders(sub, now); } catch { skipped++; continue; }
        if (!due.length) continue;
        const lastSent = { ...(sub.last_sent ?? {}) };
        for (const { r, date } of due) {
          const res = await send(db, sub, { title: r.title, body: r.body, tag: r.id, url: "/#today" });
          if (res === "gone") break;
          lastSent[r.id] = date;
          if (res === "sent") sent++;
        }
        await db.from("gameplan_push_subscriptions").update({ last_sent: lastSent }).eq("endpoint", sub.endpoint);
      }
      return json({ sent, skipped });
    }

    if (body.action === "test") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u, error } = await db.auth.getUser(token);
      if (error || !u.user) return json({ error: "Sign in first." }, 401);
      const { data: subs } = await db.from("gameplan_push_subscriptions").select("*").eq("user_id", u.user.id);
      const results = [];
      for (const sub of (subs ?? []) as Sub[]) results.push(await send(db, sub, { title: "Game Plan", body: "Reminders are on. This is what they look like.", tag: "test", url: "/#today" }));
      return json({ devices: results.length, results });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong sending reminders." }, 500);
  }
});
