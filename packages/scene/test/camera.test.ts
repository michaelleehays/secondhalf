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

describe("area shot", () => {
  it("frames the area's Resistance marker on desktop and phone", async () => {
    const { AREAS } = await import("@second-half/contracts");
    const { resistanceSpot } = await import("../src/layout");
    for (const aspect of [16 / 9, 390 / 664]) {
      const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
      for (const area of AREAS) {
        const s = shotFor({ kind: "area", area }, { ...ctx, aspect });
        cam.position.copy(s.pos);
        cam.lookAt(s.look);
        cam.updateMatrixWorld();
        const p = new THREE.Vector3(...resistanceSpot(area)).add(new THREE.Vector3(0, 2.2, 0)).project(cam);
        expect(Math.abs(p.x)).toBeLessThan(0.9);
        expect(Math.abs(p.y)).toBeLessThan(0.9);
      }
    }
  });
});

describe("home shot", () => {
  it("frames the front Resistance markers on desktop screens, and keeps the phone shot", async () => {
    const { resistanceSpot } = await import("../src/layout");
    for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
      const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
      const s = shotFor({ kind: "home" }, { ...ctx, aspect });
      cam.position.copy(s.pos);
      cam.lookAt(s.look);
      cam.updateMatrixWorld();
      for (const area of ["body", "mind", "money"] as const) {
        const base = new THREE.Vector3(...resistanceSpot(area)).project(cam);
        const top = new THREE.Vector3(...resistanceSpot(area)).add(new THREE.Vector3(0, 3, 0)).project(cam);
        expect(Math.abs(base.x)).toBeLessThan(1);
        expect(Math.abs(base.y)).toBeLessThan(1);
        expect(Math.abs(top.y)).toBeLessThan(1);
      }
    }
    expect(shotFor({ kind: "home" }, { ...ctx, aspect: 390 / 844 }).pos.toArray()).toEqual([0, 9, 36]);
  });
});

describe("Resistance shot and subject offset", () => {
  it("frames a Resistance marker when its area is known, and falls back to home otherwise", async () => {
    const { resistanceSpot } = await import("../src/layout");
    for (const aspect of [16 / 9, 390 / 664]) {
      const s = shotFor({ kind: "resistance", id: "temptation" }, { ...ctx, aspect, resistanceArea: "money" });
      const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
      cam.position.copy(s.pos);
      cam.lookAt(s.look);
      cam.updateMatrixWorld();
      const p = new THREE.Vector3(...resistanceSpot("money")).add(new THREE.Vector3(0, 2.2, 0)).project(cam);
      expect(Math.abs(p.x)).toBeLessThan(0.9);
      expect(Math.abs(p.y)).toBeLessThan(0.9);
    }
    expect(shotFor({ kind: "resistance", id: "temptation" }, ctx).pos).toEqual(shotFor({ kind: "home" }, ctx).pos);
  });

  it("raises a focused subject above centre and re-centres for home", () => {
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    const rig = new CameraRig(cam, (id) => (id === "fatigue" ? "body" : undefined), 0.3);
    rig.update(0.016, 2, false, true);
    expect(cam.view?.enabled ?? false).toBe(false);
    rig.focus({ kind: "resistance", id: "fatigue" });
    rig.update(0.016, 2, false, true);
    expect(cam.view?.enabled).toBe(true);
    expect(cam.view!.offsetY / cam.view!.fullHeight).toBeCloseTo(0.2);
    // The look point lands 30% from the top of the screen.
    const look = shotFor({ kind: "resistance", id: "fatigue" }, { ...ctx, resistanceArea: "body" }).look.clone();
    cam.updateMatrixWorld();
    expect((1 - look.project(cam).y) / 2).toBeCloseTo(0.3, 2);
    rig.focus({ kind: "home" });
    rig.update(0.016, 2, false, true);
    expect(cam.view?.enabled ?? false).toBe(false);
  });
});
