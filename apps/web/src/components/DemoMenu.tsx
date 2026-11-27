"use client";

import { useEffect, useId, useRef, useState } from "react";
import { shortDate } from "@/lib/dates";
import type { IsoDate } from "@second-half/contracts";

export type DemoAction = "week" | "day" | "reset";

/** Demo controls: move the calendar and restart. The game is saved on this device only. */
export function DemoMenu({ date, busy, onAction }: { date: IsoDate; busy: boolean; onAction: (a: DemoAction) => void }) {
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

  const act = (a: DemoAction) => {
    setOpen(false);
    onAction(a);
  };

  return (
    <div className="demo" ref={wrap}>
      <button className="iconbtn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Demo
      </button>
      {open ? (
        <div className="menu" id={id} role="menu">
          <p>Today in the game: {shortDate(date)}. Saved on this device only.</p>
          <button role="menuitem" disabled={busy} onClick={() => act("day")}>
            Skip to tomorrow
          </button>
          <button role="menuitem" disabled={busy} onClick={() => act("week")}>
            Let a week pass
          </button>
          <button role="menuitem" disabled={busy} onClick={() => act("reset")}>
            Restart with the sample player
          </button>
        </div>
      ) : null}
    </div>
  );
}
