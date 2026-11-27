import { describe, expect, it } from "vitest";
import { CELEBRATE_SECONDS, poseAt, type PoseInput } from "../src/poses";

const base: PoseInput = { time: 0, slump: 0, down: 0, hit: 0, celebrate: 0 };

describe("poseAt", () => {
  it("drops the arms from the A-pose rest", () => {
    const p = poseAt(base);
    expect(p.bones.LeftArm![2]).toBeLessThan(0);
    expect(p.bones.RightArm![2]).toBeGreaterThan(0);
    expect(p.root).toEqual([0, 0, 0]);
  });

  it("bends the head and chest forward when slumped", () => {
    const up = poseAt(base);
    const slumped = poseAt({ ...base, slump: 1 });
    expect(slumped.bones.Head![0]).toBeGreaterThan(up.bones.Head![0] + 0.2);
    expect(slumped.bones.Spine2![0]).toBeGreaterThan(up.bones.Spine2![0]);
  });

  it("snaps the chest back on a hit", () => {
    expect(poseAt({ ...base, hit: 1 }).bones.Spine2![0]).toBeLessThan(poseAt(base).bones.Spine2![0] - 0.3);
  });

  it("lays the body on the ground when down, with no breathing", () => {
    const p = poseAt({ ...base, down: 1, time: 3 });
    expect(p.root[0]).toBeCloseTo(-Math.PI / 2);
    expect(p.lift).toBeGreaterThan(0);
    expect(p.hips).toEqual(poseAt({ ...base, down: 1, time: 7 }).hips);
  });

  it("raises both arms mid-celebration and lowers them at the end", () => {
    const mid = poseAt({ ...base, celebrate: 0.5 });
    expect(mid.bones.LeftArm![2]).toBeGreaterThan(1.5);
    expect(mid.bones.RightArm![2]).toBeLessThan(-1.5);
    expect(poseAt({ ...base, celebrate: 0.999 }).bones.LeftArm![2]).toBeLessThan(0);
    expect(CELEBRATE_SECONDS).toBeGreaterThan(0);
  });

  it("does not celebrate while down", () => {
    expect(poseAt({ ...base, down: 1, celebrate: 0.5 }).bones.LeftArm).toEqual(poseAt({ ...base, down: 1 }).bones.LeftArm);
  });

  it("breathes when standing", () => {
    expect(poseAt({ ...base, time: 1 }).bones.Spine2).not.toEqual(poseAt({ ...base, time: 2 }).bones.Spine2);
  });
});

describe("poseAt reuse", () => {
  it("writes into the pose it is given and resets it each call", async () => {
    const { emptyPose } = await import("../src/poses");
    const out = emptyPose();
    const arm = out.bones.LeftArm;
    expect(poseAt({ ...base, hit: 1 }, out)).toBe(out);
    expect(out.bones.LeftArm).toBe(arm);
    poseAt(base, out);
    expect(out.bones.LeftArm).toEqual(poseAt(base).bones.LeftArm);
  });

  it("splits the celebration raise between shoulders and upper arms", () => {
    const mid = poseAt({ ...base, celebrate: 0.5 });
    expect(mid.bones.LeftShoulder[2]).toBeGreaterThan(0.3);
    expect(mid.bones.RightShoulder[2]).toBeLessThan(-0.3);
  });

  it("rolls the shoulders forward when slumped without flaring the arms", () => {
    const s = poseAt({ ...base, slump: 1 });
    expect(Math.abs(s.bones.LeftShoulder[2])).toBeLessThan(0.05);
    expect(s.bones.LeftShoulder[1]).toBeLessThan(0);
    expect(s.bones.RightShoulder[1]).toBeGreaterThan(0);
  });
});

describe("walk cycle", () => {
  it("swings the legs in opposition and is gone when not walking", () => {
    const step = poseAt({ ...base, walk: 1, walkPhase: Math.PI / 2 });
    expect(step.bones.LeftUpLeg[0]).toBeGreaterThan(0.3);
    expect(step.bones.RightUpLeg[0]).toBeLessThan(-0.3);
    expect(poseAt({ ...base, walk: 0, walkPhase: Math.PI / 2 }).bones.LeftUpLeg).toEqual(poseAt(base).bones.LeftUpLeg);
  });
});
