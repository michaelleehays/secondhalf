import * as THREE from "three";
import { AREAS, type CellView } from "@second-half/contracts";
import { cellLooks } from "./cells";
import { CELL_COUNT, PEAK_HEIGHT, RING_OUTER, SECTOR_SPAN_DEG, SECTOR_START_DEG, heightAt, ringAt } from "./layout";
import { WORLD_HEX } from "./palette";

/**
 * The mountain mesh: monochrome rock and snow. Elevation shading lives in vertex colours; everything
 * the game drives (ridge and ring lines, worked ground, haze over unexplored ground, the risk pulse,
 * event effects) is computed per fragment, so lines stay crisp at any mesh resolution.
 */
export interface Terrain {
  mesh: THREE.Mesh;
  /** Grid segments per side this terrain was built with. */
  segments: number;
  shading: "standard" | "lambert";
  /** The summit beacon and its light. */
  extras: THREE.Group;
  /** The beacon above the summit (tap target for The Vision). */
  summit: THREE.Object3D;
  /** Point light at the summit; hidden at low quality. */
  summitLight: THREE.Object3D;
  setCells(cells: readonly CellView[]): void;
  /** One-off cell effects for events, by cell index (see cellIndex). They fade on their own. */
  flashCell(index: number, color: THREE.Color, amount?: number): void;
  pulseCell(index: number, amount?: number): void;
  darkenCell(index: number, amount?: number): void;
  shakeCell(index: number, amount?: number): void;
  /** `time` in seconds drives the pulses (pass a constant to stop motion); `dt` fades the effects. */
  tick(time: number, dt: number): void;
  dispose(): void;
}

export interface TerrainOptions {
  /** Grid segments per side. Lower on phones. */
  segments: number;
  /** "lambert" is cheaper per pixel than "standard" (physically based); used at low quality. */
  shading?: "standard" | "lambert";
}

const SIZE = 64;
/** Share of the peak height where snow starts. */
const SNOW_LINE = 0.68;
/** How fast each one-off cell effect fades, per second (1 / duration). */
const FX_FADE = { flash: 1 / 1.2, pulse: 1 / 2.4, darken: 1 / 1.8, shake: 1 / 0.6 };
const glslFloat = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Shader constants come from layout.ts so the GPU and the hit test agree on every boundary. */
const SHADER_COMMON = `
uniform float uTime;
uniform vec4 uFx[${CELL_COUNT}];   // flash rgb, flash amount
uniform vec4 uFx2[${CELL_COUNT}];  // event pulse, darken, shake, unused
varying vec3 vTerrainPos;
const float RING_R[5] = float[5](${RING_OUTER.map(glslFloat).join(",")});
const float SECTOR_A0[5] = float[5](${AREAS.map((a) => glslFloat(SECTOR_START_DEG[a])).join(",")});
const float SECTOR_SPAN = ${glslFloat(SECTOR_SPAN_DEG)};
// Band at radius rr: 1..4 for a level ring, 5 for The Vision, 0 outside.
int ringAt(float rr) {
  return rr < RING_R[4] ? 5 : (rr < RING_R[3] ? 4 : (rr < RING_R[2] ? 3 : (rr < RING_R[1] ? 2 : (rr < RING_R[0] ? 1 : 0))));
}
// Sector index at (x, z), and how far across it (0..1).
int sectorAt(vec2 xz, out float fr) {
  float ang = degrees(atan(xz.x, xz.y));
  int sec = 0; fr = 0.0;
  for (int s = 0; s < 5; s++) {
    float d = mod(ang - SECTOR_A0[s] + 720.0, 360.0);
    if (d < SECTOR_SPAN) { sec = s; fr = d / SECTOR_SPAN; }
  }
  return sec;
}
`;

const SHADER_FRAG_DEFS = `
uniform vec4 uFill[${CELL_COUNT}];  // haze, line strength, lift over the done share, unused
uniform vec4 uMeta[${CELL_COUNT}];  // progress, unused, risk pulse amplitude, brightness
const vec3 RISK_RGB = vec3(${linear(WORLD_HEX.risk)});
const vec3 HAZE_RGB = vec3(${linear(WORLD_HEX.haze)});
const vec3 LINE_RGB = vec3(${linear(WORLD_HEX.ridgeLine)});
`;

/** Cells shake vertically (ground_lost) by moving the vertex, before projection. */
const SHADER_VERTEX = `
  vTerrainPos = position;
  {
    int ring = ringAt(length(position.xz));
    if (ring >= 1 && ring <= 4) {
      float fr;
      int idx = (ring - 1) * 5 + sectorAt(position.xz, fr);
      float sh = uFx2[idx].z;
      if (sh > 0.0) transformed.y += sh * 0.14 * sin(uTime * 48.0 + position.x * 2.3 + position.z * 1.7);
    }
  }
`;

const SHADER_CELLS = `
  {
    float rr = length(vTerrainPos.xz);
    int ring = ringAt(rr);
    float riskAmp = 0.0;
    float pulseAmp = 0.0;
    float lineStrength = 0.35;  // ring lines on the plain and the Vision
    float haze = 0.0;
    float fr = 0.0;
    if (ring >= 1 && ring <= 4) {
      int idx = (ring - 1) * 5 + sectorAt(vTerrainPos.xz, fr);
      vec4 F = uFill[idx];
      vec4 M = uMeta[idx];
      vec4 X = uFx[idx];     // event flash colour and amount
      vec4 Y = uFx2[idx];    // event pulse, darken, shake
      float lift = fr <= M.x ? F.z : 1.0;
      diffuseColor.rgb *= M.w * lift;
      diffuseColor.rgb *= 1.0 - 0.6 * Y.y;
      diffuseColor.rgb = mix(diffuseColor.rgb, X.rgb, X.w * 0.6);
      riskAmp = M.z;
      pulseAmp = Y.x;
      haze = F.x;
      lineStrength = F.y;
      // Ridge lines carve the five sections, from the Vision down to the base of 101.
      float edge = min(fr, 1.0 - fr) * radians(SECTOR_SPAN) * rr;
      float ew = max(fwidth(edge), 0.001);
      float ridge = 1.0 - smoothstep(0.03, 0.03 + ew * 1.5, edge);
      diffuseColor.rgb = mix(diffuseColor.rgb, LINE_RGB, ridge * (0.45 + 0.5 * lineStrength));
    }
    // Ring boundaries: subtle lines between levels.
    float dRing = 1e3;
    for (int i = 0; i < 5; i++) dRing = min(dRing, abs(rr - RING_R[i]));
    float rw = max(fwidth(rr), 0.001);
    float ringLine = 1.0 - smoothstep(0.015, 0.015 + rw * 1.5, dRing);
    diffuseColor.rgb = mix(diffuseColor.rgb, LINE_RGB, ringLine * (0.18 + 0.3 * lineStrength));
    // Contour lines, every fourth one stronger.
    float ch = vTerrainPos.y * 2.2;
    float f = fract(ch);
    float w = fwidth(ch);
    float line = 1.0 - smoothstep(0.0, w * 1.3, min(f, 1.0 - f));
    float major = step(0.5, 1.0 - abs(mod(floor(ch + 0.5), 4.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, line * (0.35 + 0.3 * major) * step(-0.05, vTerrainPos.y));
    // Unexplored ground sits under a light haze.
    diffuseColor.rgb = mix(diffuseColor.rgb, HAZE_RGB, haze * 0.55);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, RISK_RGB, riskAmp * (0.05 + 0.13 * pulse));
    // A one-off at_risk pulse: faster and stronger than the standing risk pulse.
    float fast = 0.5 + 0.5 * sin(uTime * 9.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, RISK_RGB, min(1.0, pulseAmp) * (0.25 + 0.45 * fast));
  }
`;

function linear(hex: string): string {
  const c = new THREE.Color(hex);
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
    if (h > PEAK_HEIGHT * SNOW_LINE) tmp.lerp(snow, Math.min(1, (h - PEAK_HEIGHT * SNOW_LINE) / (PEAK_HEIGHT * (1 - SNOW_LINE))) * 0.85);
    if (ring === 0) tmp.copy(plain);
    else if (ring === 5) tmp.lerp(vision, 0.45);
    tmp.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const uTime = { value: 0 };
  const uFill = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4()) };
  const uMeta = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4(0, 0, 0, 1)) };
  // Vector4 defaults w to 1, so set all four: effects start off.
  const uFx = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4(0, 0, 0, 0)) };
  const uFx2 = { value: Array.from({ length: CELL_COUNT }, () => new THREE.Vector4(0, 0, 0, 0)) };

  const material =
    opts.shading === "lambert"
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uFill = uFill;
    shader.uniforms.uMeta = uMeta;
    shader.uniforms.uFx = uFx;
    shader.uniforms.uFx2 = uFx2;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${SHADER_COMMON}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${SHADER_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SHADER_COMMON}\n${SHADER_FRAG_DEFS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SHADER_CELLS}`);
  };
  material.customProgramCacheKey = () => `second-half-terrain-${opts.shading ?? "standard"}`;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;


  function setCells(cells: readonly CellView[]) {
    cellLooks(cells).forEach((look, i) => {
      uFill.value[i]!.set(look.haze, look.lines, look.doneLift, 0);
      uMeta.value[i]!.set(look.progress, 0, look.riskPulse, look.brightness);
    });
  }
  setCells([]);

  const extras = buildExtras();
  const summit = extras.getObjectByName("summit")!;
  const summitLight = extras.getObjectByName("summit-light")!;

  return {
    mesh,
    segments: opts.segments,
    shading: opts.shading ?? "standard",
    extras,
    summit,
    summitLight,
    setCells,
    flashCell(i, color, amount = 1) {
      const v = uFx.value[i];
      if (v) v.set(color.r, color.g, color.b, Math.max(v.w, amount));
    },
    pulseCell(i, amount = 1) {
      const v = uFx2.value[i];
      if (v) v.x = Math.max(v.x, amount);
    },
    darkenCell(i, amount = 1) {
      const v = uFx2.value[i];
      if (v) v.y = Math.max(v.y, amount);
    },
    shakeCell(i, amount = 1) {
      const v = uFx2.value[i];
      if (v) v.z = Math.max(v.z, amount);
    },
    tick: (t, dt) => {
      uTime.value = t;
      summit.rotation.y = t * 0.6;
      for (let i = 0; i < CELL_COUNT; i++) {
        const a = uFx.value[i]!;
        const b = uFx2.value[i]!;
        a.w = fade(a.w, dt * FX_FADE.flash);
        b.x = fade(b.x, dt * FX_FADE.pulse);
        b.y = fade(b.y, dt * FX_FADE.darken);
        b.z = fade(b.z, dt * FX_FADE.shake);
      }
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

/** Steps an effect toward 0. Anything not a positive number (including NaN) ends at 0. */
function fade(v: number, by: number): number {
  const next = v - by;
  return next > 0 ? next : 0;
}

/** The gold beacon on the summit and its light. (Ridge and ring lines are drawn by the terrain shader.) */
function buildExtras(): THREE.Group {
  const group = new THREE.Group();
  group.name = "terrain-extras";

  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45),
    new THREE.MeshStandardMaterial({ color: WORLD_HEX.summit, emissive: WORLD_HEX.summit, emissiveIntensity: 0.6, roughness: 0.3 }),
  );
  beacon.name = "summit";
  beacon.position.set(0, heightAt(0, 0) + 1.2, 0);
  group.add(beacon);
  const glow = new THREE.PointLight(0xffc870, 1.2, 10, 1);
  glow.name = "summit-light";
  glow.position.copy(beacon.position);
  group.add(glow);
  return group;
}
