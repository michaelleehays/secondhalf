"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createGameApi } from "@second-half/api";
import { createLocalAdapter } from "@/lib/adapter";
import { createRemoteAdapter } from "@/lib/remoteAdapter";
import { browserStore } from "@/lib/storage";
import { supabaseClient, supabaseConfig } from "@/lib/supabase";
import { AccountMenu } from "./AccountMenu";
import { Home } from "./Home";
import { SignIn } from "./SignIn";

const config = supabaseConfig();

/**
 * Picks the game the app runs. Without Supabase env vars (local dev, tests) it is the local sample
 * game, as before. With them, the player signs in with a magic link and plays their own saved game;
 * "Try the sample game" keeps the local one available without an account.
 */
export function App() {
  if (!config) return <Home />;
  return <SignedInApp />;
}

/** Where the magic link brings the player back to: this page, without any old auth fragments. */
const returnUrl = () => `${window.location.origin}${window.location.pathname}`;

/** An auth error the redirect may carry in its hash or query, e.g. an expired link. */
function redirectError(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const desc = params.get("error_description");
  return desc ? `That sign-in link didn't work (${desc.replace(/\+/g, " ")}). Send a new one.` : null;
}

function SignedInApp() {
  const supabase = useMemo(() => supabaseClient(config!), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [demo, setDemo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNotice(redirectError());
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Tidy the URL once the link's tokens have been read.
      if (s && /access_token|refresh_token|[?&]code=/.test(window.location.href)) window.history.replaceState(null, "", returnUrl());
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const userId = session?.user.id ?? null;
  const adapter = useMemo(
    () =>
      userId
        ? createRemoteAdapter({
            api: createGameApi(supabase),
            userId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          })
        : null,
    [supabase, userId],
  );

  const demoAdapter = useMemo(() => (demo ? createLocalAdapter({ store: browserStore() }) : null), [demo]);

  if (session === undefined) return <div className="loading">Loading your game…</div>;
  if (adapter && session) {
    return (
      <Home
        key={session.user.id}
        adapter={adapter}
        account={<AccountMenu email={session.user.email ?? "your account"} onSignOut={() => void supabase.auth.signOut()} />}
      />
    );
  }
  if (demoAdapter) return <Home key="demo" adapter={demoAdapter} />;
  return (
    <SignIn
      notice={notice}
      onTryDemo={() => setDemo(true)}
      sendLink={async (email) => {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl(), shouldCreateUser: true } });
        return { error: error ? `We couldn't send the link: ${error.message}` : null };
      }}
    />
  );
}
