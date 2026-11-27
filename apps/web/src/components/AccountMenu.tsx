"use client";

import { useEffect, useId, useRef, useState } from "react";

/** The signed-in player's menu in the HUD: who's signed in, and sign out. */
export function AccountMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <div className="demo" ref={wrap}>
      <button className="iconbtn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Account
      </button>
      {open ? (
        <div className="menu" id={id} role="menu">
          <p>Signed in as {email}. Your game saves to your account.</p>
          <button role="menuitem" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
