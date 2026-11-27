/**
 * Procedural athlete poses. Pure: numbers in, pose out. No three.js, so it can be unit-tested.
 *
 * Until our own animation clips exist (workstream D), the athlete is posed by adding rotations
 * to its rest pose. Every rotation is an Euler [x, y, z] in radians, in *character space*:
 * +x is the athlete's left, +y up, +z the way the athlete faces. So a positive x rotation bends
 * a bone forward, and a positive z rotation swings a bone toward the athlete's left side.
 * The rig converts these into each bone's local frame (see athlete.ts).
 */

/** Bones the poses drive, by Mixamo name without the "mixamorig" prefix. */
export const POSED_BONES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "RightShoulder",
  "LeftArm",
  "RightArm",
  "LeftForeArm",
  "RightForeArm",
  "LeftUpLeg",
  "RightUpLeg",
  "LeftLeg",
  "RightLeg",
] as const;
export type PosedBone = (typeof POSED_BONES)[number];

export type Euler3 = readonly [number, number, number];

export interface Pose {
  bones: Partial<Record<PosedBone, Euler3>>;
  /** Hip offset in character space, metres. */
  hips: Euler3;
  /** Whole-body rotation about the feet, character space, applied pitch first then yaw (Euler order "YXZ"). */
  root: Euler3;
  /** Whole-body lift, metres (for a hop, or lying on the ground). */
  lift: number;
}

/** Inputs to the pose, all smoothed by the caller. */
export interface PoseInput {
  /** Seconds since start. */
  time: number;
  /** 0 upright .. 1 slumped. */
  slump: number;
  /** 0 standing .. 1 down on the ground. */
  down: number;
  /** 1 at the moment of a hit, decaying to 0. */
  hit: number;
  /** 0..1 progress through a celebration, or 0 when none is playing. */
  celebrate: number;
}

const ZERO: Euler3 = [0, 0, 0];

/** Rest is an A-pose: drop the arms to the sides and keep a slight bend at the elbow. */
const STANDING: Pose = {
  bones: {
    LeftArm: [0.05, 0, -0.7],
    RightArm: [0.05, 0, 0.7],
    LeftForeArm: [0.15, 0, 0],
    RightForeArm: [0.15, 0, 0],
  },
  hips: ZERO,
  root: ZERO,
  lift: 0,
};

/** Head down, chest caved, shoulders rounded. */
const SLUMPED: Pose = {
  bones: {
    Spine1: [0.12, 0, 0],
    Spine2: [0.14, 0, 0],
    Neck: [0.16, 0, 0],
    Head: [0.24, 0, 0],
    LeftShoulder: [0.1, 0, -0.1],
    RightShoulder: [0.1, 0, 0.1],
  },
  hips: [0, -0.03, 0],
  root: ZERO,
  lift: 0,
};

/**
 * On the back on the ground, knees up, arms out. The body falls backward, then turns a quarter so
 * it lies along the slope's contour instead of into the hill behind it.
 */
const DOWN: Pose = {
  bones: {
    LeftArm: [0, 0, 0.6],
    RightArm: [0, 0, -0.6],
    LeftForeArm: [0.4, 0, 0],
    RightForeArm: [0.4, 0, 0],
    LeftUpLeg: [0.45, 0, 0.08],
    RightUpLeg: [0.15, 0, -0.08],
    LeftLeg: [-0.9, 0, 0],
    RightLeg: [-0.3, 0, 0],
    Head: [0.35, 0.3, 0],
  },
  hips: ZERO,
  root: [-Math.PI / 2, Math.PI / 2, 0],
  lift: 0.16,
};

/** Snapped back and twisted, as if struck in the chest. */
const HIT: Pose = {
  bones: {
    Spine1: [-0.15, 0.1, 0],
    Spine2: [-0.35, 0.2, 0],
    Head: [-0.3, -0.15, 0],
    LeftArm: [-0.3, 0, 0.25],
    RightArm: [-0.3, 0, -0.25],
  },
  hips: [0, 0, -0.05],
  root: ZERO,
  lift: 0,
};

/** Both arms overhead, chest and chin up. */
const ARMS_UP: Pose = {
  bones: {
    LeftArm: [0, 0, 2.75],
    RightArm: [0, 0, -2.75],
    LeftForeArm: [-0.2, 0, 0],
    RightForeArm: [-0.2, 0, 0],
    Spine2: [-0.12, 0, 0],
    Head: [-0.25, 0, 0],
  },
  hips: ZERO,
  root: ZERO,
  lift: 0,
};

/** Celebration length in seconds; the caller advances `celebrate` by dt / this. */
export const CELEBRATE_SECONDS = 1.8;
/** Hit reaction decay rate (per second). */
export const HIT_DECAY = 2.2;

/** Builds the full pose for this frame. */
export function poseAt(input: PoseInput): Pose {
  const out: Pose = { bones: {}, hips: [0, 0, 0], root: [0, 0, 0], lift: 0 };
  const up = 1 - clamp01(input.down);

  add(out, STANDING, 1);
  add(out, SLUMPED, clamp01(input.slump) * up);
  add(out, HIT, clamp01(input.hit));
  add(out, DOWN, clamp01(input.down));

  // Celebration: arms rise, hold, then come down, with two small hops while they are up.
  const c = clamp01(input.celebrate);
  if (c > 0 && c < 1) {
    const raise = smooth(c / 0.2) * (1 - smooth((c - 0.75) / 0.25));
    add(out, ARMS_UP, raise * up);
    out.lift += Math.max(0, Math.sin(c * Math.PI * 4)) * 0.12 * raise * up;
  }

  // Breathing idle: a slow chest rise and a little sway, quieter when slumped, gone when down.
  const breath = Math.sin(input.time * 1.6) * up;
  const sway = Math.sin(input.time * 0.7) * up;
  addBone(out, "Spine1", [-0.015 * breath, 0, 0.01 * sway]);
  addBone(out, "Spine2", [-0.02 * breath, 0, 0]);
  addBone(out, "LeftShoulder", [0, 0, 0.015 * breath]);
  addBone(out, "RightShoulder", [0, 0, -0.015 * breath]);
  addBone(out, "Head", [0.01 * breath, 0.02 * sway, 0]);
  out.hips = [out.hips[0] + 0.006 * sway, out.hips[1] + 0.004 * breath, out.hips[2]];
  return out;
}

function add(out: Pose, p: Pose, w: number) {
  if (w <= 0) return;
  for (const k of Object.keys(p.bones) as PosedBone[]) addBone(out, k, scale(p.bones[k]!, w));
  out.hips = sum(out.hips, scale(p.hips, w));
  out.root = sum(out.root, scale(p.root, w));
  out.lift += p.lift * w;
}

function addBone(out: Pose, bone: PosedBone, e: Euler3) {
  out.bones[bone] = sum(out.bones[bone] ?? ZERO, e);
}

const sum = (a: Euler3, b: Euler3): Euler3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Euler3, w: number): Euler3 => [a[0] * w, a[1] * w, a[2] * w];
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
