"use client";

import { useState } from "react";
import { DEFAULT_RULES } from "@second-half/contracts";

export type SendLink = (email: string) => Promise<{ error: string | null }>;

/** Magic-link sign-in: one email field, then "check your email". No passwords. */
export function SignIn({ sendLink, onTryDemo, notice }: { sendLink: SendLink; onTryDemo: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError("That email doesn't look right. Check it and try again.");
    setBusy(true);
    setError(null);
    const { error: err } = await sendLink(address);
    setBusy(false);
    if (err) return setError(err);
    setSentTo(address);
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Second Half</h1>
        <p className="muted">
          You&apos;re {DEFAULT_RULES.life.startAge}. The game ends at {DEFAULT_RULES.life.defaultEndAge}. Lock in goals across Body, Mind, Work, People and Money.
        </p>
        {sentTo ? (
          <div className="coach" role="status">
            <span className="who">Check your email</span>
            We sent a sign-in link to <b>{sentTo}</b>. Open it on this device and you&apos;ll land back here, signed in.
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary" disabled={busy}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
        <p className={`small outcome bad`} role="alert">
          {error ?? ""}
        </p>
        {sentTo ? (
          <button className="btn" onClick={() => setSentTo(null)}>
            Use a different email
          </button>
        ) : null}
        <button className="linkbtn" onClick={onTryDemo}>
          Try the sample game without an account
        </button>
      </div>
    </main>
  );
}
