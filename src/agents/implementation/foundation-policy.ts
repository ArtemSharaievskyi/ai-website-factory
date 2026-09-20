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

export function designSystemStylesheet(daisyUiEnabled = false) {
  return `${daisyUiEnabled ? '@import "tailwindcss";\n@plugin "daisyui";\n\n' : '@import "tailwindcss";\n\n'}:root { --factory-canvas: #ffffff; --factory-text: #111111; }\n`;
}

export function foundationPackageJson(optional: readonly { packageName: string; versionSpec: string; section: "dependencies" | "devDependencies" }[] = []) {
  const dependencies: Record<string, string> = { ...FOUNDATION_PACKAGE_POLICY.dependencies };
  const devDependencies: Record<string, string> = { ...FOUNDATION_PACKAGE_POLICY.devDependencies };
  for (const dependency of optional) (dependency.section === "dependencies" ? dependencies : devDependencies)[dependency.packageName] = dependency.versionSpec;
  return JSON.stringify({ name: "generated-project", version: "0.1.0", private: true, packageManager: "npm", dependencies, devDependencies, scripts: FOUNDATION_PACKAGE_POLICY.scripts }, null, 2) + "\n";
}

export const FOUNDATION_REQUIRED_ARTIFACTS = ["package.json", "package-lock.json", "eslint.config.mjs", "next.config.mjs", "tsconfig.json"] as const;
export const FOUNDATION_ESLINT_CONFIG_PATH = "eslint.config.mjs";
export const FOUNDATION_NEXT_CONFIG_PATH = "next.config.mjs";
export const FOUNDATION_TSCONFIG_PATH = "tsconfig.json";
export const FOUNDATION_NEXT_CONFIG = `const nextConfig = { turbopack: { root: process.cwd() } };

export default nextConfig;
`;
export const FOUNDATION_TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", ".next/types/**/*.ts", "**/*.ts", "**/*.tsx"], exclude: ["node_modules"] }, null, 2) + "\n";
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
