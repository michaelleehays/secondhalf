/**
 * Screen framing for focused shots. Pure: no three.js.
 *
 * The app reports the screen area its UI covers (insets, in CSS pixels). A focused subject is
 * centred in what's left, and the athlete is pulled in close enough to fill it.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Share of the height assumed covered by a bottom sheet when the app reports no insets. */
export const ASSUMED_SHEET = 0.4;
/** Smallest free area kept, as a share of the screen, however much the app covers. */
const MIN_FREE = 0.25;

export function hasInsets(i: Insets): boolean {
  return i.top > 0 || i.right > 0 || i.bottom > 0 || i.left > 0;
}

/** The uncovered rectangle of a w by h screen. */
export function freeRect(w: number, h: number, i: Insets, out: Rect = { x: 0, y: 0, w: 0, h: 0 }): Rect {
  const left = clamp(i.left, 0, w * (1 - MIN_FREE));
  const right = clamp(i.right, 0, w * (1 - MIN_FREE) - left);
  const top = clamp(i.top, 0, h * (1 - MIN_FREE));
  const bottom = clamp(i.bottom, 0, h * (1 - MIN_FREE) - top);
  return setRect(out, left, top, w - left - right, h - top - bottom);
}

function setRect(r: Rect, x: number, y: number, w: number, h: number): Rect {
  r.x = x;
  r.y = y;
  r.w = w;
  r.h = h;
  return r;
}

/**
 * The rectangle a focused subject is framed in: the free area the app reported, or, when it
 * reported nothing, the top part above an assumed bottom sheet. Home is always the whole screen.
 */
export function subjectRect(w: number, h: number, insets: Insets, focused: boolean, out: Rect = { x: 0, y: 0, w: 0, h: 0 }): Rect {
  if (!focused) return setRect(out, 0, 0, w, h);
  if (hasInsets(insets)) return freeRect(w, h, insets, out);
  return setRect(out, 0, 0, w, h * (1 - ASSUMED_SHEET));
}

/**
 * View offset (for PerspectiveCamera.setViewOffset with full size = w by h) that moves the image
 * centre to the centre of `rect`.
 */
export function viewOffset(w: number, h: number, rect: Rect, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  out.x = w / 2 - (rect.x + rect.w / 2);
  out.y = h / 2 - (rect.y + rect.h / 2);
  return out;
}

/** Athlete height and half-width kept in frame, metres, with room around them. */
const FIGURE_H = 2.3;
const FIGURE_HALF_W = 0.75;
/** Lying down the figure is wide and low. */
const DOWN_HALF_W = 1.4;
const DOWN_H = 1.2;

/**
 * Camera distance that makes the athlete fill `rect` (as shares of the screen): as close as the
 * free height and width allow, but never closer than a body length.
 */
export function athleteDistance(fovDeg: number, aspect: number, freeH: number, freeW: number, down: boolean): number {
  const halfV = (fovDeg * Math.PI) / 360;
  const tanV = Math.tan(halfV) * Math.max(0.05, freeH);
  const tanH = Math.tan(halfV) * aspect * Math.max(0.05, freeW);
  const h = down ? DOWN_H : FIGURE_H;
  const hw = down ? DOWN_HALF_W : FIGURE_HALF_W;
  return Math.max(2.2, h / 2 / tanV, hw / tanH);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));
