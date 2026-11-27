import * as THREE from "three";
import type { Level, SceneTarget } from "@second-half/contracts";
import { athleteSpot, heightAt, sectorMidRad } from "./layout";

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
}

/** Half-width (metres) to keep in frame around a lying athlete. */
const DOWN_HALF_WIDTH = 1.4;
/** Direction from a lying athlete to the camera (normalised in shotFor). */
const DOWN_DIR = new THREE.Vector3(0.15, 0.6, 0.8).normalize();

/**
 * Where the camera sits for each focus target.
 * Writes into `out` when given, so callers can avoid allocating.
 */
export function shotFor(target: SceneTarget, ctx: ShotContext, out?: CameraShot): CameraShot {
  const shot = out ?? { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const { aspect, level } = ctx;
  switch (target.kind) {
    case "home": {
      if (aspect < 0.8) {
        // Phones: the mountain fills the frame; dragging reveals the Resistance markers.
        shot.pos.set(0, 9, 36);
        shot.look.set(0, 5.2, 4);
      } else if (aspect < WIDE_ASPECT) {
        shot.pos.set(0, 8, 29);
        shot.look.set(0, 4.4, 5);
      } else {
        // Desktop: pull back just enough to frame the front Resistance markers (Body, Mind, Money),
        // further on squarer screens because Mind and Money sit far to the sides.
        const k = Math.min(1.35, Math.max(1, 16 / 9 / aspect));
        shot.look.set(0, 3, 4);
        shot.pos.set(0, 3 + 9 * k, 4 + 38 * k);
      }
      break;
    }
    case "athlete": {
      const [x, y, z] = athleteSpot(level);
      if (ctx.athleteDown) {
        // Fit the lying body across the narrower of the two fields of view.
        const halfV = THREE.MathUtils.degToRad(ctx.fov) / 2;
        const halfH = Math.atan(Math.tan(halfV) * aspect);
        const dist = Math.max(4.5, DOWN_HALF_WIDTH / Math.tan(Math.min(halfV, halfH)));
        shot.look.set(x, y + 0.25, z);
        shot.pos.copy(DOWN_DIR).multiplyScalar(dist).add(shot.look);
      } else {
        shot.pos.set(x + 0.9, y + 1.7, z + 4.2);
        shot.look.set(x, y + 1.05, z);
      }
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
      break;
    }
  }
  return shot;
}

/** At or above this aspect the home shot pulls back to include the Resistance markers. */
const WIDE_ASPECT = 1.2;
const MAX_YAW = 0.9;
const UP = new THREE.Vector3(0, 1, 0);
const _offset = new THREE.Vector3();
const _goal = new THREE.Vector3();


/** Eases the camera toward the current shot, with a user-controlled yaw around the look point. */
export class CameraRig {
  target: SceneTarget = { kind: "home" };
  private yaw = 0;
  private yawGoal = 0;
  private shakeAmt = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private placed = false;
  private shot: CameraShot = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  /** What the cached shot was computed for; recomputed only when one of these changes. */
  private shotFor: { target: SceneTarget | null; aspect: number; fov: number; level: number; down: boolean } = {
    target: null,
    aspect: 0,
    fov: 0,
    level: 0,
    down: false,
  };

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  focus(target: SceneTarget) {
    this.target = target;
    this.yawGoal = 0;
  }

  get yawTarget() {
    return this.yawGoal;
  }

  setYaw(yaw: number) {
    this.yawGoal = Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw));
  }

  /** Jolt the camera; decays over about 0.4 s. */
  shake(amount = 1) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Advance by `dt` seconds. `snap` jumps straight to the shot (first frame, reduced motion). */
  update(dt: number, level: Level, athleteDown: boolean, snap = false) {
    const c = this.shotFor;
    const { aspect, fov } = this.camera;
    if (c.target !== this.target || c.aspect !== aspect || c.fov !== fov || c.level !== level || c.down !== athleteDown) {
      shotFor(this.target, { aspect, fov, level, athleteDown }, this.shot);
      c.target = this.target;
      c.aspect = aspect;
      c.fov = fov;
      c.level = level;
      c.down = athleteDown;
    }
    const { pos, look } = this.shot;
    const k = snap || !this.placed ? 1 : 1 - Math.pow(0.04, dt);
    this.yaw = snap ? this.yawGoal : this.yaw + (this.yawGoal - this.yaw) * (1 - Math.pow(0.02, dt));
    _offset.subVectors(pos, look).applyAxisAngle(UP, this.yaw);
    this.look.lerp(look, k);
    this.pos.lerp(_goal.addVectors(look, _offset), k);
    this.placed = true;
    this.camera.position.copy(this.pos);
    if (this.shakeAmt > 0) {
      this.camera.position.x += (Math.random() - 0.5) * 0.35 * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * 0.25 * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    this.camera.lookAt(this.look);
  }
}
