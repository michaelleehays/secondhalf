import type { AreaId, JournalKind, Level, TrailView } from "@second-half/contracts";
import { RING_OUTER, SECTOR_SPAN_DEG, heightAt, sectorMidRad } from "./layout";

/**
 * Where the trail runs. Pure: no three.js.
 *
 * The trail climbs the current section from just outside the 101 ring to the edge of the Vision,
 * in gentle switchbacks that stay inside the slice. Everything on it (the athlete, milestone stops,
 * journal moments) is placed by distance along the path.
 */

/** Where the trail starts (just outside the 101 ring) and ends (at the Vision's edge). */
export const TRAIL_START_R = RING_OUTER[0] + 0.6;
export const TRAIL_END_R = RING_OUTER[4] + 0.2;
/** Height of the trail above the ground. */
const LIFT = 0.06;
const SAMPLES = 200;
/** Switchback count and half-width in metres (narrowed near the top to stay in the slice). */
const SWITCHBACKS = 3.5;
const SWING_M = 2.2;

export interface TrailPath {
  area: AreaId;
  /** x, y, z per sample. */
  points: Float32Array;
  /** Distance along the path at each sample, metres. */
  dist: Float32Array;
  /** Distance from the mountain's axis at each sample (decreasing). */
  radius: Float32Array;
  length: number;
}

export function trailPath(area: AreaId): TrailPath {
  const mid = sectorMidRad(area);
  const maxSwing = ((SECTOR_SPAN_DEG / 2) * Math.PI) / 180 * 0.6;
  const points = new Float32Array((SAMPLES + 1) * 3);
  const dist = new Float32Array(SAMPLES + 1);
  const radius = new Float32Array(SAMPLES + 1);
  let total = 0;
  let px = 0;
  let pz = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const r = TRAIL_START_R + (TRAIL_END_R - TRAIL_START_R) * t;
    const swing = Math.min(maxSwing, SWING_M / r) * Math.cos(t * Math.PI * 2 * SWITCHBACKS) * (1 - t * 0.6);
    const a = mid + swing;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (i > 0) total += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
    points[i * 3] = x;
    points[i * 3 + 1] = heightAt(x, z) + LIFT;
    points[i * 3 + 2] = z;
    dist[i] = total;
    radius[i] = r;
  }
  return { area, points, dist, radius, length: total };
}

/** Distance along the path where it crosses radius `r` (clamped to the path). */
export function distAtRadius(path: TrailPath, r: number): number {
  const n = path.radius.length;
  if (r >= path.radius[0]!) return 0;
  if (r <= path.radius[n - 1]!) return path.length;
  for (let i = 1; i < n; i++) {
    const r1 = path.radius[i]!;
    if (r1 <= r) {
      const r0 = path.radius[i - 1]!;
      const k = (r0 - r) / (r0 - r1);
      return path.dist[i - 1]! + (path.dist[i]! - path.dist[i - 1]!) * k;
    }
  }
  return path.length;
}

/** Point on the path at distance `s`, with an optional sideways offset (metres, + is to the climber's right). */
export function pointAt(path: TrailPath, s: number, side = 0, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const n = path.dist.length;
  const d = Math.max(0, Math.min(path.length, s));
  let i = 1;
  while (i < n - 1 && path.dist[i]! < d) i++;
  const d0 = path.dist[i - 1]!;
  const d1 = path.dist[i]!;
  const k = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  const p = path.points;
  let x = p[(i - 1) * 3]! + (p[i * 3]! - p[(i - 1) * 3]!) * k;
  let z = p[(i - 1) * 3 + 2]! + (p[i * 3 + 2]! - p[(i - 1) * 3 + 2]!) * k;
  if (side !== 0) {
    // Heading in the ground plane; its right-hand normal is (dz, -dx) when looking along (dx, dz).
    const dx = p[i * 3]! - p[(i - 1) * 3]!;
    const dz = p[i * 3 + 2]! - p[(i - 1) * 3 + 2]!;
    const len = Math.hypot(dx, dz) || 1;
    x += (-dz / len) * side;
    z += (dx / len) * side;
  }
  out[0] = x;
  out[1] = heightAt(x, z) + LIFT;
  out[2] = z;
  return out;
}

/** Radii bounding a level's band: from its outer edge (bottom) to its inner edge (top). */
export function band(level: Exclude<Level, 5>): { bottom: number; top: number } {
  return { bottom: RING_OUTER[level - 1]!, top: RING_OUTER[level]! };
}

/**
 * How far up the trail the player has climbed, in metres along the path: the first stop not yet
 * locked in, part-way up its band by progress. With every stop locked in, the whole trail.
 */
export function climbedDistance(trail: TrailView, path: TrailPath): number {
  const stops = [...trail.stops].sort((a, b) => a.level - b.level);
  const current = stops.find((s) => s.status !== "locked_in");
  if (!current) return path.length;
  const { bottom, top } = band(current.level);
  const p = current.status === "in_progress" || current.status === "at_risk" || current.status === "lost" ? clamp01(current.progress) : 0;
  return distAtRadius(path, bottom - (bottom - top) * p);
}

export type MarkerKind = "flag" | "setback" | "at_risk" | "ground_lost" | "dot";

/** Which marker a journal moment gets on the trail. */
export function markerFor(kind: JournalKind): MarkerKind {
  switch (kind) {
    case "locked_in":
    case "verified":
      return "flag";
    case "setback":
      return "setback";
    case "at_risk":
      return "at_risk";
    case "ground_lost":
    case "level_lost":
      return "ground_lost";
    default:
      return "dot";
  }
}

export interface PlacedMoment {
  kind: MarkerKind;
  label: string;
  date: string;
  /** Distance along the path. */
  s: number;
  /** Sideways offset from the path centre, metres. */
  side: number;
}

/**
 * Places journal moments beside the climbed part of the trail. A moment sits in the band of the
 * level its goal belongs to, spread from the band's bottom to how far that band has been climbed,
 * oldest lowest. Moments with no goal, or a goal not on this trail, are left off.
 */
export function placeMoments(trail: TrailView, path: TrailPath): PlacedMoment[] {
  const climbed = climbedDistance(trail, path);
  const levelOf = new Map(trail.stops.map((s) => [s.goalId, s.level] as const));
  const byLevel = new Map<number, typeof trail.moments>();
  for (const m of trail.moments) {
    const level = m.goalId ? levelOf.get(m.goalId) : undefined;
    if (!level) continue;
    const list = byLevel.get(level) ?? [];
    list.push(m);
    byLevel.set(level, list);
  }
  const out: PlacedMoment[] = [];
  let n = 0;
  for (const [level, list] of byLevel) {
    const { bottom, top } = band(level as Exclude<Level, 5>);
    const s0 = distAtRadius(path, bottom);
    const s1 = Math.max(s0, Math.min(distAtRadius(path, top), climbed));
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    sorted.forEach((m, i) => {
      out.push({
        kind: markerFor(m.kind),
        label: m.label,
        date: m.date,
        s: s0 + ((s1 - s0) * (i + 1)) / (sorted.length + 1),
        side: (n++ % 2 === 0 ? 1 : -1) * 0.55,
      });
    });
  }
  return out;
}

/** Milestone stop for each level: at the top of its band, where the goal is reached. */
export function stopDistance(path: TrailPath, level: Exclude<Level, 5>): number {
  return distAtRadius(path, band(level).top + 0.6);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
