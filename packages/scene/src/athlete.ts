import * as THREE from "three";
import type { WorldView } from "@second-half/contracts";
import { CELEBRATE_SECONDS, HIT_DECAY, POSED_BONES, emptyPose, poseAt, type PoseInput, type PosedBone } from "./poses";

/** Kit nodes in the athlete model (see assets/models/athlete.manifest.json). Hidden by default. */
export const KIT_NODES = ["kit_jacket", "kit_shoes", "kit_watch", "kit_wraps"] as const;
export type KitNode = (typeof KIT_NODES)[number];

/** Morph target names on every athlete mesh. */
const MORPH_SOFT = "soft";
const MORPH_ATHLETIC = "athletic";

/** Seconds-to-90% style smoothing rates for state changes coming from WorldView. */
const EASE = { build: 0.2, slump: 0.05, down: 0.02 };

export interface Athlete {
  /** Place this in the scene; it stands on its local origin and faces +z. */
  root: THREE.Group;
  /** Mesh for tap tests (a simple capsule that follows the body, not the skinned mesh). */
  hitProxy: THREE.Object3D;
  /** 0 standing .. 1 lying down, eased. The scene uses it to tilt the body onto the slope and to frame it. */
  readonly down: number;
  setView(view: WorldView["athlete"]): void;
  setKit(node: KitNode, visible: boolean): void;
  hit(strength?: number): void;
  celebrate(): void;
  /** Force the down pose until the next view says otherwise. */
  knockDown(): void;
  /**
   * Locomotion from the scene: `walk` 0..1 blends the walk cycle in, `phase` advances with
   * distance travelled, `facing` is the yaw (radians, 0 = facing +z) the body turns to.
   */
  setMotion(walk: number, phase: number, facing: number): void;
  tick(dt: number, time: number): void;
  dispose(): void;
}

interface RigBone {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Rest orientation in character space. */
  world: THREE.Quaternion;
  worldInv: THREE.Quaternion;
}

/** Wraps a loaded athlete glTF scene. Pure presentation: it reads WorldView.athlete only. */
export function createAthlete(model: THREE.Object3D): Athlete {
  const root = new THREE.Group();
  root.name = "athlete";
  const body = new THREE.Group();
  body.rotation.order = "YXZ";
  root.add(body);
  body.add(model);

  const morphMeshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.frustumCulled = false;
      if (m.morphTargetDictionary && m.morphTargetInfluences) morphMeshes.push(m);
    }
  });

  const kit = new Map<KitNode, THREE.Object3D>();
  for (const name of KIT_NODES) {
    const node = model.getObjectByName(name);
    if (node) {
      node.visible = false;
      kit.set(name, node);
    }
  }

  // Bones by Mixamo name. GLTFLoader strips the ":" so "mixamorig:Hips" arrives as "mixamorigHips".
  model.updateMatrixWorld(true);
  const modelInv = new THREE.Quaternion();
  model.getWorldQuaternion(modelInv).invert();
  const bones = new Map<PosedBone, RigBone>();
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const key = POSED_BONES.find((b) => o.name === `mixamorig${b}` || o.name === `mixamorig:${b}`);
    if (!key) return;
    const world = modelInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    bones.set(key, { bone: o as THREE.Bone, rest: o.quaternion.clone(), world, worldInv: world.clone().invert() });
  });
  const hips = bones.get("Hips");
  const hipsRest = hips ? hips.bone.position.clone() : new THREE.Vector3();
  const hipsParentInv = new THREE.Quaternion();
  if (hips?.bone.parent) hipsParentInv.copy(modelInv).multiply(hips.bone.parent.getWorldQuaternion(new THREE.Quaternion())).invert();

  // Tap proxy: an invisible capsule around the body. It sits in `body`, so it falls with the athlete.
  const hitProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.9, 8), new THREE.MeshBasicMaterial());
  hitProxy.position.y = 0.95;
  hitProxy.visible = false;
  hitProxy.name = "athlete-hit";
  body.add(hitProxy);

  let target = { build: 0, slump: 0, down: 0 };
  const cur = { build: 0, slump: 0, down: 0 };
  let hitAmt = 0;
  let celebrate = 0;
  let walk = 0;
  let walkPhase = 0;
  let facing = 0;
  let first = true;

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const pose = emptyPose();
  const poseInput: PoseInput = { time: 0, slump: 0, down: 0, hit: 0, celebrate: 0, walk: 0, walkPhase: 0 };
  const r = new THREE.Quaternion();
  /** Pelvis position at rest in character space (root and body are at the origin while we build). */
  const pelvis = hips ? hips.bone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);

  function applyMorphs() {
    const soft = Math.max(0, -cur.build);
    const athletic = Math.max(0, cur.build);
    for (const m of morphMeshes) {
      const d = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      if (d[MORPH_SOFT] !== undefined) inf[d[MORPH_SOFT]] = soft;
      if (d[MORPH_ATHLETIC] !== undefined) inf[d[MORPH_ATHLETIC]] = athletic;
    }
  }

  return {
    root,
    hitProxy,
    setView(a) {
      target = { build: clamp(a.build, -1, 1), slump: clamp(a.slump, 0, 1), down: a.knockedDown ? 1 : 0 };
      if (first) {
        Object.assign(cur, target);
        first = false;
      }
    },
    setKit(node, visible) {
      const n = kit.get(node);
      if (n) n.visible = visible;
    },
    hit(strength = 1) {
      hitAmt = Math.max(hitAmt, clamp(strength, 0, 1));
    },
    celebrate() {
      if (cur.down < 0.5) celebrate = 1e-4;
    },
    knockDown() {
      target = { ...target, down: 1 };
    },
    setMotion(w, phase, yaw) {
      walk = clamp(w, 0, 1);
      walkPhase = phase;
      facing = yaw;
    },
    tick(dt, time) {
      cur.build += (target.build - cur.build) * (1 - Math.pow(EASE.build, dt));
      cur.slump += (target.slump - cur.slump) * (1 - Math.pow(EASE.slump, dt));
      cur.down += (target.down - cur.down) * (1 - Math.pow(EASE.down, dt));
      hitAmt = Math.max(0, hitAmt - dt * HIT_DECAY);
      if (celebrate > 0) {
        celebrate += dt / CELEBRATE_SECONDS;
        if (celebrate >= 1) celebrate = 0;
      }
      applyMorphs();

      poseInput.time = time;
      poseInput.slump = cur.slump;
      poseInput.down = cur.down;
      poseInput.hit = hitAmt;
      poseInput.celebrate = celebrate;
      poseInput.walk = walk;
      poseInput.walkPhase = walkPhase;
      poseAt(poseInput, pose);
      for (const [key, rb] of bones) {
        const off = pose.bones[key];
        // Character-space rotation R becomes a local offset W⁻¹·R·W on top of the rest pose.
        q.setFromEuler(e.set(off[0], off[1], off[2]));
        rb.bone.quaternion.copy(rb.rest).multiply(rb.worldInv).multiply(q).multiply(rb.world);
      }
      if (hips) {
        v.set(pose.hips[0], pose.hips[1], pose.hips[2]).applyQuaternion(hipsParentInv);
        hips.bone.position.copy(hipsRest).add(v);
      }
      body.rotation.set(pose.root[0], pose.root[1] + facing, pose.root[2]);
      // Turn about the pelvis rather than the feet, so a fall keeps the body over its spot.
      v.copy(pelvis).applyQuaternion(r.setFromEuler(body.rotation)).sub(pelvis);
      body.position.set(-v.x, pose.lift, -v.z);
    },
    get down() {
      return cur.down;
    },
    dispose() {
      hitProxy.geometry.dispose();
      (hitProxy.material as THREE.Material).dispose();
      // Meshes share one skeleton, and may share materials, so collect them once.
      const materials = new Set<THREE.Material>();
      const skeletons = new Set<THREE.Skeleton>();
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((o as THREE.SkinnedMesh).skeleton);
      });
      materials.forEach(disposeMaterial);
      skeletons.forEach((sk) => sk.dispose());
    },
  };
}

/** Disposes a material and every texture it holds (maps, normal maps, and so on). */
export function disposeMaterial(mat: THREE.Material) {
  for (const value of Object.values(mat)) {
    if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
  }
  mat.dispose();
}

/** Model file for this device: the lighter one on phones. */
export function athleteModelUrl(assetsBaseUrl: string, phone: boolean): string {
  const base = assetsBaseUrl.replace(/\/+$/, "");
  return `${base}/models/${phone ? "athlete_mobile.glb" : "athlete.glb"}`;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo);
