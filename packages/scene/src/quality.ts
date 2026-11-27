/**
 * Render quality. Pure: no three.js, no DOM.
 *
 * "high" is the full scene. "low" halves the pixel ratio, uses a coarser terrain mesh with cheaper
 * (Lambert) shading, and drops the rim and point lights and the contact shadow. "auto" starts high and drops to low once, if the first
 * frames run under the target frame rate.
 */
import type { CreateScene } from "@second-half/contracts";

/** The contract's quality option. */
export type Quality = NonNullable<Parameters<CreateScene>[1]["quality"]>;
export type QualityLevel = Exclude<Quality, "auto">;

export interface QualitySettings {
  pixelRatio: number;
  /** Terrain grid segments per side. */
  terrainSegments: number;
  /** Summit and event point lights. Each light costs a little on every lit pixel. */
  pointLights: boolean;
  /** Soft shadow blob under the athlete. */
  contactShadow: boolean;
  /** Terrain shading model: physically based, or cheaper Lambert. */
  terrainShading: "standard" | "lambert";
  /** The blue rim light from behind. */
  rimLight: boolean;
}

export interface Device {
  /** window.devicePixelRatio */
  dpr: number;
  /** Touch-first device (coarse pointer). */
  phone: boolean;
}

/** Pixel ratio cap at high quality. Above this, extra pixels cost more than they show. */
const MAX_PIXEL_RATIO = { phone: 2, desktop: 1.75 };
const TERRAIN_SEGMENTS = { high: { phone: 160, desktop: 230 }, low: 96 };

export function qualitySettings(level: QualityLevel, device: Device): QualitySettings {
  const high = Math.min(device.dpr, device.phone ? MAX_PIXEL_RATIO.phone : MAX_PIXEL_RATIO.desktop);
  if (level === "high") {
    return { pixelRatio: high, terrainSegments: device.phone ? TERRAIN_SEGMENTS.high.phone : TERRAIN_SEGMENTS.high.desktop, pointLights: true, contactShadow: true, terrainShading: "standard", rimLight: true };
  }
  // Halve the high ratio, but never below 1 (or the screen's own ratio, if that is lower).
  return { pixelRatio: Math.max(Math.min(1, device.dpr), high / 2), terrainSegments: TERRAIN_SEGMENTS.low, pointLights: false, contactShadow: false, terrainShading: "lambert", rimLight: false };
}

/** Frames to skip before measuring (shader compiles and model upload land here). */
export const AUTO_WARMUP_FRAMES = 10;
/** Frames to average. */
export const AUTO_SAMPLE_FRAMES = 60;
/** Drop to low below this average. */
export const AUTO_MIN_FPS = 30;
/** Clearly slow: after this many sampled frames, decide early if under AUTO_EARLY_FPS. */
export const AUTO_EARLY_FRAMES = 15;
export const AUTO_EARLY_FPS = 20;

/**
 * Watches the first frames and decides once. Feed it each frame's interval in ms;
 * it returns "low" or "high" when it has decided, null before that.
 * Call reset() after a pause, so time spent hidden is never counted.
 */
export class AutoQuality {
  private frames = 0;
  private total = 0;
  decided: QualityLevel | null = null;

  reset() {
    if (this.decided) return;
    this.frames = 0;
    this.total = 0;
  }

  frame(ms: number): QualityLevel | null {
    if (this.decided) return null;
    this.frames++;
    if (this.frames <= AUTO_WARMUP_FRAMES || !(ms >= 0)) return null;
    this.total += ms;
    const sampled = this.frames - AUTO_WARMUP_FRAMES;
    const fps = 1000 / (this.total / sampled);
    // A device far below target shouldn't sit through 60 slow frames (several seconds) first.
    if (sampled >= AUTO_EARLY_FRAMES && sampled < AUTO_SAMPLE_FRAMES && fps < AUTO_EARLY_FPS) {
      this.decided = "low";
      return this.decided;
    }
    if (sampled < AUTO_SAMPLE_FRAMES) return null;
    this.decided = fps < AUTO_MIN_FPS ? "low" : "high";
    return this.decided;
  }
}
