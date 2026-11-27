import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@second-half/api", "@second-half/contracts", "@second-half/engine", "@second-half/scene"],
  reactStrictMode: true,
};

export default config;
