"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Bottom sheet over the scene. Escape or a tap on the scrim closes it. */
export function Sheet({ open, title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden="true" />
      <section
        ref={ref}
        className={`sheet${open ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
      >
        <div className="grab" />
        <div className="sh">
          <h2>{title}</h2>
          <button className="xbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sb">{children}</div>
        {footer ? <div className="sf">{footer}</div> : null}
      </section>
    </>
  );
}
