import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AREAS } from "@second-half/contracts";
import { CameraRig, shotFor, wrapAngle } from "../src/camera";
import { athleteSpot, resistanceSpot } from "../src/layout";

const ctx = { aspect: 16 / 9, fov: 42, level: 2 as const, athleteDown: false };

/** Screen position (0..1 from top-left) of a world point through a camera. */
function screen(cam: THREE.PerspectiveCamera, p: THREE.Vector3) {
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const v = p.clone().project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
}
function camAt(aspect: number, shot: { pos: THREE.Vector3; look: THREE.Vector3 }) {
  const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
  cam.position.copy(shot.pos);
  cam.lookAt(shot.look);
  return cam;
}
const inFrame = (s: { x: number; y: number }) => s.x > 0.02 && s.x < 0.98 && s.y > 0.02 && s.y < 0.98;

describe("shots", () => {
  it("home frames the front Resistance markers on desktop screens and keeps the phone shot", () => {
    for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
      const cam = camAt(aspect, shotFor({ kind: "home" }, { ...ctx, aspect }));
      for (const area of ["body", "mind", "money"] as const) {
        expect(inFrame(screen(cam, new THREE.Vector3(...resistanceSpot(area))))).toBe(true);
        expect(inFrame(screen(cam, new THREE.Vector3(...resistanceSpot(area)).add(new THREE.Vector3(0, 3, 0))))).toBe(true);
      }
    }
    expect(shotFor({ kind: "home" }, { ...ctx, aspect: 390 / 844 }).pos.toArray()).toEqual([0, 9, 36]);
  });

  it("home turns to face the section being worked", () => {
    const front = shotFor({ kind: "home" }, ctx);
    const money = shotFor({ kind: "home" }, { ...ctx, homeYaw: -1.2 });
    expect(money.pos.length()).toBeCloseTo(front.pos.length(), 5);
    expect(Math.atan2(money.pos.x, money.pos.z)).toBeCloseTo(-1.2, 5);
  });

  it("the area shot frames that area's Resistance marker on desktop and phone", () => {
    for (const aspect of [16 / 9, 390 / 664]) {
      for (const area of AREAS) {
        const cam = camAt(aspect, shotFor({ kind: "area", area }, { ...ctx, aspect }));
        expect(inFrame(screen(cam, new THREE.Vector3(...resistanceSpot(area)).add(new THREE.Vector3(0, 2.2, 0))))).toBe(true);
      }
    }
  });

  it("frames a Resistance marker when its area is known, and falls back to home otherwise", () => {
    for (const aspect of [16 / 9, 390 / 664]) {
      const cam = camAt(aspect, shotFor({ kind: "resistance", id: "temptation" }, { ...ctx, aspect, resistanceArea: "money" }));
      expect(inFrame(screen(cam, new THREE.Vector3(...resistanceSpot("money")).add(new THREE.Vector3(0, 2.2, 0))))).toBe(true);
    }
    expect(shotFor({ kind: "resistance", id: "temptation" }, ctx).pos).toEqual(shotFor({ kind: "home" }, ctx).pos);
  });

  it("looks at the athlete from outside the mountain, wherever they stand", () => {
    const pos: [number, number, number] = [-14, 3, 5];
    const s = shotFor({ kind: "athlete" }, { ...ctx, athletePos: pos });
    expect(Math.hypot(s.pos.x, s.pos.z)).toBeGreaterThan(Math.hypot(pos[0], pos[2]));
    expect(s.look.x).toBe(-14);
    const far = shotFor({ kind: "athlete" }, { ...ctx, athletePos: pos, freeH: 0.4 });
    expect(far.pos.distanceTo(far.look)).toBeGreaterThan(s.pos.distanceTo(s.look) * 2);
  });

  it("backs off further to frame a lying athlete on a narrow phone screen", () => {
    const spot = new THREE.Vector3(...athleteSpot(2));
    const wide = shotFor({ kind: "athlete" }, { ...ctx, athleteDown: true });
    const phone = shotFor({ kind: "athlete" }, { ...ctx, aspect: 390 / 844, athleteDown: true });
    expect(phone.pos.distanceTo(spot)).toBeGreaterThan(wide.pos.distanceTo(spot) + 1);
  });
});

describe("CameraRig", () => {
  const rig = () => {
    const cam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    const r = new CameraRig(cam, (id) => (id === "fatigue" ? "body" : undefined));
    r.setViewport(1280, 720);
    return { cam, r };
  };

  it("snaps to the shot and follows a focus change", () => {
    const { cam, r } = rig();
    r.update(0.016, 2, false, null, true);
    expect(cam.position.distanceTo(shotFor({ kind: "home" }, ctx).pos)).toBeLessThan(1e-6);
    r.focus({ kind: "vision" });
    r.update(0.016, 2, false, null, true);
    expect(cam.position.distanceTo(shotFor({ kind: "vision" }, ctx).pos)).toBeLessThan(1e-6);
  });

  it("orbits all the way round, coasts after release, and comes back the short way on focus", () => {
    const { cam, r } = rig();
    r.update(0.016, 2, false, null, true);
    const start = cam.position.clone();
    r.beginDrag();
    r.dragBy(Math.PI * 2);
    r.endDrag(0);
    r.update(0.016, 2, false, null, true);
    expect(cam.position.distanceTo(start)).toBeLessThan(1e-4); // a full turn
    r.beginDrag();
    r.dragBy(Math.PI);
    r.endDrag(0);
    r.update(0.016, 2, false, null, true);
    expect(cam.position.z).toBeLessThan(0); // other side of the mountain
    const goal = r.yawTarget;
    r.endDrag(3);
    for (let i = 0; i < 10; i++) r.update(0.05, 2, false, null);
    expect(r.yawTarget).toBeGreaterThan(goal); // coasting
    const coasted = r.yawTarget;
    for (let i = 0; i < 200; i++) r.update(0.05, 2, false, null);
    expect(r.yawTarget - coasted).toBeLessThan(1.5); // damped, comes to rest
    r.focus({ kind: "home" });
    r.update(0.016, 2, false, null, true);
    expect(cam.position.distanceTo(start)).toBeLessThan(1e-4);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it("frames the athlete beside a right-side sheet, and above a bottom sheet", () => {
    const { cam, r } = rig();
    const at = new THREE.Vector3(...athleteSpot(2));
    r.setInsets({ top: 0, right: 480, bottom: 0, left: 0 });
    r.focus({ kind: "athlete" });
    r.update(0.016, 2, false, at, true);
    const look = new THREE.Vector3(at.x, at.y + 0.95, at.z);
    const s = screen(cam, look);
    expect(s.x).toBeCloseTo(400 / 1280, 2);
    expect(s.y).toBeCloseTo(0.5, 2);
    r.setInsets({ top: 0, right: 0, bottom: 432, left: 0 });
    r.update(0.016, 2, false, at, true);
    const b = screen(cam, look);
    expect(b.x).toBeCloseTo(0.5, 2);
    expect(b.y).toBeCloseTo((720 - 432) / 2 / 720, 2);
    // The whole figure (feet to head) fits above the sheet.
    expect(screen(cam, at).y).toBeLessThan((720 - 432) / 720);
    expect(screen(cam, at.clone().add(new THREE.Vector3(0, 1.9, 0))).y).toBeGreaterThan(0);
  });

  it("keeps home whole-screen and centred", () => {
    const { cam, r } = rig();
    r.setInsets({ top: 0, right: 480, bottom: 0, left: 0 });
    r.update(0.016, 2, false, null, true);
    expect(cam.view?.enabled ?? false).toBe(false);
  });

  it("frames a Resistance target too (focused shots use the free area)", () => {
    const { cam, r } = rig();
    r.focus({ kind: "resistance", id: "fatigue" });
    r.update(0.016, 2, false, null, true);
    expect(cam.view?.enabled).toBe(true);
  });
});
