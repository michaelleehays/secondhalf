import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@second-half/contracts", "@second-half/engine"],
  reactStrictMode: true,
};

export default config;
