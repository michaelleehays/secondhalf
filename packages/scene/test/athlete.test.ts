import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { KIT_NODES, athleteModelUrl, createAthlete, disposeMaterial } from "../src/athlete";
import { loadGlb as load, texturesOf } from "./loadGlb";

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

  it("lies down over its spot when knocked down, with the tap capsule lying flat", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    a.setView({ ...standing, health: 0, knockedDown: true });
    a.tick(0.016, 0);
    expect(a.down).toBe(1);
    a.root.updateMatrixWorld(true);
    const head = model.getObjectByName("mixamorigHead")!.getWorldPosition(new THREE.Vector3());
    const pelvis = model.getObjectByName("mixamorigHips")!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeLessThan(0.6);
    // The pelvis stays over the spot (inside the 0.75 m ring) and close to the ground.
    expect(Math.hypot(pelvis.x, pelvis.z)).toBeLessThan(0.3);
    expect(pelvis.y).toBeLessThan(0.35);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(a.hitProxy.getWorldQuaternion(new THREE.Quaternion()));
    expect(Math.abs(axis.y)).toBeLessThan(0.2);
  });

  it("disposes textures, materials, geometry and skeletons", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    const tex = new THREE.Texture();
    let mesh: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const m = mesh! as THREE.SkinnedMesh;
    (m.material as THREE.MeshStandardMaterial).map = tex;
    let texDisposed = 0;
    let skelDisposed = 0;
    tex.addEventListener("dispose", () => texDisposed++);
    const orig = m.skeleton.dispose.bind(m.skeleton);
    m.skeleton.dispose = () => {
      skelDisposed++;
      orig();
    };
    a.dispose();
    expect(texDisposed).toBe(1);
    expect(skelDisposed).toBe(1);
  });
});

describe("athleteModelUrl", () => {
  it("picks the lighter model on phones", () => {
    expect(athleteModelUrl("/assets/", true)).toBe("/assets/models/athlete_mobile.glb");
    expect(athleteModelUrl("", false)).toBe("/models/athlete.glb");
  });
});

describe("disposeMaterial", () => {
  it("disposes every texture slot", () => {
    const mat = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
    let n = 0;
    mat.map!.addEventListener("dispose", () => n++);
    mat.normalMap!.addEventListener("dispose", () => n++);
    disposeMaterial(mat);
    expect(n).toBe(2);
  });
});

describe("prepareMaterialTextures", () => {
  it("puts colour maps in sRGB and data maps in linear, and raises anisotropy", async () => {
    const { prepareMaterialTextures } = await import("../src/athlete");
    const mat = new THREE.MeshPhysicalMaterial({
      map: new THREE.Texture(),
      emissiveMap: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
    });
    mat.normalMap!.colorSpace = THREE.SRGBColorSpace; // wrong on purpose
    prepareMaterialTextures(mat, 16);
    expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mat.emissiveMap!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mat.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(mat.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(mat.map!.anisotropy).toBe(8);
  });

  it("keeps a textured skin material on the athlete", async () => {
    const model = await load("athlete_mobile.glb");
    let skin: THREE.MeshStandardMaterial | null = null;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.name === "Skin") skin = mat as THREE.MeshStandardMaterial;
    });
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.NoColorSpace;
    skin!.map = tex;
    createAthlete(model);
    expect(skin!.map).toBe(tex);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});

describe.each(["athlete.glb", "athlete_mobile.glb"])("textures in %s", (file) => {
  it("sets colour spaces, and disposes every texture with the athlete", async () => {
    const model = await load(file);
    const a = createAthlete(model);
    const textures = texturesOf(model);
    // Untextured models (before workstream D's skin) have no images and so no textures.
    if (model.userData.imageCount > 0) {
      expect(textures.length).toBeGreaterThan(0);
      const skin = textures.filter((t) => t.material === "Skin");
      expect(skin.find((t) => t.slot === "map")?.texture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(skin.find((t) => t.slot === "normalMap")?.texture.colorSpace).toBe(THREE.NoColorSpace);
    }
    for (const { slot, texture } of textures) {
      const color = slot === "map" || slot === "emissiveMap";
      expect(texture.colorSpace, `${slot} of ${texture.name}`).toBe(color ? THREE.SRGBColorSpace : THREE.NoColorSpace);
    }
    const disposed = new Set<THREE.Texture>();
    for (const { texture } of textures) texture.addEventListener("dispose", () => disposed.add(texture));
    a.dispose();
    expect(disposed.size).toBe(new Set(textures.map((t) => t.texture)).size);
  });

  it("keeps face and kit-free nodes visible: eyebrows, eyelashes and teeth when present", async () => {
    const model = await load(file);
    createAthlete(model);
    for (const name of ["body", "eyes", "shorts", "eyebrows", "eyelashes", "teeth"]) {
      const node = model.getObjectByName(name);
      if (node) expect(node.visible, name).toBe(true);
    }
  });
});
