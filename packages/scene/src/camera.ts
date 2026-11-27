import * as THREE from "three";
import type { Level, SceneTarget } from "@second-half/contracts";
import { athleteSpot, heightAt, sectorMidRad } from "./layout";

export interface CameraShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/** Where the camera sits for each focus target. `aspect` is width / height. */
export function shotFor(target: SceneTarget, aspect: number, level: Level): CameraShot {
  switch (target.kind) {
    case "home": {
      const narrow = aspect < 0.8;
      return {
        pos: new THREE.Vector3(0, narrow ? 9 : 8, narrow ? 36 : 29),
        look: new THREE.Vector3(0, narrow ? 5.2 : 4.4, narrow ? 4 : 5),
      };
    }
    case "athlete": {
      const p = new THREE.Vector3(...athleteSpot(level));
      return { pos: p.clone().add(new THREE.Vector3(0.9, 1.7, 4.2)), look: p.clone().add(new THREE.Vector3(0, 1.05, 0)) };
    }
    case "area": {
      const a = sectorMidRad(target.area);
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      return {
        pos: dir.clone().multiplyScalar(30).add(new THREE.Vector3(0, 15, 0)),
        look: dir.clone().multiplyScalar(11).add(new THREE.Vector3(0, 3, 0)),
      };
    }
    case "vision": {
      const top = heightAt(0, 0);
      return { pos: new THREE.Vector3(0, top + 7, 13), look: new THREE.Vector3(0, top - 0.5, 0) };
    }
  }
}

const MAX_YAW = 0.9;
const UP = new THREE.Vector3(0, 1, 0);

/** Eases the camera toward the current shot, with a user-controlled yaw around the look point. */
export class CameraRig {
  target: SceneTarget = { kind: "home" };
  private yaw = 0;
  private yawGoal = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private placed = false;

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

  /** Advance by `dt` seconds. `snap` jumps straight to the shot (first frame, reduced motion). */
  update(dt: number, level: Level, snap = false) {
    const shot = shotFor(this.target, this.camera.aspect, level);
    const k = snap || !this.placed ? 1 : 1 - Math.pow(0.04, dt);
    this.yaw = snap ? this.yawGoal : this.yaw + (this.yawGoal - this.yaw) * (1 - Math.pow(0.02, dt));
    const offset = shot.pos.clone().sub(shot.look).applyAxisAngle(UP, this.yaw);
    this.look.lerp(shot.look, k);
    this.pos.lerp(shot.look.clone().add(offset), k);
    this.placed = true;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
