/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Loads an athlete GLB in Node for tests.
 *
 * Node has no image decoder, so GLTFLoader can't load embedded JPEG/PNG textures. This plugin
 * replaces each glTF texture with an empty THREE.Texture that keeps the source's name and MIME
 * type in userData. Materials still get a texture in every slot the file uses, and GLTFLoader still
 * sets colour space and flipY on it, so tests can check textures without decoding pixels.
 *
 * Models come from the repo's assets/models, or from the folder in SCENE_TEST_MODELS (to test
 * against another branch's models before they merge).
 */
const MODELS = process.env.SCENE_TEST_MODELS ?? join(fileURLToPath(new URL(".", import.meta.url)), "../../../assets/models");

class StubTextures implements GLTFLoaderPlugin {
  readonly name = "stub_textures";
  constructor(private parser: GLTFParser) {}
  loadTexture(index: number): Promise<THREE.Texture> {
    const json = this.parser.json as { textures: { source?: number }[]; images?: { name?: string; mimeType?: string }[] };
    const image = json.images?.[json.textures[index]?.source ?? -1];
    const tex = new THREE.Texture();
    tex.flipY = false; // what GLTFLoader does for real textures
    tex.name = image?.name ?? `texture-${index}`;
    tex.userData = { stub: true, mimeType: image?.mimeType };
    return Promise.resolve(tex);
  }
}

export async function loadGlb(file: string): Promise<THREE.Group> {
  const buf = readFileSync(join(MODELS, file));
  const loader = new GLTFLoader();
  loader.register((parser) => new StubTextures(parser));
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
  /** How many images the file embeds, so tests can tell a textured model from an untextured one. */
  gltf.scene.userData.imageCount = ((gltf.parser.json as { images?: unknown[] }).images ?? []).length;
  return gltf.scene;
}

/** Every texture on every material in the model. */
export function texturesOf(model: THREE.Object3D): { slot: string; material: string; texture: THREE.Texture }[] {
  const out: { slot: string; material: string; texture: THREE.Texture }[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const [slot, v] of Object.entries(mat)) {
        if (v && (v as THREE.Texture).isTexture) out.push({ slot, material: mat.name, texture: v as THREE.Texture });
      }
    }
  });
  return out;
}
