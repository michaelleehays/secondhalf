"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * "side": docked to the right on wide screens; on phones it opens at a half-height detent (the
   * handle expands it), so the scene stays visible beside or above it.
   */
  variant?: "side";
}

/** Bottom sheet over the scene. Escape or a tap on the scrim closes it. */
export function Sheet({ open, title, onClose, children, footer, variant }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Every open starts at the first detent.
  useEffect(() => {
    if (open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`scrim${open ? " on" : ""}${variant ? " clear" : ""}`} onClick={onClose} aria-hidden="true" />
      <section
        ref={ref}
        className={`sheet${variant ? ` ${variant}` : ""}${open ? " on" : ""}${expanded ? " expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
      >
        {variant ? (
          <button className="grab-btn" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded} aria-label={expanded ? "Show less" : "Show more"}>
            <span className="grab" />
          </button>
        ) : (
          <div className="grab" />
        )}
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
