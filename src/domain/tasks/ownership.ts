export type TaskOwnershipRule = { scopes: readonly string[]; ownedCategories: readonly string[]; forbiddenScopes: readonly string[]; artifactKind?: string; minimumArtifactCount?: number };
export const UNIT_TEST_ARTIFACT_POLICY_VERSION = "unit-test-artifacts-v1";

export const TASK_OWNERSHIP_RULES: Readonly<Record<string, TaskOwnershipRule>> = Object.freeze({
  "implement-project-foundation": { scopes: ["package.json", "package-lock.json", "next.config.*", "tsconfig.json", "eslint.config.*", "src/app/layout.*", "src/app/globals.css"], ownedCategories: ["npm manifest", "Next.js/TypeScript foundation", "flat ESLint configuration", "minimal root app baseline"], forbiddenScopes: ["src/components/navigation/**", "src/app/**/page.*"], artifactKind: "PROJECT_FOUNDATION", minimumArtifactCount: 3 },
  "implement-design-system": { scopes: ["src/components/ui/**", "src/styles/**", "src/app/globals.css"], ownedCategories: ["global tokens", "typography", "shared primitive styling"], forbiddenScopes: ["src/app/layout.*", "src/components/layout/**", "src/components/navigation/**", "src/app/**/page.*"] },
  "implement-shared-layout": { scopes: ["src/app/layout.*", "src/components/layout/**"], ownedCategories: ["root composition", "shared shell", "header/footer composition"], forbiddenScopes: ["src/app/globals.css", "src/components/navigation/**", "src/app/**/page.*", "package.json", "package-lock.json"] },
  "implement-navigation": { scopes: ["src/components/navigation/**", "src/app/**/layout.*"], ownedCategories: ["navigation behavior", "mobile navigation"], forbiddenScopes: ["src/app/globals.css", "src/app/**/page.*", "package.json", "package-lock.json"] },
  "implement-page": { scopes: ["src/app/**/page.*"], ownedCategories: ["route-specific page content"], forbiddenScopes: ["src/app/layout.*", "src/app/globals.css", "src/components/navigation/**", "package.json", "package-lock.json"] },
  "implement-shared-component": { scopes: ["src/components/**"], ownedCategories: ["approved reusable components"], forbiddenScopes: ["src/app/globals.css", "src/app/layout.*", "src/app/**/page.*", "package.json", "package-lock.json"] },
  "write-unit-tests": { scopes: ["src/*.test.ts", "src/*.test.tsx"], ownedCategories: ["application unit tests"], forbiddenScopes: ["src/app/**", "src/components/**", "package.json", "package-lock.json"], artifactKind: "UNIT_TEST", minimumArtifactCount: 1 },
});

export function ownershipForTask(taskType: string): TaskOwnershipRule | undefined { return TASK_OWNERSHIP_RULES[taskType]; }
