import * as THREE from "three";
import { heightAt } from "./layout";

const SEGMENTS = 160;
const BAND_HEIGHT = 0.5;

/** A gold band that rises from a level ring and fades (level_up). One instance, reused. */
export function createRingBurst(color: THREE.ColorRepresentation) {
  const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const fade = new Float32Array((SEGMENTS + 1) * 2);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (let i = 0; i <= SEGMENTS; i++) {
    fade[i * 2] = 1;
    fade[i * 2 + 1] = 0;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("fade", new THREE.BufferAttribute(fade, 1));
  geo.setIndex(index);
  const uOpacity = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity },
    vertexShader: `attribute float fade; varying float vFade;
      void main() { vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vFade;
      void main() { gl_FragColor = vec4(uColor, uOpacity * vFade); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "ring-burst";
  mesh.visible = false;
  mesh.frustumCulled = false;
  let t = 1;

  return {
    mesh,
    /** Start a burst on the ring of the given radius. */
    fire(radius: number) {
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const x = Math.sin(a) * radius;
        const z = Math.cos(a) * radius;
        const y = heightAt(x, z) + 0.05;
        positions.set([x, y, z, x, y + BAND_HEIGHT, z], i * 6);
      }
      posAttr.needsUpdate = true;
      t = 0;
      mesh.visible = true;
    },
    tick(dt: number) {
      if (t >= 1) return;
      t = Math.min(1, t + dt / 1.6);
      uOpacity.value = 0.8 * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t);
      mesh.position.y = t * 1.2;
      mesh.visible = t < 1;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
