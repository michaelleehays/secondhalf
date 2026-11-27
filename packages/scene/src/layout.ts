import { AREAS, type AreaId, type Level } from "@second-half/contracts";

/**
 * Mountain layout. Pure geometry, no three.js, so it can be tested and shared with the shader.
 *
 * The mountain is a cone of rings (levels) cut into five sectors (areas).
 * Ring 1 (101) is the outermost band, ring 4 (401) the innermost, and the summit disc is The Vision (501).
 * Angles are in degrees, measured with atan2(x, z): 0° points at the default camera (+z).
 */

/** Radius of the whole mountain base. */
export const MOUNTAIN_RADIUS = 22;
/** Summit height. */
export const PEAK_HEIGHT = 11;

/** Outer radius of each band: index 0 = 101, 1 = 201, 2 = 301, 3 = 401, 4 = The Vision. */
export const RING_OUTER = [21, 15, 10.5, 6.5, 3] as const;

/** Each area owns a 72° sector starting at this angle. Order matches AREAS. */
export const SECTOR_START_DEG: Record<AreaId, number> = {
  body: -36,
  mind: 36,
  work: 108,
  people: -180,
  money: -108,
};
export const SECTOR_SPAN_DEG = 360 / AREAS.length;

/** Ground height at (x, z). Gentle ridges on the slopes, flat plain beyond the base. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = Math.atan2(x, z);
  if (r > MOUNTAIN_RADIUS) {
    return -0.15 * Math.min(1, (r - MOUNTAIN_RADIUS) / 5) + 0.12 * Math.sin(x * 0.4) * Math.cos(z * 0.37);
  }
  const t = Math.max(0, 1 - r / MOUNTAIN_RADIUS);
  const ridges = 0.42 * Math.sin(a * 3 + r * 0.45) + 0.3 * Math.sin(a * 7 - r * 0.8) + 0.22 * Math.cos(x * 0.55) * Math.sin(z * 0.6);
  return PEAK_HEIGHT * Math.pow(t, 1.3) + ridges * Math.min(1, t * 2.2);
}

/** Which band a radius falls in: 1..4 for a level ring, 5 for The Vision, 0 for the plain outside. */
export function ringAt(r: number): 0 | Level {
  if (r < RING_OUTER[4]) return 5;
  if (r < RING_OUTER[3]) return 4;
  if (r < RING_OUTER[2]) return 3;
  if (r < RING_OUTER[1]) return 2;
  if (r < RING_OUTER[0]) return 1;
  return 0;
}

/** Which area sector a point falls in, and how far across it (0..1, counter-clockwise from its start). */
export function sectorAt(x: number, z: number): { area: AreaId; frac: number } {
  const deg = (Math.atan2(x, z) * 180) / Math.PI;
  for (const area of AREAS) {
    const d = (((deg - SECTOR_START_DEG[area]) % 360) + 360) % 360;
    if (d < SECTOR_SPAN_DEG) return { area, frac: d / SECTOR_SPAN_DEG };
  }
  // Unreachable: the five sectors cover the full circle.
  return { area: AREAS[0]!, frac: 0 };
}

/** Index of a cell in the shader's uniform arrays: (level - 1) * 5 + area index. */
export function cellIndex(area: AreaId, level: Exclude<Level, 5>): number {
  return (level - 1) * AREAS.length + AREAS.indexOf(area);
}

export const CELL_COUNT = 4 * AREAS.length;

/** Mid-angle of an area's sector, in radians. */
export function sectorMidRad(area: AreaId): number {
  return ((SECTOR_START_DEG[area] + SECTOR_SPAN_DEG / 2) * Math.PI) / 180;
}

/** Point on the ground at a radius and angle (radians), as [x, y, z]. */
export function groundPoint(r: number, angleRad: number, lift = 0): [number, number, number] {
  const x = Math.sin(angleRad) * r;
  const z = Math.cos(angleRad) * r;
  return [x, heightAt(x, z) + lift, z];
}

/** Where the athlete stands: just outside the ring of the player's current level, facing the camera. */
export function athleteSpot(level: Level): [number, number, number] {
  const r = RING_OUTER[level - 1]! + (level === 1 ? 0.6 : 0.4);
  return groundPoint(r, 0);
}

/** Unit ground normal at (x, z), by central differences, written into `out` as [x, y, z]. */
export function normalAt(x: number, z: number, out: [number, number, number] = [0, 0, 0], eps = 0.05): [number, number, number] {
  const dx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const dz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  const len = Math.hypot(dx, 1, dz);
  out[0] = -dx / len;
  out[1] = 1 / len;
  out[2] = -dz / len;
  return out;
}

/** Middle of a cell (an area's slice of a level ring) on the ground, as [x, y, z]. */
export function cellCenter(area: AreaId, level: Exclude<Level, 5>, lift = 0): [number, number, number] {
  const outer = RING_OUTER[level - 1]!;
  const inner = RING_OUTER[level]!;
  return groundPoint((outer + inner) / 2, sectorMidRad(area), lift);
}

/** Where a Resistance marker stands: just outside the 101 ring, inside its target area's slice. */
export const RESISTANCE_RADIUS = 22.5;
/** Offset from the start of the target sector, degrees: a little to one side of the middle, opposite where the trail sets off. */
export const RESISTANCE_SECTOR_OFFSET_DEG = 28;
export function resistanceSpot(area: AreaId): [number, number, number] {
  return groundPoint(RESISTANCE_RADIUS, ((SECTOR_START_DEG[area] + RESISTANCE_SECTOR_OFFSET_DEG) * Math.PI) / 180);
}
