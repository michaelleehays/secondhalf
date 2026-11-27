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

/** Three angles (x, y, z). A Float64Array, so writing them every frame never boxes a number. */
export type Euler3 = Float64Array;
type Euler3In = readonly [number, number, number];

export interface Pose {
  /** Every posed bone, always present. */
  bones: Record<PosedBone, Euler3>;
  /** Hip offset in character space, metres. */
  hips: Euler3;
  /** Whole-body rotation, character space, applied pitch first then yaw (Euler order "YXZ"). */
  root: Euler3;
  /** Whole-body lift, metres (for a hop, or lying on the ground). */
  lift: number;
}

interface PoseLayer {
  bones: Partial<Record<PosedBone, Euler3In>>;
  hips?: Euler3In;
  root?: Euler3In;
  lift?: number;
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
  /** 0 standing still .. 1 walking. Optional, default 0. */
  walk?: number;
  /** Walk cycle phase in radians; one stride per 2π. */
  walkPhase?: number;
}

/** Rest is an A-pose: drop the arms to the sides and keep a slight bend at the elbow. */
const STANDING: PoseLayer = {
  bones: {
    LeftArm: [0.05, 0, -0.7],
    RightArm: [0.05, 0, 0.7],
    LeftForeArm: [0.15, 0, 0],
    RightForeArm: [0.15, 0, 0],
  },
};

/** Head down, chest caved, shoulders rolled forward (about y, so the arms stay at the sides). */
const SLUMPED: PoseLayer = {
  bones: {
    Spine1: [0.12, 0, 0],
    Spine2: [0.14, 0, 0],
    Neck: [0.16, 0, 0],
    Head: [0.24, 0, 0],
    LeftShoulder: [0.06, -0.12, -0.03],
    RightShoulder: [0.06, 0.12, 0.03],
  },
  hips: [0, -0.03, 0],
};

/**
 * On the back on the ground, knees up, arms out. The body falls backward, then turns a quarter so
 * it lies along the slope's contour instead of into the hill behind it. The rig keeps the pelvis
 * over the spot while it falls (see athlete.ts).
 */
const DOWN: PoseLayer = {
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
  root: [-Math.PI / 2, Math.PI / 2, 0],
  lift: 0.1,
};

/** Snapped back and twisted, as if struck in the chest. */
const HIT: PoseLayer = {
  bones: {
    Spine1: [-0.22, 0.14, 0],
    Spine2: [-0.5, 0.28, 0],
    Head: [-0.4, -0.2, 0],
    LeftArm: [-0.45, 0, 0.35],
    RightArm: [-0.45, 0, -0.35],
  },
  hips: [0, 0, -0.08],
};

/** Both arms overhead, chest and chin up. The raise is split between shoulders and upper arms. */
const ARMS_UP: PoseLayer = {
  bones: {
    LeftShoulder: [0, 0, 0.4],
    RightShoulder: [0, 0, -0.4],
    LeftArm: [0, 0, 2.3],
    RightArm: [0, 0, -2.3],
    LeftForeArm: [-0.2, 0, 0],
    RightForeArm: [-0.2, 0, 0],
    Spine2: [-0.12, 0, 0],
    Head: [-0.25, 0, 0],
  },
};

/** Celebration length in seconds; the caller advances `celebrate` by dt / this. */
export const CELEBRATE_SECONDS = 1.8;
/** Hit reaction decay rate (per second). */
export const HIT_DECAY = 2.2;

/** A pose with every bone at zero. Reuse one per athlete and pass it to poseAt. */
export function emptyPose(): Pose {
  const bones = {} as Record<PosedBone, Euler3>;
  for (const b of POSED_BONES) bones[b] = new Float64Array(3);
  return { bones, hips: new Float64Array(3), root: new Float64Array(3), lift: 0 };
}

/**
 * Scratch for the per-frame maths: [0..2] an Euler delta, [3] a layer weight. Passing decimals as
 * call arguments can box them (allocate) when V8 doesn't inline the call, so the hot path hands
 * them over through this typed array instead.
 */
const D = new Float64Array(4);
const W = 3;

/** Adds D[0..2] to `e`. */
function addD(e: Euler3) {
  e[0] = e[0]! + D[0]!;
  e[1] = e[1]! + D[1]!;
  e[2] = e[2]! + D[2]!;
}
function delta(x: number, y: number, z: number) {
  D[0] = x;
  D[1] = y;
  D[2] = z;
}

/** Builds the full pose for this frame into `out` (allocated when omitted). */
export function poseAt(input: PoseInput, out: Pose = emptyPose()): Pose {
  for (let i = 0; i < POSED_BONES.length; i++) out.bones[POSED_BONES[i]!].fill(0);
  out.hips.fill(0);
  out.root.fill(0);
  out.lift = 0;
  const down = clamp01(input.down);
  const up = 1 - down;

  D[W] = 1;
  add(out, STANDING);
  D[W] = clamp01(input.slump) * up;
  add(out, SLUMPED);
  D[W] = clamp01(input.hit);
  add(out, HIT);
  D[W] = down;
  add(out, DOWN);

  // Celebration: arms rise, hold, then come down, with two small hops while they are up.
  const c = clamp01(input.celebrate);
  if (c > 0 && c < 1) {
    const raise = smooth(c / 0.2) * (1 - smooth((c - 0.75) / 0.25));
    D[W] = raise * up;
    add(out, ARMS_UP);
    out.lift += Math.max(0, Math.sin(c * Math.PI * 4)) * 0.12 * raise * up;
  }

  // Walk cycle: legs swing in opposition, knees fold on the back swing, arms counter-swing.
  const walk = clamp01(input.walk ?? 0) * up;
  if (walk > 0) {
    const ph = input.walkPhase ?? 0;
    const sw = Math.sin(ph);
    const b = out.bones;
    b.LeftUpLeg[0] = b.LeftUpLeg[0]! + 0.45 * sw * walk;
    b.RightUpLeg[0] = b.RightUpLeg[0]! - 0.45 * sw * walk;
    b.LeftLeg[0] = b.LeftLeg[0]! - 0.6 * Math.max(0, -sw) * walk;
    b.RightLeg[0] = b.RightLeg[0]! - 0.6 * Math.max(0, sw) * walk;
    b.LeftArm[0] = b.LeftArm[0]! - 0.35 * sw * walk;
    b.RightArm[0] = b.RightArm[0]! + 0.35 * sw * walk;
    b.Spine1[0] = b.Spine1[0]! + 0.04 * walk;
    b.Spine1[1] = b.Spine1[1]! + 0.06 * sw * walk;
    out.hips[1] = out.hips[1]! + 0.025 * Math.abs(Math.cos(ph)) * walk - 0.02 * walk;
  }

  // Breathing idle: a slow chest rise and a little sway, gone when down.
  const breath = Math.sin(input.time * 1.6) * up;
  const sway = Math.sin(input.time * 0.7) * up;
  const b = out.bones;
  b.Spine1[0] = b.Spine1[0]! - 0.015 * breath;
  b.Spine1[2] = b.Spine1[2]! + 0.01 * sway;
  b.Spine2[0] = b.Spine2[0]! - 0.02 * breath;
  b.LeftShoulder[2] = b.LeftShoulder[2]! + 0.015 * breath;
  b.RightShoulder[2] = b.RightShoulder[2]! - 0.015 * breath;
  b.Head[0] = b.Head[0]! + 0.01 * breath;
  b.Head[1] = b.Head[1]! + 0.02 * sway;
  out.hips[0] = out.hips[0]! + 0.006 * sway;
  out.hips[1] = out.hips[1]! + 0.004 * breath;
  return out;
}

/** Each layer's bones as a flat list, built once, so the per-frame loop doesn't enumerate keys. */
const LAYER_BONES = new WeakMap<PoseLayer, { bone: PosedBone; e: Euler3In }[]>();
function layerBones(layer: PoseLayer) {
  let list = LAYER_BONES.get(layer);
  if (!list) {
    list = (Object.keys(layer.bones) as PosedBone[]).map((bone) => ({ bone, e: layer.bones[bone]! }));
    LAYER_BONES.set(layer, list);
  }
  return list;
}

/** Adds `layer` to `out`, weighted by D[W]. */
function add(out: Pose, layer: PoseLayer) {
  const w = D[W]!;
  if (w <= 0) return;
  const list = layerBones(layer);
  for (let i = 0; i < list.length; i++) {
    const { bone, e } = list[i]!;
    delta(e[0] * w, e[1] * w, e[2] * w);
    addD(out.bones[bone]);
  }
  if (layer.hips) {
    delta(layer.hips[0] * w, layer.hips[1] * w, layer.hips[2] * w);
    addD(out.hips);
  }
  if (layer.root) {
    delta(layer.root[0] * w, layer.root[1] * w, layer.root[2] * w);
    addD(out.root);
  }
  out.lift += (layer.lift ?? 0) * w;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
