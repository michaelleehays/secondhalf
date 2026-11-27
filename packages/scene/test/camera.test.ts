import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig, shotFor } from "../src/camera";
import { athleteSpot } from "../src/layout";

const ctx = { aspect: 16 / 9, fov: 42, level: 2 as const, athleteDown: false };

describe("shotFor", () => {
  it("backs off further to frame a lying athlete on a narrow phone screen", () => {
    const spot = new THREE.Vector3(...athleteSpot(2));
    const wide = shotFor({ kind: "athlete" }, { ...ctx, athleteDown: true });
    const phone = shotFor({ kind: "athlete" }, { ...ctx, aspect: 390 / 844, athleteDown: true });
    expect(phone.pos.distanceTo(spot)).toBeGreaterThan(wide.pos.distanceTo(spot) + 1);
    // A 2.8 m wide body fits the phone's horizontal field of view.
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * (390 / 844));
    expect(phone.pos.distanceTo(phone.look) * Math.tan(halfH)).toBeGreaterThanOrEqual(1.39);
  });

  it("writes into the shot it is given", () => {
    const out = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    expect(shotFor({ kind: "home" }, ctx, out)).toBe(out);
  });
});

describe("CameraRig", () => {
  it("snaps to the shot and follows a focus change", () => {
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    const rig = new CameraRig(cam);
    rig.update(0.016, 2, false, true);
    expect(cam.position.distanceTo(shotFor({ kind: "home" }, ctx).pos)).toBeLessThan(1e-6);
    rig.focus({ kind: "vision" });
    rig.update(0.016, 2, false, true);
    expect(cam.position.distanceTo(shotFor({ kind: "vision" }, ctx).pos)).toBeLessThan(1e-6);
  });
});
