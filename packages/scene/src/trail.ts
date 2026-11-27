import * as THREE from "three";
import type { CellView, Level, TrailView } from "@second-half/contracts";
import { cellCenter } from "./layout";
import { WORLD_HEX } from "./palette";
import { textTexture } from "./text";
import { climbedDistance, placeMoments, pointAt, stopDistance, trailPath, type MarkerKind, type TrailPath } from "./trailLayout";

const RIBBON_WIDTH = 0.34;
/** Stop label height as a share of the screen height. */
const STOP_LABEL_H = 0.06;
const DEFAULT_NAMES: Record<Level, string> = { 1: "Foundations", 2: "Momentum", 3: "Mastery", 4: "Legacy", 5: "The Vision" };

/** Solid where climbed, dashed and dimmer above; `s` is distance along the path. */
const RIBBON_VERTEX = `
attribute float s;
varying float vS;
#include <common>
#include <fog_pars_vertex>
void main() {
  vS = s;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const RIBBON_FRAGMENT = `
uniform vec3 uColor;
uniform float uClimbed;
varying float vS;
#include <common>
#include <fog_pars_fragment>
void main() {
  float ahead = step(uClimbed, vS);
  if (ahead > 0.5 && fract(vS / 0.7) > 0.5) discard;
  gl_FragColor = vec4(uColor, mix(0.95, 0.5, ahead));
  #include <fog_fragment>
}
`;

/** Shared marker meshes: flags for claimed ground and lock-ins, red marks for setbacks, and so on. */
function createMarkerKit() {
  const pole = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
  pole.translate(0, 0.5, 0);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, 0, 0, 0.7, 0, 0.42, 0.85, 0], 3));
  pennant.computeVertexNormals();
  const cairn = new THREE.ConeGeometry(0.16, 0.34, 6);
  cairn.translate(0, 0.17, 0);
  const spike = new THREE.ConeGeometry(0.07, 0.36, 5);
  spike.translate(0, 0.18, 0);
  const ring = new THREE.TorusGeometry(0.16, 0.035, 6, 20);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.06, 0);
  const cross = new THREE.BoxGeometry(0.36, 0.05, 0.07);
  cross.translate(0, 0.05, 0);
  const dot = new THREE.SphereGeometry(0.07, 8, 6);
  dot.translate(0, 0.07, 0);

  const flagMat = new THREE.MeshStandardMaterial({ color: WORLD_HEX.flag, roughness: 0.7, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.8 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c887f, roughness: 0.9 });
  const riskMat = new THREE.MeshStandardMaterial({ color: WORLD_HEX.risk, emissive: WORLD_HEX.risk, emissiveIntensity: 0.4, roughness: 0.6 });
  const lostMat = new THREE.MeshStandardMaterial({ color: 0x5a1a1d, roughness: 0.8 });
  const dotMat = new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.8 });

  function flag(scale: number): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pole, poleMat), new THREE.Mesh(pennant, flagMat));
    g.scale.setScalar(scale);
    return g;
  }

  function moment(kind: MarkerKind): THREE.Object3D {
    switch (kind) {
      case "flag":
        return flag(0.55);
      case "setback":
        return new THREE.Mesh(spike, riskMat);
      case "at_risk":
        return new THREE.Mesh(ring, riskMat);
      case "ground_lost":
        return new THREE.Mesh(cross, lostMat);
      default:
        return new THREE.Mesh(dot, dotMat);
    }
  }

  return {
    flag,
    moment,
    cairn: () => new THREE.Mesh(cairn, stoneMat),
    dispose() {
      for (const g of [pole, pennant, cairn, spike, ring, cross, dot]) g.dispose();
      for (const m of [flagMat, poleMat, stoneMat, riskMat, lostMat, dotMat]) m.dispose();
    },
  };
}

/**
 * The trail up the section being worked, its milestone stops and journal moments, and flags on
 * claimed ground elsewhere. Rebuilt on update; nothing here changes per frame.
 */
export function createTrailLayer() {
  const group = new THREE.Group();
  group.name = "trail";
  const kit = createMarkerKit();
  const uClimbed = { value: 0 };
  const ribbonMat = new THREE.ShaderMaterial({
    vertexShader: RIBBON_VERTEX,
    fragmentShader: RIBBON_FRAGMENT,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(WORLD_HEX.flag) } }]),
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  ribbonMat.uniforms.uClimbed = uClimbed;

  /** Rebuilt content: ribbon, stops, moments, stop labels. */
  const content = new THREE.Group();
  /** Flags on claimed cells off the trail. */
  const claimFlags = new THREE.Group();
  group.add(content, claimFlags);
  let ribbon: THREE.Mesh | null = null;
  let path: TrailPath | null = null;
  let climbed = 0;
  let key = "";
  const labelTextures: THREE.Texture[] = [];
  const spriteMats: THREE.SpriteMaterial[] = [];

  function clearContent() {
    if (ribbon) ribbon.geometry.dispose();
    ribbon = null;
    content.clear();
    for (const t of labelTextures) t.dispose();
    for (const m of spriteMats) m.dispose();
    labelTextures.length = 0;
    spriteMats.length = 0;
  }

  function buildRibbon(p: TrailPath): THREE.Mesh {
    const n = p.dist.length;
    const pos = new Float32Array(n * 2 * 3);
    const sAttr = new Float32Array(n * 2);
    const idx: number[] = [];
    const left: [number, number, number] = [0, 0, 0];
    const right: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s = p.dist[i]!;
      pointAt(p, s, -RIBBON_WIDTH / 2, left);
      pointAt(p, s, RIBBON_WIDTH / 2, right);
      pos.set(left, i * 6);
      pos.set(right, i * 6 + 3);
      sAttr[i * 2] = s;
      sAttr[i * 2 + 1] = s;
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("s", new THREE.BufferAttribute(sAttr, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, ribbonMat);
    mesh.name = "trail-ribbon";
    mesh.renderOrder = 3;
    return mesh;
  }

  function stopLabel(level: Exclude<Level, 5>, name: string, title: string, reached: boolean): THREE.Sprite | null {
    const tex = textTexture(
      [
        { text: `${level}01 · ${name.toUpperCase()}`, size: 30, weight: 700, tracking: 3, color: reached ? "#e8c15a" : "#b9b5ab" },
        { text: title, size: 44, weight: 700, color: reached ? "#f1efea" : "#d9d5cc" },
      ],
      768,
      144,
    );
    if (!tex) return null;
    labelTextures.push(tex);
    // Constant size on screen, so stop names stay readable from home and up close.
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: reached ? 1 : 0.8, sizeAttenuation: false });
    spriteMats.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(STOP_LABEL_H * (768 / 144), STOP_LABEL_H, 1);
    sprite.renderOrder = 5;
    return sprite;
  }

  const p3: [number, number, number] = [0, 0, 0];

  return {
    group,
    /** Draw the trail for `trail` (or none), flags on claimed cells, and stop names from `levelNames`. */
    update(trail: TrailView | undefined, cells: readonly CellView[], levelNames: Record<Level, string> | undefined) {
      const names = levelNames ?? DEFAULT_NAMES;
      // Flags on claimed cells outside the trail's section (its own stops carry flags).
      claimFlags.clear();
      for (const c of cells) {
        if (c.status !== "locked_in" || c.area === trail?.area) continue;
        const f = kit.flag(0.9);
        f.position.set(...cellCenter(c.area, c.level));
        f.name = `claim-${c.goalId}`;
        claimFlags.add(f);
      }

      const nextKey = trail ? JSON.stringify([trail, names]) : "";
      if (nextKey === key) return;
      key = nextKey;
      clearContent();
      path = null;
      if (!trail) return;

      path = trailPath(trail.area);
      climbed = climbedDistance(trail, path);
      uClimbed.value = climbed;
      ribbon = buildRibbon(path);
      content.add(ribbon);

      for (const stop of trail.stops) {
        const s = stopDistance(path, stop.level);
        const reached = stop.status === "locked_in";
        const marker = reached ? kit.flag(0.9) : kit.cairn();
        marker.position.set(...pointAt(path, s, 0.75, p3));
        marker.name = `stop-${stop.goalId}`;
        content.add(marker);
        const label = stopLabel(stop.level, names[stop.level], stop.title, reached);
        if (label) {
          label.position.set(p3[0], p3[1] + 1.55, p3[2]);
          content.add(label);
        }
      }
      for (const m of placeMoments(trail, path)) {
        const marker = kit.moment(m.kind);
        marker.position.set(...pointAt(path, m.s, m.side, p3));
        marker.userData = { label: m.label, date: m.date };
        marker.name = `moment-${m.kind}`;
        content.add(marker);
      }
    },
    /** Where the athlete stands: the climbed point on the trail. False when there is no trail. */
    athletePoint(out: [number, number, number]): boolean {
      if (!path) return false;
      pointAt(path, climbed, 0, out);
      return true;
    },
    get area() {
      return path?.area;
    },
    dispose() {
      clearContent();
      claimFlags.clear();
      ribbonMat.dispose();
      kit.dispose();
    },
  };
}
