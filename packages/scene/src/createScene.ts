import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CreateScene, GameEvent, Level, SceneHandle, SceneTarget, WorldView } from "@second-half/contracts";
import { athleteModelUrl, createAthlete, type Athlete } from "./athlete";
import { CameraRig } from "./camera";
import { athleteSpot, normalAt, ringAt, sectorAt } from "./layout";
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
 *
 * `assetsBaseUrl` is where the repo's `assets/` folder is served: the athlete loads from
 * `${assetsBaseUrl}/models/athlete.glb` (or `athlete_mobile.glb` on phones). The returned promise
 * resolves as soon as the terrain is ready; the athlete appears when its model has loaded.
 */
export const createScene: CreateScene = async (container, options) => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = matchMedia("(pointer: coarse)").matches;
  const maxPixelRatio = phone ? 2 : 1.75;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
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
  /** Red flash on a setback, gold on a lock-in. Intensity decays every frame. */
  const flashLight = new THREE.PointLight(0xff3030, 0, 8, 1);
  scene.add(flashLight);

  const terrain = createTerrain({ segments: phone ? 160 : 230 });
  scene.add(terrain.mesh, terrain.extras);

  /* ---------- athlete ---------- */
  const athleteRoot = new THREE.Group();
  athleteRoot.name = "athlete-spot";
  scene.add(athleteRoot);
  const marker = createMarker();
  athleteRoot.add(marker.group);
  const athleteGoal = new THREE.Vector3(...athleteSpot(1));
  athleteRoot.position.copy(athleteGoal);
  let athlete: Athlete | null = null;

  const pickable: THREE.Object3D[] = [terrain.mesh, terrain.summit];

  let view: WorldView | null = null;
  let disposed = false;
  const level = (): Level => view?.level ?? 1;

  new GLTFLoader()
    .loadAsync(athleteModelUrl(options.assetsBaseUrl, phone))
    .then((gltf) => {
      if (disposed) return;
      athlete = createAthlete(gltf.scene);
      athleteRoot.add(athlete.root);
      pickable.unshift(athlete.hitProxy);
      if (view) athlete.setView(view.athlete);
    })
    .catch((err: unknown) => {
      // The map still works without the athlete.
      console.warn("Second Half scene: the athlete model could not load.", err);
    });

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    // Re-applied here so moving the window to a screen with a different density stays sharp.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /* ---------- input: drag to turn, tap to select ---------- */
  const selectCbs: ((t: Selection) => void)[] = [];
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let press: { x: number; y: number; yaw: number; moved: boolean; id: number } | null = null;

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
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
    if (hit) selectCbs.slice().forEach((cb) => cb(hit));
  };
  const onCancel = () => {
    press = null;
  };

  /** Taps on the plain beyond the mountain report `home`, so the app can return to the full map. */
  function pick(clientX: number, clientY: number): Selection | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickable, false)[0];
    if (!hit) return null;
    if (athlete && hit.object === athlete.hitProxy) return { kind: "athlete" };
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

  /* ---------- events ---------- */
  function flash(color: number, intensity: number) {
    if (reduceMotion) return;
    flashLight.color.setHex(color);
    flashLight.position.copy(athleteRoot.position).add(new THREE.Vector3(0, 2, 2));
    flashLight.intensity = intensity;
  }

  function play(event: GameEvent) {
    switch (event.type) {
      case "setback":
        athlete?.hit(1);
        if (!reduceMotion) rig.shake(1);
        flash(0xff3030, 12);
        break;
      case "knocked_down":
        athlete?.hit(1);
        athlete?.knockDown();
        if (!reduceMotion) rig.shake(0.6);
        flash(0xff3030, 8);
        break;
      case "locked_in":
      case "level_up":
        athlete?.celebrate();
        flash(0xffc870, 10);
        break;
      default:
        // Other events show in the app's UI; Resistance attack animations land with the markers.
        break;
    }
  }

  /* ---------- loop ---------- */
  const timer = new THREE.Timer();
  let raf = 0;
  let first = true;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    timer.update(now);
    const dt = Math.min(0.05, timer.getDelta());
    const t = reduceMotion ? 0 : timer.getElapsed();
    terrain.tick(t);
    athleteRoot.position.lerp(athleteGoal, first ? 1 : 1 - Math.pow(0.1, dt));
    marker.tick(t, athleteRoot.position);
    athlete?.tick(dt, t);
    flashLight.intensity *= Math.pow(0.03, dt);
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
      athleteGoal.set(...athleteSpot(next.level));
      athlete?.setView(next.athlete);
    },
    play(event) {
      if (disposed) return;
      play(event);
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
      athlete?.dispose();
      marker.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
  return handle;
};

/** The orange "you" ring and a soft contact shadow under the athlete. */
function createMarker() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const shadowTex = new THREE.CanvasTexture(c);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  return {
    group,
    /** `at` is the marker's world position; the ring and shadow tilt to lie flat on the slope. */
    tick(t: number, at: THREE.Vector3) {
      ringMat.opacity = 0.5 + 0.35 * Math.sin(t * 3);
      normal.set(...normalAt(at.x, at.z));
      group.quaternion.setFromUnitVectors(up, normal);
    },
    dispose() {
      ring.geometry.dispose();
      ringMat.dispose();
      shadow.geometry.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
    },
  };
}
