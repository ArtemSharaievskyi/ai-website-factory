import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [".factory/tools/**"],
  },
  transpilePackages: ["pg", "typescript"],
  generateBuildId: async () => process.env.FACTORY_BUILD_ID ?? null,
  turbopack: { root: process.cwd() },
};

export default nextConfig;
