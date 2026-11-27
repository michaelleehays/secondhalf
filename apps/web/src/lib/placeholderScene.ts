import { AREAS, type AreaId, type CreateScene, type GameEvent, type Level, type SceneHandle, type SceneTarget, type WorldView } from "@second-half/contracts";
import { AREA_META } from "./labels";

/**
 * A flat stand-in for workstream C's three.js scene. It implements the same SceneHandle so the
 * home screen can be built and tested now: a top-down ring map (101 outside, the Vision at the
 * center), the athlete as a dot on the current ring, and Resistance markers on the edge.
 * Like the real scene, it only draws the WorldView it is given and animates events. No game logic.
 */
export const createPlaceholderScene: CreateScene = async (container) => {
  const canvas = document.createElement("canvas");
  canvas.className = "scene-canvas";
  canvas.setAttribute("aria-label", "Map of your five areas. Tap an area, your athlete or the summit.");
  canvas.setAttribute("role", "img");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let view: WorldView | null = null;
  let focus: SceneTarget = { kind: "home" };
  let flash: { color: string; start: number } | null = null;
  let selectCb: ((t: SceneTarget & { level?: Level }) => void) | null = null;
  let frame = 0;
  let disposed = false;

  const geom = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Leave room for the HUD on top and the dock at the bottom.
    const cx = w / 2;
    const cy = h * 0.5;
    // Keep the area labels, drawn just outside the rim, on screen at phone width.
    const R = Math.max(60, Math.min(w / 2 - 56, h * 0.3));
    return { w, h, cx, cy, R, ring: (lv: number) => R * (1 - (lv - 1) * 0.2), vision: R * 0.2 };
  };

  /** Each area owns a 72° slice, starting at the top and going clockwise. */
  const sliceStart = (i: number) => -Math.PI / 2 - Math.PI / 5 + (i * 2 * Math.PI) / 5;

  const draw = (now: number) => {
    frame = 0;
    if (!ctx || disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { w, h, cx, cy, R, ring, vision } = geom();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(w, h));
    bg.addColorStop(0, "#1a1d22");
    bg.addColorStop(1, "#0B0D10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (!view) return;

    const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 280);
    let animating = false;

    AREAS.forEach((area, i) => {
      const a0 = sliceStart(i);
      const a1 = a0 + (2 * Math.PI) / 5;
      const dim = focus.kind === "area" && focus.area !== area ? 0.45 : 1;
      for (let lv = 1; lv <= 4; lv++) {
        const cell = view!.cells.find((c) => c.area === area && c.level === lv);
        const outer = ring(lv);
        const inner = lv === 4 ? vision : ring(lv + 1);
        const status = cell?.status ?? "hidden";
        const color = AREA_META[area].color;
        let alpha = 0.06;
        let fill = color;
        if (status === "locked_in") alpha = 0.62;
        else if (status === "in_progress") alpha = 0.18;
        else if (status === "open") alpha = 0.1;
        else if (status === "at_risk") {
          fill = "#E5484D";
          alpha = 0.25 + 0.3 * pulse;
          animating = !reduceMotion;
        } else if (status === "lost") fill = "#3a1416";
        if (status === "lost") alpha = 0.8;
        if (cell?.frozen) alpha *= 0.55;
        sector(ctx, cx, cy, inner, outer, a0, a1, fill, alpha * dim);
        if (status === "in_progress" && cell) {
          // Progress edge: the filled share of the slice, sweeping clockwise.
          sector(ctx, cx, cy, inner, outer, a0, a0 + (a1 - a0) * cell.progress, color, 0.55 * dim);
        }
        if (status === "open") dashedArc(ctx, cx, cy, (inner + outer) / 2, a0 + 0.05, a1 - 0.05, color);
      }
      // Area label on the outer rim.
      const mid = (a0 + a1) / 2;
      ctx.fillStyle = AREA_META[area].color;
      ctx.globalAlpha = dim;
      ctx.font = "800 14px Archivo, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(AREA_META[area].name, cx + Math.cos(mid) * (R + 18), cy + Math.sin(mid) * (R + 18));
      ctx.globalAlpha = 1;
    });

    // Ring and slice lines.
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    for (let lv = 1; lv <= 4; lv++) circle(ctx, cx, cy, ring(lv));
    circle(ctx, cx, cy, vision);
    AREAS.forEach((_, i) => {
      const a = sliceStart(i);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * vision, cy + Math.sin(a) * vision);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    });

    // The Vision at the summit.
    ctx.fillStyle = "#E8C15A";
    ctx.globalAlpha = 0.85;
    diamond(ctx, cx, cy, 7);
    ctx.globalAlpha = 1;

    // Resistance markers sit just outside the slice they target.
    view.resistance.forEach((r) => {
      const i = AREAS.indexOf(r.targetArea);
      const a = sliceStart(i) + (2 * Math.PI) / 5 * 0.82;
      const d = R + 38;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      ctx.fillStyle = "#E5484D";
      ctx.globalAlpha = 0.35 + r.strength * 0.13;
      diamond(ctx, x, y, 4 + r.strength * 1.3);
      ctx.globalAlpha = 1;
      if (r.attackingGoalId) {
        ctx.strokeStyle = "rgba(229,72,77,.8)";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        const mid = sliceStart(i) + Math.PI / 5;
        ctx.lineTo(cx + Math.cos(mid) * ring(1) * 0.9, cy + Math.sin(mid) * ring(1) * 0.9);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // The athlete stands at the bottom of the ring for the current level.
    const ay = cy + (ring(Math.min(view.level, 4)) + ring(Math.min(view.level, 4) + 1)) / 2;
    const ar = focus.kind === "athlete" ? 11 : 8;
    ctx.fillStyle = view.athlete.knockedDown ? "#9A9CA3" : "#FF6A2B";
    ctx.beginPath();
    ctx.arc(cx, ay, ar, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,106,43,.5)";
    ctx.lineWidth = 2;
    circle(ctx, cx, ay, ar + 5 + (reduceMotion ? 0 : pulse * 3));
    ctx.lineWidth = 1;
    ctx.fillStyle = "#F1EFEA";
    ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillText("YOU", cx, ay + ar + 14);
    if (!reduceMotion) animating = true;

    if (flash) {
      const t = (now - flash.start) / 800;
      if (t >= 1) flash = null;
      else {
        const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.max(w, h) * 0.8);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, flash.color);
        ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        animating = true;
      }
    }
    if (animating) schedule();
  };

  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  };

  const ro = new ResizeObserver(schedule);
  ro.observe(canvas);

  const onClick = (ev: MouseEvent) => {
    if (!selectCb || !view) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const { cx, cy, R, ring, vision } = geom();
    const lv = Math.min(view.level, 4);
    const ay = cy + (ring(lv) + ring(lv + 1)) / 2;
    if (Math.hypot(x - cx, y - ay) < 22) return selectCb({ kind: "athlete" });
    const d = Math.hypot(x - cx, y - cy);
    if (d <= vision) return selectCb({ kind: "vision", level: 5 });
    if (d > R) return selectCb({ kind: "home" });
    let ang = Math.atan2(y - cy, x - cx) - sliceStart(0);
    ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const area = AREAS[Math.floor(ang / ((2 * Math.PI) / 5))] as AreaId;
    const level = ([1, 2, 3, 4] as const).find((l) => d <= ring(l) && d > (l === 4 ? vision : ring(l + 1))) ?? 1;
    selectCb({ kind: "area", area, level });
  };
  canvas.addEventListener("click", onClick);

  const handle: SceneHandle = {
    update(next) {
      view = next;
      schedule();
    },
    play(event: GameEvent) {
      const bad = ["setback", "ground_lost", "level_lost", "knocked_down", "at_risk"];
      const good = ["locked_in", "level_up", "risk_cleared", "recovery_ended"];
      if (bad.includes(event.type)) flash = { color: "rgba(200,30,40,.55)", start: performance.now() };
      else if (good.includes(event.type)) flash = { color: "rgba(255,170,60,.4)", start: performance.now() };
      schedule();
    },
    focus(target) {
      focus = target;
      schedule();
    },
    onSelect(cb) {
      selectCb = cb;
    },
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      canvas.removeEventListener("click", onClick);
      canvas.remove();
    },
  };
  return handle;
};

function sector(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, color: string, alpha: number) {
  if (a1 <= a0) return;
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function dashedArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  ctx.restore();
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
}
