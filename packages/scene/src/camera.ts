import * as THREE from "three";
import type { Level, SceneTarget } from "@second-half/contracts";
import { athleteSpot, heightAt, sectorMidRad } from "./layout";

export interface CameraShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Where the camera sits for each focus target. `aspect` is width / height.
 * Writes into `out` when given, so callers can avoid allocating.
 */
export function shotFor(target: SceneTarget, aspect: number, level: Level, out?: CameraShot): CameraShot {
  const shot = out ?? { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  switch (target.kind) {
    case "home": {
      const narrow = aspect < 0.8;
      shot.pos.set(0, narrow ? 9 : 8, narrow ? 36 : 29);
      shot.look.set(0, narrow ? 5.2 : 4.4, narrow ? 4 : 5);
      break;
    }
    case "athlete": {
      const [x, y, z] = athleteSpot(level);
      shot.pos.set(x + 0.9, y + 1.7, z + 4.2);
      shot.look.set(x, y + 1.05, z);
      break;
    }
    case "area": {
      const a = sectorMidRad(target.area);
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      shot.pos.set(dx * 30, 15, dz * 30);
      shot.look.set(dx * 11, 3, dz * 11);
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

const MAX_YAW = 0.9;
const UP = new THREE.Vector3(0, 1, 0);
const _offset = new THREE.Vector3();
const _goal = new THREE.Vector3();

const targetKey = (t: SceneTarget) => (t.kind === "area" ? `area:${t.area}` : t.kind);

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
  private shotKey = "";

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
  update(dt: number, level: Level, snap = false) {
    const key = `${targetKey(this.target)}|${this.camera.aspect.toFixed(3)}|${level}`;
    if (key !== this.shotKey) {
      shotFor(this.target, this.camera.aspect, level, this.shot);
      this.shotKey = key;
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
