import * as THREE from "three";
import type { AreaId, Level, ResistanceId, WorldView } from "@second-half/contracts";
import { cellCenter, resistanceSpot } from "./layout";
import { WORLD_HEX } from "./palette";

type ResistanceView = WorldView["resistance"][number];

/** Resistance strength runs 1..5 (see ResistanceState). Markers are drawn for that range. */
const STRENGTH_MAX = 5;
/** Height of the marker's crystal above the ground. */
const CRYSTAL_Y = 2.2;
/** Points along an attack line. */
const LINE_POINTS = 32;

/** Where an attack line ends: a cell, given by area and level. */
export interface AttackTarget {
  area: AreaId;
  level: Exclude<Level, 5>;
}

export interface ResistanceLayer {
  group: THREE.Group;
  /** Tap targets; `userData.resistance` holds the id and `userData.targetArea` the area. */
  hitProxies: THREE.Object3D[];
  /**
   * Draw the markers in the view. `resolve` turns an attackingGoalId into a cell, or null when it
   * can't (then no line is drawn).
   */
  update(entries: readonly ResistanceView[], resolve: (goalId: string) => AttackTarget | null): void;
  /** World position of a marker's crystal, written into `out`. False when the marker isn't shown. */
  crystalPosition(id: ResistanceId, out: THREE.Vector3): boolean;
  /** Flare a marker (it struck, e.g. on a setback). */
  strike(id: ResistanceId): void;
  tick(time: number, dt: number): void;
  dispose(): void;
}

interface Marker {
  id: ResistanceId;
  group: THREE.Group;
  crystal: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite;
  proxy: THREE.Mesh;
  line: THREE.Mesh<THREE.TubeGeometry, THREE.ShaderMaterial> | null;
  lineKey: string;
  /** Eased 0..1 share of max strength. */
  level: number;
  levelGoal: number;
  strike: number;
  phase: number;
}

/** Dashes that march along the tube from the marker to the cell it attacks. uv.x runs 0..1 along it. */
const DASH_VERTEX = `
uniform float uLength;
varying float vDist;
void main() {
  vDist = uv.x * uLength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const DASH_FRAGMENT = `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying float vDist;
void main() {
  if (fract(vDist / 0.9 - uTime * 1.4) > 0.55) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
`;
/** Attack line thickness (tube radius), metres. */
const LINE_RADIUS = 0.07;

export function createResistanceLayer(): ResistanceLayer {
  const group = new THREE.Group();
  group.name = "resistance";
  const crystalGeo = new THREE.OctahedronGeometry(0.55);
  const ringGeo = new THREE.RingGeometry(0.9, 1.05, 40);
  const proxyGeo = new THREE.SphereGeometry(1.1, 8, 6);
  const proxyMat = new THREE.MeshBasicMaterial();
  const glowTex = makeGlowTexture();
  const color = new THREE.Color(WORLD_HEX.risk);
  const uTime = { value: 0 };

  const markers = new Map<ResistanceId, Marker>();
  const hitProxies: THREE.Object3D[] = [];

  function marker(id: ResistanceId): Marker {
    let m = markers.get(id);
    if (m) return m;
    const g = new THREE.Group();
    g.name = `resistance-${id}`;
    const crystal = new THREE.Mesh(
      crystalGeo,
      new THREE.MeshStandardMaterial({ color: 0x7a1015, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 }),
    );
    crystal.position.y = CRYSTAL_Y;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = CRYSTAL_Y;
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.y = CRYSTAL_Y;
    proxy.visible = false;
    proxy.userData.resistance = id;
    g.add(crystal, ring, glow, proxy);
    group.add(g);
    hitProxies.push(proxy);
    m = { id, group: g, crystal, ring, glow, proxy, line: null, lineKey: "", level: 0, levelGoal: 0, strike: 0, phase: markers.size * 1.3 };
    markers.set(id, m);
    return m;
  }

  function removeLine(m: Marker) {
    if (!m.line) return;
    group.remove(m.line);
    m.line.geometry.dispose();
    m.line.material.dispose();
    m.line = null;
    m.lineKey = "";
  }

  function buildLine(m: Marker, target: AttackTarget) {
    removeLine(m);
    const p0 = m.group.position.clone();
    p0.y += CRYSTAL_Y;
    const p1 = new THREE.Vector3(...cellCenter(target.area, target.level, 0.4));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= LINE_POINTS; i++) {
      const t = i / LINE_POINTS;
      const p = new THREE.Vector3().lerpVectors(p0, p1, t);
      p.y += Math.sin(t * Math.PI) * 2.6;
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, LINE_POINTS * 2, LINE_RADIUS, 6, false);
    const mat = new THREE.ShaderMaterial({
      vertexShader: DASH_VERTEX,
      fragmentShader: DASH_FRAGMENT,
      uniforms: { uColor: { value: color }, uTime, uOpacity: { value: 0.95 }, uLength: { value: curve.getLength() } },
      transparent: true,
      depthWrite: false,
    });
    m.line = new THREE.Mesh(geo, mat);
    m.line.name = `attack-${m.id}`;
    group.add(m.line);
  }

  return {
    group,
    hitProxies,
    update(entries, resolve) {
      const seen = new Set<ResistanceId>();
      for (const r of entries) {
        seen.add(r.id);
        const m = marker(r.id);
        m.group.visible = true;
        m.group.position.set(...resistanceSpot(r.targetArea));
        m.proxy.userData.targetArea = r.targetArea;
        m.levelGoal = Math.max(0, Math.min(1, r.strength / STRENGTH_MAX));
        const target = r.attackingGoalId ? resolve(r.attackingGoalId) : null;
        const key = target ? `${r.targetArea}|${target.area}|${target.level}` : "";
        if (key !== m.lineKey) {
          if (target) buildLine(m, target);
          else removeLine(m);
          m.lineKey = key;
        }
      }
      for (const m of markers.values()) {
        if (seen.has(m.id)) continue;
        m.group.visible = false;
        removeLine(m);
      }
    },
    crystalPosition(id, out) {
      const m = markers.get(id);
      if (!m || !m.group.visible) return false;
      out.copy(m.group.position);
      out.y += CRYSTAL_Y;
      return true;
    },
    strike(id) {
      const m = markers.get(id);
      if (m) m.strike = 1;
    },
    tick(time, dt) {
      uTime.value = time;
      for (const m of markers.values()) {
        if (!m.group.visible) continue;
        m.level += (m.levelGoal - m.level) * (1 - Math.pow(0.05, dt));
        m.strike = Math.max(0, m.strike - dt * 1.5);
        const s = m.level * STRENGTH_MAX; // back to 0..5 for sizing
        const scale = (0.6 + s * 0.22) * (1 + 0.35 * m.strike);
        m.crystal.scale.setScalar(scale);
        m.crystal.rotation.y = time * 0.8 + m.phase;
        m.crystal.position.y = CRYSTAL_Y + Math.sin(time * 1.5 + m.phase) * 0.15;
        m.crystal.material.emissiveIntensity = 0.3 + s * 0.25 + m.strike * 1.5;
        m.glow.position.y = m.crystal.position.y;
        m.glow.scale.setScalar(1.2 + s * 0.55 + m.strike * 2);
        m.glow.material.opacity = 0.15 + s * 0.12 + m.strike * 0.4;
        m.ring.scale.setScalar(0.7 + s * 0.12 + 0.15 * Math.sin(time * 2 + m.phase));
        m.ring.material.opacity = 0.25 + s * 0.08;
      }
    },
    dispose() {
      for (const m of markers.values()) {
        removeLine(m);
        m.crystal.material.dispose();
        m.ring.material.dispose();
        m.glow.material.dispose();
      }
      crystalGeo.dispose();
      ringGeo.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      glowTex.dispose();
    },
  };
}

/** Soft round glow, white so the sprite colour tints it. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = Math.max(0, 1 - d) ** 2;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}
