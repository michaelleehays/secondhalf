// Weekly rollover. Called once an hour by pg_cron (see migration 20261127000500_weekly_rollover.sql).
// All the logic lives in packages/api (runWeeklyRollover); this only checks the caller, makes a
// service-role client, reads the clock and returns counts.
//
// verify_jwt is off for this function (supabase/config.jsonc): the caller is the scheduler, not a
// signed-in player. Instead it must send X-Close-Week-Secret matching the CLOSE_WEEK_SECRET function secret.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "@std/crypto/timing-safe-equal";
import { engineCloseWeek, rolloverCounts, runWeeklyRollover } from "@second-half/api/weekly";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** Constant-time comparison: hash both sides so lengths match, then compare every byte. */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  return timingSafeEqual(await sha256(given), await sha256(expected));
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CLOSE_WEEK_SECRET") ?? "";
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!secret || !(await secretMatches(req.headers.get("X-Close-Week-Secret") ?? "", secret))) {
    return json({ error: "Only the weekly job can call this." }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const report = await runWeeklyRollover(supabase, engineCloseWeek(), new Date());
  // pg_net stores responses, so return counts only. Details go to the function log, without player ids.
  for (const f of report.failed) console.error(`close-week: a rollover failed and will retry: ${f.error}`);
  return json(rolloverCounts(report));
});
