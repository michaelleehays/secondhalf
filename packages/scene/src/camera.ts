import * as THREE from "three";
import type { AreaId, Level, SceneTarget } from "@second-half/contracts";
import { NO_INSETS, athleteDistance, subjectRect, viewOffset, type Insets } from "./framing";
import { athleteSpot, heightAt, resistanceSpot, sectorMidRad } from "./layout";

export interface CameraShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

export interface ShotContext {
  /** Width / height. */
  aspect: number;
  /** Vertical field of view, degrees. */
  fov: number;
  level: Level;
  /** The athlete is lying down, so the athlete shot frames a wide, low body. */
  athleteDown: boolean;
  /** Where the athlete stands; defaults to the level's spot in the Body slice. */
  athletePos?: readonly [number, number, number];
  /** Share of the screen (height, width) left for a focused subject; 1 when nothing covers it. */
  freeH?: number;
  freeW?: number;
  /** Home turns to face this angle (radians), e.g. the section being worked. */
  homeYaw?: number;
  /** For a Resistance target: the area its marker stands in (from the latest view), if known. */
  resistanceArea?: AreaId;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Where the camera sits for each focus target.
 * Writes into `out` when given, so callers can avoid allocating.
 */
export function shotFor(target: SceneTarget, ctx: ShotContext, out?: CameraShot): CameraShot {
  const shot = out ?? { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const { aspect } = ctx;
  switch (target.kind) {
    case "home": {
      if (aspect < 0.8) {
        // Phones: the mountain fills the frame; orbiting reveals the rest.
        shot.pos.set(0, 9, 36);
        shot.look.set(0, 5.2, 4);
      } else if (aspect < WIDE_ASPECT) {
        shot.pos.set(0, 8, 29);
        shot.look.set(0, 4.4, 5);
      } else {
        // Desktop: pull back to frame the front Resistance markers, more on squarer screens.
        const k = Math.min(1.35, Math.max(1, 16 / 9 / aspect));
        shot.look.set(0, 3, 4);
        shot.pos.set(0, 3 + 9 * k, 4 + 38 * k);
      }
      if (ctx.homeYaw) {
        shot.pos.applyAxisAngle(UP, ctx.homeYaw);
        shot.look.applyAxisAngle(UP, ctx.homeYaw);
      }
      break;
    }
    case "athlete": {
      const [x, y, z] = ctx.athletePos ?? athleteSpot(ctx.level);
      // From outside the mountain, a little to the side and above, looking back at the athlete.
      const r = Math.hypot(x, z) || 1;
      const ux = x / r;
      const uz = z / r;
      const dir = _dir.set(ux + uz * 0.22, 0.42, uz - ux * 0.22).normalize();
      const dist = athleteDistance(ctx.fov, aspect, ctx.freeH ?? 1, ctx.freeW ?? 1, ctx.athleteDown);
      shot.look.set(x, y + (ctx.athleteDown ? 0.25 : 0.95), z);
      shot.pos.copy(dir).multiplyScalar(dist).add(shot.look);
      break;
    }
    case "area": {
      const a = sectorMidRad(target.area);
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      // Looks down the slice from above its foot, so the Resistance marker at the base is in frame.
      shot.pos.set(dx * 33, 16, dz * 33);
      shot.look.set(dx * 14, 2.2, dz * 14);
      break;
    }
    case "vision": {
      const top = heightAt(0, 0);
      shot.pos.set(0, top + 7, 13);
      shot.look.set(0, top - 0.5, 0);
      if (ctx.homeYaw) {
        shot.pos.applyAxisAngle(UP, ctx.homeYaw);
        shot.look.applyAxisAngle(UP, ctx.homeYaw);
      }
      break;
    }
    case "resistance": {
      if (!ctx.resistanceArea) return shotFor({ kind: "home" }, ctx, shot);
      // From outside the mountain, looking past the marker at the slice it presses on.
      const [x, y, z] = resistanceSpot(ctx.resistanceArea);
      const r = Math.hypot(x, z);
      shot.pos.set((x / r) * (r + 15), y + 10, (z / r) * (r + 15));
      shot.look.set((x / r) * (r - 5), y + 1.5, (z / r) * (r - 5));
      break;
    }
    default: {
      const unhandled: never = target;
      void unhandled;
    }
  }
  return shot;
}

/** At or above this aspect the home shot pulls back to include the Resistance markers. */
const WIDE_ASPECT = 1.2;
const TWO_PI = Math.PI * 2;
const _dir = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _ctx: ShotContext = { aspect: 1, fov: 42, level: 1, athleteDown: false };
const _athletePos: [number, number, number] = [0, 0, 0];
const _rect = { x: 0, y: 0, w: 1, h: 1 };
const _off = { x: 0, y: 0 };

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const w = ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return w === -Math.PI ? Math.PI : w;
}

/**
 * Eases the camera toward the current shot. The user can orbit all the way round by dragging,
 * with damping; a focused subject is framed in the part of the screen the app leaves uncovered.
 */
export class CameraRig {
  target: SceneTarget = { kind: "home" };
  private yaw = 0;
  private yawGoal = 0;
  private yawVel = 0;
  private dragging = false;
  private shakeAmt = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private placed = false;
  private shot: CameraShot = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private width = 1;
  private height = 1;
  private insets: Insets = NO_INSETS;
  private homeYaw = 0;
  /** Current view offset in CSS pixels, eased toward the goal. */
  private offX = 0;
  private offY = 0;

  /** `resistanceArea` looks up where a Resistance marker stands, from the latest view. */
  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly resistanceArea: (id: string) => AreaId | undefined = () => undefined,
  ) {}

  setViewport(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  setInsets(insets: Insets) {
    this.insets = { ...insets };
  }

  /** Home faces this angle (radians): the section being worked. */
  setHomeYaw(yaw: number) {
    this.homeYaw = yaw;
  }

  focus(target: SceneTarget) {
    this.target = target;
    // Come round the short way from wherever the user has orbited to.
    this.yaw = wrapAngle(this.yaw);
    this.yawGoal = 0;
    this.yawVel = 0;
  }

  /** Drag-to-orbit: start, move by an angle, release with the drag's speed (radians per second). */
  beginDrag() {
    this.dragging = true;
    this.yawVel = 0;
  }

  dragBy(deltaYaw: number) {
    this.yawGoal += deltaYaw;
  }

  endDrag(velocity: number) {
    this.dragging = false;
    this.yawVel = Number.isFinite(velocity) ? Math.max(-6, Math.min(6, velocity)) : 0;
  }

  get yawTarget() {
    return this.yawGoal;
  }

  /** Jolt the camera; decays over about 0.4 s. */
  shake(amount = 1) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Advance by `dt` seconds. `snap` jumps straight to the shot (first frame, reduced motion). */
  update(dt: number, level: Level, athleteDown: boolean, athletePos: THREE.Vector3 | null, snap = false) {
    const cam = this.camera;
    const focused = this.target.kind !== "home";
    const rect = subjectRect(this.width, this.height, this.insets, focused, _rect);

    const ctx = _ctx;
    ctx.aspect = cam.aspect;
    ctx.fov = cam.fov;
    ctx.level = level;
    ctx.athleteDown = athleteDown;
    ctx.freeH = rect.h / this.height;
    ctx.freeW = rect.w / this.width;
    ctx.homeYaw = this.homeYaw;
    ctx.resistanceArea = this.target.kind === "resistance" ? this.resistanceArea(this.target.id) : undefined;
    if (athletePos) {
      _athletePos[0] = athletePos.x;
      _athletePos[1] = athletePos.y;
      _athletePos[2] = athletePos.z;
      ctx.athletePos = _athletePos;
    } else ctx.athletePos = undefined;
    shotFor(this.target, ctx, this.shot);

    // Orbit: inertia after a drag, eased toward the goal.
    if (!this.dragging && this.yawVel !== 0) {
      this.yawGoal += this.yawVel * dt;
      this.yawVel *= Math.pow(0.08, dt);
      if (Math.abs(this.yawVel) < 0.01) this.yawVel = 0;
    }
    this.yaw = snap ? this.yawGoal : this.yaw + (this.yawGoal - this.yaw) * (1 - Math.pow(1e-4, dt));

    // The athlete shot orbits the athlete; everything else orbits the mountain's axis.
    const { pos, look } = this.shot;
    if (this.target.kind === "athlete") _pivot.copy(look);
    else _pivot.set(0, 0, 0);
    _offset.subVectors(pos, _pivot).applyAxisAngle(UP, this.yaw);
    _goal.addVectors(_pivot, _offset);
    _look.subVectors(look, _pivot).applyAxisAngle(UP, this.yaw).add(_pivot);

    const k = snap || !this.placed ? 1 : 1 - Math.pow(0.04, dt);
    this.look.lerp(_look, k);
    this.pos.lerp(_goal, k);
    this.placed = true;
    cam.position.copy(this.pos);
    if (this.shakeAmt > 0) {
      cam.position.x += (Math.random() - 0.5) * 0.35 * this.shakeAmt;
      cam.position.y += (Math.random() - 0.5) * 0.25 * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    cam.lookAt(this.look);
    this.updateViewOffset(rect, k);
  }

  /** Slides the projection so the subject sits in the middle of `rect`. Picking stays exact. */
  private updateViewOffset(rect: { x: number; y: number; w: number; h: number }, k: number) {
    const goal = viewOffset(this.width, this.height, rect, _off);
    const nx = this.offX + (goal.x - this.offX) * k;
    const ny = this.offY + (goal.y - this.offY) * k;
    const changed = Math.abs(nx - this.offX) > 0.01 || Math.abs(ny - this.offY) > 0.01;
    this.offX = Math.abs(nx - goal.x) < 0.05 ? goal.x : nx;
    this.offY = Math.abs(ny - goal.y) < 0.05 ? goal.y : ny;
    const cam = this.camera;
    if (Math.abs(this.offX) < 0.05 && Math.abs(this.offY) < 0.05) {
      if (cam.view?.enabled) cam.clearViewOffset();
      return;
    }
    const v = cam.view;
    if (!changed && v?.enabled && v.fullWidth === this.width && v.fullHeight === this.height) return;
    cam.setViewOffset(this.width, this.height, this.offX, this.offY, this.width, this.height);
  }
}
