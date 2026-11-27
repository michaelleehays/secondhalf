import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AREAS } from "@second-half/contracts";
import type { AreaId, CreateScene, GameEvent, Level, ResistanceId, SceneHandle, SceneTarget, WorldView } from "@second-half/contracts";
import { athleteModelUrl, createAthlete, type Athlete } from "./athlete";
import { createRingBurst } from "./burst";
import { CameraRig } from "./camera";
import { RING_OUTER, athleteSpot, cellIndex, heightAt, normalAt, ringAt, sectorAt } from "./layout";
import { AREA_HEX, WORLD_HEX } from "./palette";
import { createResistanceLayer, type AttackTarget } from "./resistance";
import { createTerrain } from "./terrain";
import { Walker } from "./walker";

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
  const fog = new THREE.Fog(WORLD_HEX.sky, 34, 70);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const rig = new CameraRig(camera);

  const hemi = new THREE.HemisphereLight(LIGHT.hemiWarm, 0x1a1612, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHT.sunWarm, 2.6);
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
  const resistance = createResistanceLayer();
  scene.add(resistance.group);
  const burst = createRingBurst(WORLD_HEX.summit);
  scene.add(burst.mesh);

  /* ---------- athlete ---------- */
  const athleteRoot = new THREE.Group();
  athleteRoot.name = "athlete-spot";
  scene.add(athleteRoot);
  const marker = createMarker();
  athleteRoot.add(marker.group);
  const walker = new Walker();
  {
    const [x, y, z] = athleteSpot(1);
    walker.place(x, z);
    athleteRoot.position.set(x, y, z);
  }
  let athlete: Athlete | null = null;

  /** Fixed tap targets. Resistance markers appear with the first view, so pick() adds them per tap. */
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
    const hit = ray.intersectObjects([...pickable, ...resistance.hitProxies], false)[0];
    if (!hit) return null;
    if (athlete && hit.object === athlete.hitProxy) return { kind: "athlete" };
    const resistanceId = hit.object.userData.resistance as ResistanceId | undefined;
    if (resistanceId) return { kind: "resistance", id: resistanceId };
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
  const FLASH_OFFSET = new THREE.Vector3(0, 2, 2);
  function flash(color: number, intensity: number) {
    if (reduceMotion) return;
    flashLight.color.setHex(color);
    flashLight.position.copy(athleteRoot.position).add(FLASH_OFFSET);
    flashLight.intensity = intensity;
  }

  /** Goal id to cell, from the latest view. */
  const goalCells = new Map<string, AttackTarget>();
  const resolveGoal = (goalId: string) => goalCells.get(goalId) ?? null;
  const cellOf = (goalId: string) => {
    const c = goalCells.get(goalId);
    return c ? cellIndex(c.area, c.level) : -1;
  };
  const areaColor = new THREE.Color();
  const CALM = new THREE.Color(EFFECT_HEX.calm);
  const GOLD = new THREE.Color(WORLD_HEX.summit);

  function play(event: GameEvent) {
    switch (event.type) {
      case "setback":
        athlete?.hit(1);
        resistance.strike(event.resistance);
        if (!reduceMotion) rig.shake(1);
        flash(0xff3030, 12);
        break;
      case "knocked_down":
        athlete?.hit(1);
        athlete?.knockDown();
        if (!reduceMotion) rig.shake(0.6);
        flash(0xff3030, 8);
        break;
      case "locked_in": {
        athlete?.celebrate();
        flash(0xffc870, 10);
        const c = goalCells.get(event.goalId);
        if (c) terrain.flashCell(cellIndex(c.area, c.level), areaColor.set(AREA_HEX[c.area]), 1);
        break;
      }
      case "at_risk": {
        const i = cellOf(event.goalId);
        if (i >= 0) terrain.pulseCell(i, 1);
        break;
      }
      case "risk_cleared": {
        const i = cellOf(event.goalId);
        if (i >= 0) terrain.flashCell(i, CALM, 0.5);
        break;
      }
      case "ground_lost": {
        const i = cellOf(event.goalId);
        if (i >= 0) {
          terrain.darkenCell(i, 1);
          if (!reduceMotion) terrain.shakeCell(i, 1);
        }
        if (!reduceMotion) rig.shake(0.3);
        break;
      }
      case "level_up":
        athlete?.celebrate();
        flash(0xffc870, 10);
        if (!reduceMotion) burst.fire(RING_OUTER[Math.min(event.level, 5) - 1]!);
        for (const area of AREAS) if (event.level <= 4) terrain.flashCell(cellIndex(area, event.level as 1 | 2 | 3 | 4), GOLD, 0.6);
        break;
      case "level_lost":
        athlete?.hit(0.4);
        break;
      case "resistance_changed":
        resistance.strike(event.id);
        break;
      case "recovery_started":
        flash(LIGHT.recoveryFlash, 10);
        recoveryGoal = 1;
        break;
      default:
        // Points, grace, rules and the rest show in the app's UI.
        break;
    }
  }

  /* ---------- loop ---------- */
  let raf = 0;
  /** rAF timestamps (ms) of the first and the previous frame; null until the first frame. */
  let startMs: number | null = null;
  let lastMs = 0;
  let first = true;
  /** 0 normal light .. 1 the cooler Recovery light, eased toward recoveryGoal. */
  let recovery = 0;
  let recoveryGoal = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (startMs === null) startMs = lastMs = now;
    // Clamp to [0, 50 ms]: a negative or NaN step would poison every eased value downstream.
    const step = (now - lastMs) / 1000;
    lastMs = now;
    const dt = step > 0 ? Math.min(0.05, step) : 0;
    const t = reduceMotion ? 0 : (now - startMs) / 1000;
    terrain.tick(t, dt);
    resistance.tick(t, dt);
    burst.tick(dt);
    walker.step(dt);
    athleteRoot.position.set(walker.x, heightAt(walker.x, walker.z), walker.z);
    marker.tick(t, athleteRoot.position);
    recovery += (recoveryGoal - recovery) * (1 - Math.pow(0.1, dt));
    hemi.color.lerpColors(LIGHT_COLORS.hemiWarm, LIGHT_COLORS.hemiCool, recovery);
    sun.color.lerpColors(LIGHT_COLORS.sunWarm, LIGHT_COLORS.sunCool, recovery);
    sun.intensity = 2.6 - 0.6 * recovery;
    if (athlete) {
      athlete.setMotion(walker.walk, walker.phase, walker.facing);
      athlete.tick(dt, t);
      // Lying down, the body also tilts onto the slope, like the ring under it.
      athlete.root.quaternion.identity().slerp(marker.group.quaternion, athlete.down);
    }
    flashLight.intensity *= Math.pow(0.03, dt);
    rig.update(dt, level(), (athlete?.down ?? 0) > 0.5, first || reduceMotion);
    // Fog follows the camera's distance, so a pulled-back shot doesn't bury the mountain in haze.
    const camDist = camera.position.length();
    fog.near = camDist + FOG.near;
    fog.far = camDist + FOG.far;
    first = false;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const handle: SceneHandle = {
    update(next) {
      if (disposed) return;
      const firstView = view === null;
      view = next;
      terrain.setCells(next.cells);
      goalCells.clear();
      for (const c of next.cells) if (c.goalId) goalCells.set(c.goalId, { area: c.area, level: c.level });
      resistance.update(next.resistance, resolveGoal);
      const [x, , z] = athleteSpot(next.level);
      if (firstView || reduceMotion) walker.place(x, z);
      else walker.setGoal(x, z);
      recoveryGoal = next.inRecovery ? 1 : 0;
      if (firstView) recovery = recoveryGoal;
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
      terrain.dispose();
      athlete?.dispose();
      marker.dispose();
      resistance.dispose();
      burst.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
  return handle;
};



/** Scene light colours: warm by default, cooler during Recovery. */
const LIGHT = {
  hemiWarm: 0xb8c6d8,
  hemiCool: 0x9cc2ff,
  sunWarm: 0xffc690,
  sunCool: 0xb4d0ff,
  recoveryFlash: 0x8ec5f2,
} as const;
const LIGHT_COLORS = {
  hemiWarm: new THREE.Color(LIGHT.hemiWarm),
  hemiCool: new THREE.Color(LIGHT.hemiCool),
  sunWarm: new THREE.Color(LIGHT.sunWarm),
  sunCool: new THREE.Color(LIGHT.sunCool),
};
/** Fog start and end, measured beyond the camera's distance from the summit axis. */
const FOG = { near: 4, far: 40 } as const;
/** Event colours not tied to an area. */
const EFFECT_HEX = { calm: "#cfefdb" } as const;

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
  const n: [number, number, number] = [0, 0, 0];
  return {
    group,
    /** `at` is the marker's world position; the ring and shadow tilt to lie flat on the slope. */
    tick(t: number, at: THREE.Vector3) {
      ringMat.opacity = 0.5 + 0.35 * Math.sin(t * 3);
      normalAt(at.x, at.z, n);
      normal.set(n[0], n[1], n[2]);
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
