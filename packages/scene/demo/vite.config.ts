import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Demo only, not shipped. Serves the repo's assets/ folder at the site root so the scene
// finds models at /models/athlete.glb.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../../assets", import.meta.url)),
  server: { host: true },
});
