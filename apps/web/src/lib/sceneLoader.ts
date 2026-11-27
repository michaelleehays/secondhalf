import type { CreateScene } from "@second-half/contracts";
import { createPlaceholderScene } from "./placeholderScene";

/** True when the browser can give us a WebGL context at all. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The real three.js scene from workstream C, loaded on demand so three.js stays out of the first
 * bundle. If WebGL is missing or the scene fails to start, the flat placeholder map takes over:
 * it implements the same SceneHandle, so the rest of the app doesn't notice.
 */
export const createSceneWithFallback: CreateScene = async (container, options) => {
  if (hasWebGL()) {
    try {
      const { createScene } = await import("@second-half/scene");
      return await createScene(container, options);
    } catch (err) {
      console.warn("3D scene unavailable, using the flat map.", err);
      container.replaceChildren();
    }
  }
  return createPlaceholderScene(container, options);
};
