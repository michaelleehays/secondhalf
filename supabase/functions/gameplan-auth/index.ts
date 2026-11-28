// Game Plan: set a password with a one-time setup code (see migration 20261128000100).
// POST {email, code, password}. verify_jwt is off: the setup code is the proof.
// The password goes straight to Supabase Auth; nothing here stores or logs it.
import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const { email, code, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof code !== "string" || typeof password !== "string") return json({ error: "Email, setup code and password are all needed." }, 400);
  if (password.length < 8) return json({ error: "Use at least 8 characters for the password." }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: userId, error } = await db.rpc("gameplan_claim_setup_code", { p_email: email, p_code: code });
  if (error) { console.error(error); return json({ error: "Something went wrong. Try again." }, 500); }
  if (!userId) return json({ error: "That email and setup code don't match, or the code has expired." }, 403);
  const { error: e2 } = await db.auth.admin.updateUserById(userId as string, { password });
  if (e2) { console.error(e2.message); return json({ error: e2.message.includes("weak") ? "Pick a stronger password." : "Couldn't save the password. Try again." }, 400); }
  return json({ ok: true });
});
