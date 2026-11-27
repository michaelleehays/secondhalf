"use client";

import { useEffect, useRef } from "react";
import type { CreateScene, Level, SceneHandle, SceneTarget, WorldView } from "@second-half/contracts";
import { createPlaceholderScene } from "@/lib/placeholderScene";

interface Props {
  view: WorldView | null;
  /** Workstream C's createScene drops in here. Until then, the flat placeholder map. */
  createScene?: CreateScene;
  assetsBaseUrl?: string;
  onReady?: (scene: SceneHandle) => void;
  onSelect?: (target: SceneTarget & { level?: Level }) => void;
}

/** Full-screen slot that owns the scene's lifetime. Draws `view`; events are played through the handle. */
export function SceneSlot({ view, createScene = createPlaceholderScene, assetsBaseUrl = "/assets", onReady, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const latest = useRef({ view, onReady, onSelect });
  latest.current = { view, onReady, onSelect };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let handle: SceneHandle | null = null;
    createScene(el, { assetsBaseUrl }).then((h) => {
      if (cancelled) return h.dispose();
      handle = h;
      scene.current = h;
      h.onSelect((t) => latest.current.onSelect?.(t));
      if (latest.current.view) h.update(latest.current.view);
      latest.current.onReady?.(h);
    });
    return () => {
      cancelled = true;
      handle?.dispose();
      scene.current = null;
    };
  }, [createScene, assetsBaseUrl]);

  useEffect(() => {
    if (view) scene.current?.update(view);
  }, [view]);

  return <div ref={host} className="scene-slot" data-testid="scene-slot" />;
}
