import * as THREE from "three";
import { AREAS, type AreaId } from "@second-half/contracts";
import type { CellLook } from "./cells";
import { RING_OUTER, SECTOR_SPAN_DEG, SECTOR_START_DEG, cellIndex, heightAt, sectorMidRad } from "./layout";
import { groundLabel, textTexture } from "./text";

const AREA_NAMES: Record<AreaId, string> = { body: "BODY", mind: "MIND", work: "WORK", people: "PEOPLE", money: "MONEY" };
/** Section names lie on the plain just outside the base, beyond the Resistance markers. */
const NAME_RADIUS = 25.6;

/**
 * Words on the mountain itself: each section's name around the base, and the level (101, 201, ...)
 * in every cell. Level labels fade with the cell's linework, so unexplored ground stays quiet.
 */
export function createMountainLabels() {
  const group = new THREE.Group();
  group.name = "mountain-labels";
  const levelLabels: { index: number; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> }[] = [];
  const textures: THREE.Texture[] = [];

  for (const area of AREAS) {
    const tex = textTexture([{ text: AREA_NAMES[area], size: 84, weight: 800, tracking: 14, color: "#e8e4da" }], 512, 128);
    if (!tex) continue;
    textures.push(tex);
    const a = sectorMidRad(area);
    const x = Math.sin(a) * NAME_RADIUS;
    const z = Math.cos(a) * NAME_RADIUS;
    group.add(groundLabel(tex, 5.2, 1.3, x, heightAt(x, z), z, 0.92));
  }

  const levelTex = new Map<number, THREE.Texture>();
  for (const level of [1, 2, 3, 4] as const) {
    const tex = textTexture([{ text: `${level}01`, size: 92, weight: 800, color: "#efece4" }], 256, 128);
    if (tex) {
      textures.push(tex);
      levelTex.set(level, tex);
    }
  }
  for (const area of AREAS) {
    for (const level of [1, 2, 3, 4] as const) {
      const tex = levelTex.get(level);
      if (!tex) continue;
      // Toward the slice's left edge, mid-band, so the middle stays free for the trail and flags.
      const r = (RING_OUTER[level - 1]! + RING_OUTER[level]!) / 2;
      const a = ((SECTOR_START_DEG[area] + SECTOR_SPAN_DEG * 0.2) * Math.PI) / 180;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const size = 0.9 + level * -0.08 + r * 0.04;
      const mesh = groundLabel(tex, size * 2, size, x, heightAt(x, z), z, 0.7);
      group.add(mesh);
      levelLabels.push({ index: cellIndex(area, level), mesh });
    }
  }

  return {
    group,
    /** Fade level labels with the cell's linework. */
    setCells(looks: readonly CellLook[]) {
      for (const { index, mesh } of levelLabels) {
        const look = looks[index];
        if (look) mesh.material.opacity = 0.3 + 0.55 * look.lines;
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      for (const t of textures) t.dispose();
    },
  };
}

