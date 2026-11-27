import * as THREE from "three";
import type { CreateScene, GameEvent, Level, SceneHandle, SceneTarget, WorldView } from "@second-half/contracts";
import { CameraRig } from "./camera";
import { ringAt, sectorAt } from "./layout";
import { WORLD_HEX } from "./palette";
import { createTerrain } from "./terrain";

type Selection = SceneTarget & { level?: Level };

/** Pointer travel (px) beyond which a press counts as a drag, not a tap. */
const DRAG_PX = 6;
/** Radians of yaw per pixel dragged. */
const YAW_PER_PX = 0.004;

/**
 * Builds the 3D world inside `container`. The scene holds no game logic: it draws the latest
 * WorldView and animates GameEvents it is given.
 */
export const createScene: CreateScene = async (container, options) => {
  // Reserved for model and texture loading (athlete, Resistance). Not used by the terrain.
  void options.assetsBaseUrl;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = matchMedia("(pointer: coarse)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 2 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WORLD_HEX.sky);
  scene.fog = new THREE.Fog(WORLD_HEX.sky, 34, 70);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const rig = new CameraRig(camera);

  scene.add(new THREE.HemisphereLight(0xb8c6d8, 0x1a1612, 1.6));
  const sun = new THREE.DirectionalLight(0xffc690, 2.6);
  sun.position.set(14, 16, 10);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.2);
  rim.position.set(-12, 10, -14);
  scene.add(rim);

  const terrain = createTerrain({ segments: phone ? 160 : 230 });
  scene.add(terrain.mesh, terrain.extras);
  const pickable: THREE.Object3D[] = [terrain.mesh, terrain.summit];

  let view: WorldView | null = null;
  const level = (): Level => view?.level ?? 1;

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /* ---------- input: drag to turn, tap to select ---------- */
  /** Taps on the plain beyond the mountain report `home`, so the app can return to the full map. */
  const selectCbs: ((t: Selection) => void)[] = [];
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let press: { x: number; y: number; yaw: number; moved: boolean; id: number } | null = null;

  const onDown = (e: PointerEvent) => {
    press = { x: e.clientX, y: e.clientY, yaw: rig.yawTarget, moved: false, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    if (Math.abs(dx) > DRAG_PX || Math.abs(e.clientY - press.y) > DRAG_PX) press.moved = true;
    if (press.moved) rig.setYaw(press.yaw - dx * YAW_PER_PX);
  };
  const onUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.moved || e.target !== canvas) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit) selectCbs.forEach((cb) => cb(hit));
  };
  const onCancel = () => {
    press = null;
  };

  function pick(clientX: number, clientY: number): Selection | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickable, false)[0];
    if (!hit) return null;
    if (hit.object === terrain.summit) return { kind: "vision", level: 5 };
    const ring = ringAt(Math.hypot(hit.point.x, hit.point.z));
    if (ring === 0) return { kind: "home" };
    if (ring === 5) return { kind: "vision", level: 5 };
    return { kind: "area", area: sectorAt(hit.point.x, hit.point.z).area, level: ring };
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);

  /* ---------- loop ---------- */
  const timer = new THREE.Timer();
  let raf = 0;
  let disposed = false;
  let first = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    timer.update(now);
    const dt = Math.min(0.05, timer.getDelta());
    terrain.tick(reduceMotion ? 0 : timer.getElapsed());
    rig.update(dt, level(), first || reduceMotion);
    first = false;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: SceneHandle = {
    update(next) {
      if (disposed) return;
      view = next;
      terrain.setCells(next.cells);
    },
    play(event: GameEvent) {
      if (disposed) return;
      // Event animations (setback hit, locked-in celebration, Resistance attack) arrive with the
      // athlete and Resistance markers in the next pull requests.
      void event;
    },
    focus(target) {
      if (disposed) return;
      rig.focus(target);
    },
    onSelect(cb) {
      selectCbs.push(cb);
      return () => {
        const i = selectCbs.indexOf(cb);
        if (i >= 0) selectCbs.splice(i, 1);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      selectCbs.length = 0;
      timer.dispose();
      terrain.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  return handle;
};
