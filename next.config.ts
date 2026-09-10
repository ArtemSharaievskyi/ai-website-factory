import type { NextConfig } from "next";

const nextConfig: NextConfig = { output: "standalone", transpilePackages: ["pg", "typescript"] };

export default nextConfig;
