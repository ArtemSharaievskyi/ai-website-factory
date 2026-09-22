import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    "/*": ["node_modules/sharp/**/*", "node_modules/@img/sharp-*/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": [".factory/tools/**"],
  },
  transpilePackages: ["pg", "typescript"],
  generateBuildId: async () => process.env.FACTORY_BUILD_ID ?? null,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
