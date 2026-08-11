import { describe, expect, it } from "vitest";
import {
  BASELINE_REQUIRED_PACKAGE_NAMES,
  DEPENDENCY_CATALOG,
  GENERATED_BASELINE_DEPENDENCIES,
  GENERATED_BASELINE_DEV_DEPENDENCIES,
  allowedDependencyNamesForPlan,
  decideDependency,
  validateDependencyNames,
  validateDependencyPlan,
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
    expect(DEPENDENCY_CATALOG).toHaveLength(15);
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

  it("matches only npm root direct declarations while ignoring transitive packages", () => {
    expect(validateGeneratedLockfile(baselineLockfile, baselineManifest).valid).toBe(true);
    expect(validateGeneratedLockfile({ ...baselineLockfile, packages: { ...baselineLockfile.packages, "node_modules/transitive": { version: "1.0.0" } } }, baselineManifest).valid).toBe(true);
    expect(validateGeneratedLockfile({ ...baselineLockfile, lockfileVersion: 2 }, baselineManifest).valid).toBe(false);
    expect(validateGeneratedLockfile({ ...baselineLockfile, packages: { "": { dependencies: { ...GENERATED_BASELINE_DEPENDENCIES, next: "16.2.11" }, devDependencies: GENERATED_BASELINE_DEV_DEPENDENCIES } } }, baselineManifest).valid).toBe(false);
  });
});
