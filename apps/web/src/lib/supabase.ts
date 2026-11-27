import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * The Supabase project, from NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (set on Vercel for production, preview and development). Null when either is missing, e.g. local
 * dev and tests: the app then runs the local sample game.
 */
export function supabaseConfig(env: { url?: string; key?: string } = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}): SupabaseConfig | null {
  const url = env.url?.trim();
  const publishableKey = env.key?.trim();
  if (!url || !publishableKey) return null;
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

let client: SupabaseClient | null = null;

/** One browser client for the app. The session lives in localStorage and is picked up from magic-link redirects. */
export function supabaseClient(config: SupabaseConfig): SupabaseClient {
  if (!client) {
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
