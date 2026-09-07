import { describe, expect, it } from "vitest";
import {
  BASELINE_REQUIRED_PACKAGE_NAMES,
  DEPENDENCY_CATALOG,
  GENERATED_BASELINE_DEPENDENCIES,
  GENERATED_BASELINE_DEV_DEPENDENCIES,
  allowedDependencyNamesForPlan,
  decideDependency,
  parseDependencySpec,
  validateDependencyNames,
  validateDependencyPlan,
  validateDependencyReferences,
  validateGeneratedLockfile,
  validateGeneratedPackageManifest,
} from "./authority";

const baselineManifest = {
  dependencies: GENERATED_BASELINE_DEPENDENCIES,
  devDependencies: GENERATED_BASELINE_DEV_DEPENDENCIES,
};

const baselineLockfile = {
  lockfileVersion: 3,
  packages: {
    "": {
      dependencies: GENERATED_BASELINE_DEPENDENCIES,
      devDependencies: GENERATED_BASELINE_DEV_DEPENDENCIES,
    },
  },
};

describe("dependency authority", () => {
  it("uses the generated foundation as the complete baseline catalog", () => {
    expect(DEPENDENCY_CATALOG).toHaveLength(18);
    expect(BASELINE_REQUIRED_PACKAGE_NAMES).toEqual([
      ...Object.keys(GENERATED_BASELINE_DEPENDENCIES),
      ...Object.keys(GENERATED_BASELINE_DEV_DEPENDENCIES),
    ]);
    expect(allowedDependencyNamesForPlan()).toEqual([...BASELINE_REQUIRED_PACKAGE_NAMES].sort());
  });

  it("approves only the exact catalog specification and section", () => {
    expect(decideDependency({ operation: "ADD", packageName: "next", versionSpec: "16.2.12", dependencySection: "dependencies" }).code).toBe("APPROVED");
    expect(decideDependency({ operation: "ADD", packageName: "next", versionSpec: "latest", dependencySection: "dependencies" }).code).toBe("UNSUPPORTED_PACKAGE_SPEC");
    expect(decideDependency({ operation: "ADD", packageName: "next", versionSpec: "16.2.11", dependencySection: "dependencies" }).code).toBe("VERSION_NOT_APPROVED");
    expect(decideDependency({ operation: "ADD", packageName: "next", versionSpec: "16.2.12", dependencySection: "devDependencies" }).code).toBe("DEPENDENCY_SECTION_NOT_ALLOWED");
  });

  it("rejects unapproved names, malformed names, and non-registry specs", () => {
    expect(decideDependency({ operation: "ADD", packageName: "nxt", versionSpec: "16.2.12", dependencySection: "dependencies" }).code).toBe("PACKAGE_NOT_APPROVED");
    expect(decideDependency({ operation: "ADD", packageName: "Next.js", versionSpec: "16.2.12", dependencySection: "dependencies" }).code).toBe("INVALID_PACKAGE_NAME");
    for (const versionSpec of ["git+https://example.invalid/pkg.git", "https://example.invalid/pkg.tgz", "file:../pkg", "workspace:*", "npm:next@latest"]) {
      expect(decideDependency({ operation: "ADD", packageName: "next", versionSpec, dependencySection: "dependencies" }).code).toBe("UNSUPPORTED_PACKAGE_SPEC");
    }
  });

  it("protects baseline packages from removal and validates direct manifests", () => {
    expect(decideDependency({ operation: "REMOVE", packageName: "zod", dependencySection: "dependencies" }).code).toBe("BASELINE_DEPENDENCY_REQUIRED");
    expect(validateGeneratedPackageManifest(baselineManifest).valid).toBe(true);
    expect(validateGeneratedPackageManifest({ ...baselineManifest, dependencies: { ...baselineManifest.dependencies, next: "latest" } }).valid).toBe(false);
    expect(validateGeneratedPackageManifest({ ...baselineManifest, devDependencies: { ...baselineManifest.devDependencies, typescript: undefined } }).valid).toBe(false);
    expect(validateGeneratedPackageManifest({ ...baselineManifest, dependencies: { ...baselineManifest.dependencies, zod: "^4.4.3" }, devDependencies: { ...baselineManifest.devDependencies, zod: "^4.4.3" } }).decisions.some((decision) => decision.code === "DUPLICATE_DEPENDENCY")).toBe(true);
  });

  it("validates planning intent without granting version authority", () => {
    expect(validateDependencyPlan([{ name: "zod", runtime: "runtime", required: true }]).valid).toBe(true);
    expect(validateDependencyPlan([{ name: "zod", runtime: "dev", required: true }]).valid).toBe(false);
    expect(validateDependencyPlan([{ name: "react-hook-form", runtime: "runtime", required: true }]).valid).toBe(false);
    expect(validateDependencyNames(["zod"]).valid).toBe(true);
  });

  it("authorizes pinned Supabase runtime packages only with current plan intent and an owning task", () => {
    const plannedDependencies = [{ name: "@supabase/supabase-js@2.114.0", runtime: "runtime" as const, required: true }];
    expect(decideDependency({ operation: "ADD", packageName: "@supabase/supabase-js", versionSpec: "2.114.0", dependencySection: "dependencies", context: { plannedDependencies, taskType: "implement-authentication" } }).code).toBe("APPROVED");
    expect(decideDependency({ operation: "ADD", packageName: "@supabase/supabase-js", versionSpec: "2.114.0", dependencySection: "dependencies", context: { plannedDependencies, taskType: "implement-page" } }).code).toBe("CAPABILITY_NOT_ALLOWED");
    expect(decideDependency({ operation: "ADD", packageName: "@supabase/ssr", versionSpec: "0.12.6", dependencySection: "dependencies", context: { taskType: "implement-authentication" } }).code).toBe("NOT_IN_PROJECT_PLAN");
    expect(validateDependencyPlan([{ name: "@supabase/supabase-js", runtime: "runtime", required: true }]).decisions[0].code).toBe("VERSION_NOT_APPROVED");
    expect(validateDependencyPlan([{ name: "@supabase/supabase-js@2.114.0", runtime: "runtime", required: true }]).valid).toBe(true);
  });

  it("parses scoped and unscoped package specs without discarding versions", () => {
    expect(parseDependencySpec("next@16.2.12")).toEqual({ packageName: "next", versionSpec: "16.2.12" });
    expect(parseDependencySpec("@scope/package@1.2.3")).toEqual({ packageName: "@scope/package", versionSpec: "1.2.3" });
    expect(parseDependencySpec("zod")).toEqual({ packageName: "zod" });
    expect(validateDependencyPlan([{ name: "next@16.2.12", runtime: "runtime", required: true }]).decisions[0]).toMatchObject({ code: "APPROVED", packageName: "next", requestedSpec: "16.2.12", allowedSpec: "16.2.12" });
    expect(validateDependencyPlan([{ name: "next@16.2.11", runtime: "runtime", required: true }]).decisions[0].code).toBe("VERSION_NOT_APPROVED");
    expect(validateDependencyPlan([{ name: "@scope/package@1.2.3", runtime: "runtime", required: true }]).decisions[0].code).toBe("PACKAGE_NOT_APPROVED");
  });

  it("requires architecture references to match the project dependency plan", () => {
    const plan = [{ name: "zod@^4.4.3", runtime: "runtime" as const, required: true }];
    expect(validateDependencyReferences(["zod@^4.4.3"], plan).valid).toBe(true);
    expect(validateDependencyReferences(["zod@^4.4.2"], plan).decisions[0].code).toBe("VERSION_NOT_APPROVED");
    expect(validateDependencyReferences(["next@16.2.12"], plan).decisions[0].code).toBe("NOT_IN_PROJECT_PLAN");
    expect(validateDependencyReferences(["unknown-package@1.0.0"], plan).decisions[0].code).toBe("PACKAGE_NOT_APPROVED");
    const supabasePlan = [{ name: "@supabase/supabase-js@2.114.0", runtime: "runtime" as const, required: true }];
    expect(validateDependencyReferences(["@supabase/supabase-js"], supabasePlan).decisions[0].code).toBe("VERSION_NOT_APPROVED");
    expect(validateDependencyReferences(["@supabase/supabase-js@2.114.0"], supabasePlan).valid).toBe(true);
  });

  it("matches only npm root direct declarations while ignoring transitive packages", () => {
    expect(validateGeneratedLockfile(baselineLockfile, baselineManifest).valid).toBe(true);
    expect(validateGeneratedLockfile({ ...baselineLockfile, packages: { ...baselineLockfile.packages, "node_modules/transitive": { version: "1.0.0" } } }, baselineManifest).valid).toBe(true);
    expect(validateGeneratedLockfile({ ...baselineLockfile, lockfileVersion: 2 }, baselineManifest).valid).toBe(false);
    expect(validateGeneratedLockfile({ ...baselineLockfile, packages: { "": { dependencies: { ...GENERATED_BASELINE_DEPENDENCIES, next: "16.2.11" }, devDependencies: GENERATED_BASELINE_DEV_DEPENDENCIES } } }, baselineManifest).valid).toBe(false);
  });
});
