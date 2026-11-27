/**
 * Where the repo's assets/ folder is served from (the scene loads `${ASSETS_BASE_URL}/models/...`).
 * Set NEXT_PUBLIC_ASSETS_BASE_URL to host the app under a subpath or serve models from a CDN,
 * e.g. "/second-half/assets". Read at build time, like every NEXT_PUBLIC_ variable.
 */
export const ASSETS_BASE_URL = assetsBaseUrl(process.env.NEXT_PUBLIC_ASSETS_BASE_URL);

export function assetsBaseUrl(value: string | undefined): string {
  const v = value?.trim();
  return v ? v.replace(/\/+$/, "") : "/assets";
}
