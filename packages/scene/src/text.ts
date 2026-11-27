import * as THREE from "three";
import { normalAt } from "./layout";

export interface TextLine {
  text: string;
  /** Font size in canvas pixels. */
  size: number;
  color?: string;
  weight?: number;
  /** Extra letter spacing in pixels. */
  tracking?: number;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Inter, sans-serif';

/**
 * Draws lines of text, centred, onto a canvas texture. Returns null where there is no DOM canvas
 * (tests in Node), so callers simply skip the label there.
 */
export function textTexture(lines: TextLine[], width = 512, height = 128): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const total = lines.reduce((h, l) => h + l.size * 1.2, 0);
  let y = (height - total) / 2;
  g.textAlign = "center";
  g.textBaseline = "top";
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ${FONT}`;
    if ("letterSpacing" in g && l.tracking) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.tracking}px`;
    // A soft dark halo keeps light text readable over light rock and snow.
    g.lineWidth = Math.max(2, l.size * 0.12);
    g.strokeStyle = "rgba(10,12,14,0.55)";
    g.strokeText(l.text, width / 2, y + l.size * 0.1);
    g.fillStyle = l.color ?? "#f1efea";
    g.fillText(l.text, width / 2, y + l.size * 0.1);
    y += l.size * 1.2;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const _n = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * A label lying on the ground at (x, z), tilted to the slope, with its text's "up" pointing toward
 * the summit so it reads from outside the mountain looking in, from any side.
 */
export function groundLabel(tex: THREE.Texture, widthM: number, heightM: number, x: number, y: number, z: number, opacity = 0.9): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    fog: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  const [nx, ny, nz] = normalAt(x, z);
  _n.set(nx, ny, nz);
  // Uphill: toward the axis, projected onto the ground plane.
  _up.set(-x, 0, -z);
  if (_up.lengthSq() < 1e-6) _up.set(0, 0, -1);
  _up.addScaledVector(_n, -_up.dot(_n)).normalize();
  _right.crossVectors(_up, _n).normalize();
  _basis.makeBasis(_right, _up, _n);
  mesh.quaternion.setFromRotationMatrix(_basis);
  mesh.position.set(x, y, z).addScaledVector(_n, 0.12);
  mesh.renderOrder = 2;
  return mesh;
}
