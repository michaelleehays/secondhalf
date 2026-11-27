// Weekly rollover. Called once an hour by pg_cron (see migration 20261127000500_weekly_rollover.sql).
// All the logic lives in packages/api (runWeeklyRollover); this only checks the caller, makes a
// service-role client, reads the clock and returns the report.
import { createClient } from "@supabase/supabase-js";
import { engineCloseWeek, runWeeklyRollover } from "@second-half/api/weekly";

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  // Only the scheduler (holding the service-role key) may run this. A signed-in player's JWT is refused.
  if (!serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "Only the weekly job can call this." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const report = await runWeeklyRollover(supabase, engineCloseWeek(), new Date());
  return new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } });
});
