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

export const FOUNDATION_REQUIRED_ARTIFACTS = ["package.json", "package-lock.json"] as const;

export function foundationPolicySummary() {
  return JSON.stringify({ ...FOUNDATION_PACKAGE_POLICY, requiredArtifacts: FOUNDATION_REQUIRED_ARTIFACTS });
}
