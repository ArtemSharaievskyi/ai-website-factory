export const FOUNDATION_PACKAGE_POLICY = {
  packageManager: "npm",
  dependencies: {
    next: "16.2.12",
    react: "19.2.4",
    "react-dom": "19.2.4",
    "server-only": "^0.0.1",
    zod: "^4.4.3",
  },
  devDependencies: {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    eslint: "^9",
    "eslint-config-next": "16.2.12",
    playwright: "^1.62.1",
    tailwindcss: "^4",
    typescript: "^5",
    vitest: "^3.2.4",
  },
  scripts: {
    lint: "eslint",
    typecheck: "tsc --noEmit",
    test: "vitest run",
    build: "next build",
  },
} as const;

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
