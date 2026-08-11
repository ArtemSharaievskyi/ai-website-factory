import {
  GENERATED_BASELINE_DEPENDENCIES,
  GENERATED_BASELINE_DEV_DEPENDENCIES,
} from "@/dependencies/authority";

export const FOUNDATION_PACKAGE_POLICY = {
  packageManager: "npm",
  dependencies: GENERATED_BASELINE_DEPENDENCIES,
  devDependencies: GENERATED_BASELINE_DEV_DEPENDENCIES,
  scripts: {
    "start:test": "next start",
    lint: "eslint",
    typecheck: "tsc --noEmit",
    test: "vitest run",
    build: "next build",
  },
} as const;

export const FOUNDATION_PACKAGE_JSON = JSON.stringify({
  name: "generated-project",
  version: "0.1.0",
  private: true,
  packageManager: "npm",
  dependencies: FOUNDATION_PACKAGE_POLICY.dependencies,
  devDependencies: FOUNDATION_PACKAGE_POLICY.devDependencies,
  scripts: FOUNDATION_PACKAGE_POLICY.scripts,
}, null, 2) + "\n";

export const FOUNDATION_REQUIRED_ARTIFACTS = ["package.json", "package-lock.json", "eslint.config.mjs", "next.config.mjs"] as const;
export const FOUNDATION_ESLINT_CONFIG_PATH = "eslint.config.mjs";
export const FOUNDATION_NEXT_CONFIG_PATH = "next.config.mjs";
export const FOUNDATION_NEXT_CONFIG = `const nextConfig = { turbopack: { root: process.cwd() } };

export default nextConfig;
`;
export const FOUNDATION_ESLINT_CONFIG = `import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "node_modules/**"]),
]);
`;

export function foundationPolicySummary() {
  return JSON.stringify({ ...FOUNDATION_PACKAGE_POLICY, requiredArtifacts: FOUNDATION_REQUIRED_ARTIFACTS });
}
