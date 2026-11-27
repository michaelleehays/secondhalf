import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KIT_NODES, athleteModelUrl, createAthlete } from "../src/athlete";

async function load(file: string) {
  const buf = readFileSync(new URL(`../../../assets/models/${file}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  return gltf.scene;
}

const standing = { health: 72, strength: 64, build: 0.35, slump: 0, knockedDown: false };

describe.each(["athlete.glb", "athlete_mobile.glb"])("createAthlete with %s", (file) => {
  it("hides every kit node by default and can show one", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    for (const k of KIT_NODES) expect(model.getObjectByName(k)?.visible).toBe(false);
    a.setKit("kit_shoes", true);
    expect(model.getObjectByName("kit_shoes")?.visible).toBe(true);
  });

  it("sets soft and athletic morphs from build on every mesh", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    a.setView({ ...standing, build: -0.5 });
    a.tick(0.016, 0);
    let meshes = 0;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary) return;
      meshes++;
      expect(m.morphTargetInfluences![m.morphTargetDictionary.soft!]).toBeCloseTo(0.5);
      expect(m.morphTargetInfluences![m.morphTargetDictionary.athletic!]).toBe(0);
    });
    expect(meshes).toBeGreaterThan(3);
  });

  it("bows the head when slumped", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    const head = model.getObjectByName("mixamorigHead")!;
    const nose = () => {
      model.updateMatrixWorld(true);
      return new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    };
    a.setView(standing);
    a.tick(0.016, 0);
    const upright = nose();
    a.setView({ ...standing, slump: 1 });
    for (let i = 0; i < 120; i++) a.tick(0.05, 0);
    const bowed = nose();
    // Facing +z, a bowed head turns its forward axis toward the ground.
    expect(upright.angleTo(bowed)).toBeGreaterThan(0.3);
  });

  it("lies down when knocked down", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    a.setView({ ...standing, health: 0, knockedDown: true });
    a.tick(0.016, 0);
    a.root.updateMatrixWorld(true);
    const head = model.getObjectByName("mixamorigHead")!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeLessThan(0.6);
  });
});

describe("athleteModelUrl", () => {
  it("picks the lighter model on phones", () => {
    expect(athleteModelUrl("/assets/", true)).toBe("/assets/models/athlete_mobile.glb");
    expect(athleteModelUrl("", false)).toBe("/models/athlete.glb");
  });
});
