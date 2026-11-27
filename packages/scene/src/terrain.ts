import * as THREE from "three";
import { AREAS, type CellView } from "@second-half/contracts";
import { AREA_TINT_SCALE, areaOfIndex, cellLooks } from "./cells";
import { CELL_COUNT, PEAK_HEIGHT, RING_OUTER, SECTOR_SPAN_DEG, SECTOR_START_DEG, heightAt, ringAt } from "./layout";
import { AREA_HEX, WORLD_HEX } from "./palette";

/**
 * The mountain mesh. Elevation tint lives in vertex colours; everything the game drives
 * (cell colour, progress sweep, risk pulse, frozen and hidden dimming) is computed per fragment,
 * so cell edges stay crisp at any mesh resolution.
 */
export interface Terrain {
  mesh: THREE.Mesh;
  /** Ring and sector guide lines plus the summit beacon. */
  extras: THREE.Group;
  /** The beacon above the summit (tap target for The Vision). */
  summit: THREE.Object3D;
  setCells(cells: readonly CellView[]): void;
  /** Seconds, for the risk pulse. Pass a constant to stop motion. */
  tick(time: number): void;
  dispose(): void;
}

export interface TerrainOptions {
  /** Grid segments per side. Lower on phones. */
  segments: number;
}

const SIZE = 64;
const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Shader constants come from layout.ts so the GPU and the hit test agree on every boundary. */
const SHADER_DEFS = `
uniform float uTime;
uniform vec4 uFill[${CELL_COUNT}];
uniform vec4 uMeta[${CELL_COUNT}];
varying vec3 vTerrainPos;
const float RING_R[5] = float[5](${RING_OUTER.map(glslFloat).join(",")});
const float SECTOR_A0[5] = float[5](${AREAS.map((a) => glslFloat(SECTOR_START_DEG[a])).join(",")});
const float SECTOR_SPAN = ${glslFloat(SECTOR_SPAN_DEG)};
const vec3 RISK_RGB = vec3(${riskLinear()});
`;

const SHADER_CELLS = `
  {
    float rr = length(vTerrainPos.xz);
    float ang = degrees(atan(vTerrainPos.x, vTerrainPos.z));
    int ring = rr < RING_R[4] ? 5 : (rr < RING_R[3] ? 4 : (rr < RING_R[2] ? 3 : (rr < RING_R[1] ? 2 : (rr < RING_R[0] ? 1 : 0))));
    float riskAmp = 0.0;
    if (ring >= 1 && ring <= 4) {
      int sec = 0; float fr = 0.0;
      for (int s = 0; s < 5; s++) {
        float d = mod(ang - SECTOR_A0[s] + 720.0, 360.0);
        if (d < SECTOR_SPAN) { sec = s; fr = d / SECTOR_SPAN; }
      }
      int idx = (ring - 1) * 5 + sec;
      vec4 F = uFill[idx];   // rgb tint, fill over the done part
      vec4 M = uMeta[idx];   // progress, fill over the rest, risk amplitude, brightness
      float m = fr <= M.x ? F.w : M.y;
      diffuseColor.rgb = mix(diffuseColor.rgb, F.rgb, m) * M.w;
      riskAmp = M.z;
      // Darken a thin band along sector edges (in world units) for crisp cell borders.
      float edge = min(fr, 1.0 - fr) * radians(SECTOR_SPAN) * rr;
      diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.1, edge));
    }
    // Contour lines, every fourth one stronger.
    float ch = vTerrainPos.y * 2.2;
    float f = fract(ch);
    float w = fwidth(ch);
    float line = 1.0 - smoothstep(0.0, w * 1.3, min(f, 1.0 - f));
    float major = step(0.5, 1.0 - abs(mod(floor(ch + 0.5), 4.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.42, line * (0.45 + 0.3 * major) * step(-0.05, vTerrainPos.y));
    float pulse = 0.5 + 0.5 * sin(uTime * 3.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, RISK_RGB, riskAmp * (0.18 + 0.3 * pulse));
  }
`;

function riskLinear(): string {
  const c = new THREE.Color(WORLD_HEX.risk);
  return [c.r, c.g, c.b].map((n) => n.toFixed(4)).join(",");
}

export function createTerrain(opts: TerrainOptions): Terrain {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, opts.segments, opts.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(WORLD_HEX.groundLow);
  const high = new THREE.Color(WORLD_HEX.groundHigh);
  const snow = new THREE.Color(WORLD_HEX.snow);
  const plain = new THREE.Color(WORLD_HEX.plain);
  const vision = new THREE.Color(WORLD_HEX.vision);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const ring = ringAt(Math.hypot(x, z));
    tmp.copy(low).lerp(high, Math.min(1, Math.max(0, (h / PEAK_HEIGHT) * 1.4)));
    if (h > PEAK_HEIGHT * 0.78) tmp.lerp(snow, Math.min(1, (h - PEAK_HEIGHT * 0.78) / (PEAK_HEIGHT * 0.22)) * 0.7);
    if (ring === 0) tmp.copy(plain);
    else if (ring === 5) tmp.lerp(vision, 0.45);
    tmp.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const uTime = { value: 0 };
  const uFill = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4()) };
  const uMeta = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4(0, 0, 0, 1)) };

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uFill = uFill;
    shader.uniforms.uMeta = uMeta;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTerrainPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTerrainPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SHADER_DEFS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SHADER_CELLS}`);
  };
  material.customProgramCacheKey = () => "second-half-terrain";

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;

  const areaTint = AREAS.map((a) => new THREE.Color(AREA_HEX[a]).multiplyScalar(AREA_TINT_SCALE));
  const lost = new THREE.Color(WORLD_HEX.lost);

  function setCells(cells: readonly CellView[]) {
    cellLooks(cells).forEach((look, i) => {
      const c = look.tint === "lost" ? lost : areaTint[AREAS.indexOf(areaOfIndex(i))]!;
      uFill.value[i]!.set(c.r, c.g, c.b, look.fill);
      uMeta.value[i]!.set(look.progress, look.restFill, look.riskPulse, look.brightness);
    });
  }
  setCells([]);

  const extras = buildExtras();
  const summit = extras.getObjectByName("summit")!;

  return {
    mesh,
    extras,
    summit,
    setCells,
    tick: (t) => {
      uTime.value = t;
      summit.rotation.y = t * 0.6;
    },
    dispose: () => {
      geo.dispose();
      material.dispose();
      extras.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** Faint guide lines along ring and sector borders, and the gold beacon on the summit. */
function buildExtras(): THREE.Group {
  const group = new THREE.Group();
  group.name = "terrain-extras";
  const lineMat = new THREE.LineBasicMaterial({ color: WORLD_HEX.ringLine, transparent: true, opacity: 0.22 });
  const lift = 0.06;
  for (const r of RING_OUTER) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 200; k++) {
      const a = (k / 200) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + lift, z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat.clone()));
  }
  for (const area of AREAS) {
    const ang = (SECTOR_START_DEG[area] * Math.PI) / 180;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 60; k++) {
      const r = RING_OUTER[4] + ((RING_OUTER[0] - RING_OUTER[4]) * k) / 60;
      const x = Math.sin(ang) * r;
      const z = Math.cos(ang) * r;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + lift, z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat.clone()));
  }
  lineMat.dispose();

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshStandardMaterial({ color: WORLD_HEX.summit, emissive: WORLD_HEX.summit, emissiveIntensity: 0.6, roughness: 0.3 }),
  );
  beacon.name = "summit";
  beacon.position.set(0, heightAt(0, 0) + 1.2, 0);
  group.add(beacon);
  const glow = new THREE.PointLight(0xffc870, 1.2, 10, 1);
  glow.position.copy(beacon.position);
  group.add(glow);
  return group;
}
