// Copies the athlete models from the repo's assets/ folder into public/assets, where the scene
// loads them from (`${assetsBaseUrl}/models/...`). Runs before dev and build; the copies are git-ignored.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "..", "assets", "models");
const to = join(here, "..", "public", "assets", "models");
const files = ["athlete.glb", "athlete_mobile.glb"];

mkdirSync(to, { recursive: true });
for (const f of files) {
  const src = join(from, f);
  if (!existsSync(src)) {
    console.warn(`copy-assets: ${src} is missing; the scene will show the map without the athlete.`);
    continue;
  }
  copyFileSync(src, join(to, f));
}
console.log(`copy-assets: athlete models copied to public/assets/models`);
