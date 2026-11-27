import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createTerrain } from "../src/terrain";
import { cellIndex } from "../src/layout";

describe("terrain cell effects", () => {
  it("start on the given cell and fade out", () => {
    const t = createTerrain({ segments: 8 });
    const i = cellIndex("money", 1);
    t.flashCell(i, new THREE.Color(1, 1, 1), 1);
    t.pulseCell(i);
    t.darkenCell(i);
    t.shakeCell(i);
    const mat = t.mesh.material as THREE.MeshStandardMaterial;
    const shader = { uniforms: {} as Record<string, { value: THREE.Vector4[] }>, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>" };
    mat.onBeforeCompile(shader as never, undefined as never);
    const fx = shader.uniforms.uFx!.value;
    const fx2 = shader.uniforms.uFx2!.value;
    expect(fx[i]!.w).toBe(1);
    expect([fx2[i]!.x, fx2[i]!.y, fx2[i]!.z]).toEqual([1, 1, 1]);
    expect(fx[cellIndex("money", 2)]!.w).toBe(0);
    expect(shader.vertexShader).toContain("uFx2[idx].z");
    for (let k = 0; k < 100; k++) t.tick(k * 0.05, 0.05);
    expect(fx[i]!.w).toBe(0);
    expect([fx2[i]!.x, fx2[i]!.y, fx2[i]!.z]).toEqual([0, 0, 0]);
    t.dispose();
  });
});
