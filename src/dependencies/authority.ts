import { z } from "zod";

export const DEPENDENCY_AUTHORITY_POLICY_VERSION = "generated-dependency-authority-v1";

export const DependencySectionSchema = z.enum(["dependencies", "devDependencies"]);
export type DependencySection = z.infer<typeof DependencySectionSchema>;
export const DependencyOperationSchema = z.enum(["ADD", "REMOVE", "CHANGE_VERSION"]);
export type DependencyOperation = z.infer<typeof DependencyOperationSchema>;
export const DependencyClassSchema = z.enum(["RUNTIME", "DEV", "BASELINE_REQUIRED", "OPTIONAL_CAPABILITY"]);
export type DependencyClass = z.infer<typeof DependencyClassSchema>;
export const DependencyDecisionCodeSchema = z.enum([
  "APPROVED",
  "PACKAGE_NOT_APPROVED",
  "VERSION_NOT_APPROVED",
  "DEPENDENCY_SECTION_NOT_ALLOWED",
  "CAPABILITY_NOT_ALLOWED",
  "NOT_IN_PROJECT_PLAN",
  "BASELINE_DEPENDENCY_REQUIRED",
  "INVALID_PACKAGE_NAME",
  "UNSUPPORTED_PACKAGE_SPEC",
  "PACKAGE_MANAGER_NOT_ALLOWED",
  "DUPLICATE_DEPENDENCY",
  "LOCKFILE_INVALID",
]);
export type DependencyDecisionCode = z.infer<typeof DependencyDecisionCodeSchema>;

export const NpmPackageNameSchema = z.string().regex(
  /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
  "Invalid npm package name",
);

export const DependencyCatalogEntrySchema = z.object({
  packageName: NpmPackageNameSchema,
  allowedVersionSpec: z.string().min(1),
  dependencyClass: DependencyClassSchema,
  baselineRequired: z.boolean(),
  allowedDependencySection: DependencySectionSchema,
  allowedCapabilities: z.array(z.string().min(1)),
  reason: z.string().min(1),
}).strict();
export type DependencyCatalogEntry = z.infer<typeof DependencyCatalogEntrySchema>;

export const GENERATED_BASELINE_DEPENDENCIES = {
  next: "16.2.12",
  react: "19.2.4",
  "react-dom": "19.2.4",
  "server-only": "^0.0.1",
  zod: "^4.4.3",
} as const;

export const GENERATED_BASELINE_DEV_DEPENDENCIES = {
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
} as const;

export const APPROVED_OPTIONAL_DESIGN_DEPENDENCIES = {
  motion: "12.43.0",
} as const;

export const APPROVED_OPTIONAL_SUPABASE_DEPENDENCIES = {
  "@supabase/supabase-js": "2.114.0",
  "@supabase/ssr": "0.12.6",
} as const;

const baselineEntries: DependencyCatalogEntry[] = [
  ...Object.entries(GENERATED_BASELINE_DEPENDENCIES).map(([packageName, allowedVersionSpec]) => ({ packageName, allowedVersionSpec, dependencyClass: "BASELINE_REQUIRED" as const, baselineRequired: true, allowedDependencySection: "dependencies" as const, allowedCapabilities: ["baseline"], reason: "Required by the current generated-project runtime foundation." })),
  ...Object.entries(GENERATED_BASELINE_DEV_DEPENDENCIES).map(([packageName, allowedVersionSpec]) => ({ packageName, allowedVersionSpec, dependencyClass: "BASELINE_REQUIRED" as const, baselineRequired: true, allowedDependencySection: "devDependencies" as const, allowedCapabilities: ["baseline"], reason: "Required by the current generated-project development and validation foundation." })),
  ...Object.entries(APPROVED_OPTIONAL_DESIGN_DEPENDENCIES).map(([packageName, allowedVersionSpec]) => ({ packageName, allowedVersionSpec, dependencyClass: "OPTIONAL_CAPABILITY" as const, baselineRequired: false, allowedDependencySection: "dependencies" as const, allowedCapabilities: ["design.motion"], reason: "Optional Motion for React runtime selected only by an approved professional design contract." })),
  ...Object.entries(APPROVED_OPTIONAL_SUPABASE_DEPENDENCIES).map(([packageName, allowedVersionSpec]) => ({ packageName, allowedVersionSpec, dependencyClass: "OPTIONAL_CAPABILITY" as const, baselineRequired: false, allowedDependencySection: "dependencies" as const, allowedCapabilities: ["implement-project-foundation", "implement-authentication", "implement-server-action", "implement-route-handler", "implement-storage"], reason: "Optional Supabase runtime selected only by an approved database, authentication, or storage contract." })),
];

/**
 * This is deliberately limited to direct package specifications proved by the
 * current generated-project foundation. Documentation-only package names from
 * Context7 or architecture prose are not silently promoted here. Optional
 * entries require a later Factory-owned version decision before they can be
 * direct dependencies.
 */
export const DEPENDENCY_CATALOG = Object.freeze(
  baselineEntries.map((entry) => DependencyCatalogEntrySchema.parse(entry)),
);
export const BASELINE_REQUIRED_PACKAGE_NAMES = Object.freeze(
  DEPENDENCY_CATALOG.filter((entry) => entry.baselineRequired).map((entry) => entry.packageName),
);

export type DependencyPlanIntent = {
  name: string;
  runtime: "runtime" | "dev";
  required: boolean;
};

export type DependencyAuthorityContext = {
  projectId?: string;
  projectVersion?: number;
  planningChecksum?: string;
  plannedDependencies?: readonly DependencyPlanIntent[];
  taskType?: string;
};

export type DependencyRequest = {
  operation: DependencyOperation;
  packageName: string;
  versionSpec?: string;
  dependencySection: DependencySection;
  context?: DependencyAuthorityContext;
};

export type DependencyDecision = {
  approved: boolean;
  code: DependencyDecisionCode;
  packageName: string;
  requestedSpec?: string;
  allowedSpec?: string;
  dependencySection?: DependencySection;
  reason: string;
};

export type GeneratedPackageManifest = {
  packageManager?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  scripts?: unknown;
};

export type ManifestValidationResult = {
  valid: boolean;
  decisions: DependencyDecision[];
};

export class DependencyAuthorityError extends Error {
  constructor(public readonly code: DependencyDecisionCode, message: string) {
    super(message);
    this.name = "DependencyAuthorityError";
  }
}

const catalogByName = new Map(DEPENDENCY_CATALOG.map((entry) => [entry.packageName, entry]));
const forbiddenSpec = /^(?:latest|next|beta|canary)$/i;
const unsupportedSpec = /^(?:git:|git\+|github:|https?:|file:|link:|workspace:|npm:)|[;&|`$]|\s/;

export function getDependencyCatalogEntry(packageName: string) {
  return catalogByName.get(packageName);
}

export function isValidNpmPackageName(packageName: string) {
  return NpmPackageNameSchema.safeParse(packageName).success;
}

export function isSupportedDirectVersionSpec(versionSpec: string) {
  const value = versionSpec.trim();
  return value.length > 0 && !forbiddenSpec.test(value) && !unsupportedSpec.test(value);
}

export type ParsedDependencySpec = {
  packageName: string;
  versionSpec?: string;
};

/**
 * Dependency plans use one string for a direct package reference. Keep the
 * package identity and requested version separate at the authority boundary;
 * scoped npm names have an `@` before the package name as well as before the
 * version.
 */
export function parseDependencySpec(value: string): ParsedDependencySpec {
  const trimmed = value.trim();
  const separator = trimmed.startsWith("@")
    ? (() => {
        const slash = trimmed.indexOf("/");
        return slash > 1 ? trimmed.indexOf("@", slash + 1) : -1;
      })()
    : trimmed.indexOf("@");
  if (separator < 0) return { packageName: trimmed };
  return {
    packageName: trimmed.slice(0, separator),
    versionSpec: trimmed.slice(separator + 1),
  };
}

function plannedDependency(context: DependencyAuthorityContext | undefined, packageName: string) {
  return context?.plannedDependencies?.find((dependency) => parseDependencySpec(dependency.name).packageName === packageName);
}

function decision(
  request: DependencyRequest,
  code: DependencyDecisionCode,
  reason: string,
  entry?: DependencyCatalogEntry,
): DependencyDecision {
  return {
    approved: code === "APPROVED",
    code,
    packageName: request.packageName,
    ...(request.versionSpec === undefined ? {} : { requestedSpec: request.versionSpec }),
    ...(entry ? { allowedSpec: entry.allowedVersionSpec } : {}),
    dependencySection: request.dependencySection,
    reason,
  };
}

export function decideDependency(request: DependencyRequest): DependencyDecision {
  if (!isValidNpmPackageName(request.packageName))
    return decision(request, "INVALID_PACKAGE_NAME", "The package name is not one exact valid npm package name.");
  if (request.versionSpec !== undefined && !isSupportedDirectVersionSpec(request.versionSpec))
    return decision(request, "UNSUPPORTED_PACKAGE_SPEC", "The direct package specification is empty, floating, shell-like, or uses an unapproved URL/git/file/link/workspace/alias source.");
  const entry = getDependencyCatalogEntry(request.packageName);
  if (!entry)
    return decision(request, "PACKAGE_NOT_APPROVED", "The package is not in the Factory-owned generated-project direct dependency catalog.");
  if (entry.allowedDependencySection !== request.dependencySection)
    return decision(request, "DEPENDENCY_SECTION_NOT_ALLOWED", "The package is authorized only in its catalog-owned dependency section.", entry);
  if (request.operation === "REMOVE" && entry.baselineRequired)
    return decision(request, "BASELINE_DEPENDENCY_REQUIRED", "A baseline-required package cannot be removed from a generated project.", entry);
  if (request.versionSpec !== undefined && request.versionSpec !== entry.allowedVersionSpec)
    return decision(request, "VERSION_NOT_APPROVED", "The requested direct version specification does not exactly match the catalog authority.", entry);
  if (!entry.baselineRequired) {
    const planned = plannedDependency(request.context, request.packageName);
    if (!planned) return decision(request, "NOT_IN_PROJECT_PLAN", "Optional direct dependencies require current project DependencyPlan intent.", entry);
    const plannedSpec = parseDependencySpec(planned.name).versionSpec;
    if (plannedSpec !== entry.allowedVersionSpec || request.versionSpec !== entry.allowedVersionSpec)
      return decision(request, "VERSION_NOT_APPROVED", "Optional direct dependencies must be pinned to the exact host-approved project and catalog version.", entry);
    if (request.context?.taskType && !entry.allowedCapabilities.includes(request.context.taskType))
      return decision(request, "CAPABILITY_NOT_ALLOWED", "The current implementation capability is not authorized for this optional dependency.", entry);
  }
  return decision(request, "APPROVED", "The direct dependency matches the host catalog, section, version, project intent, and task capability.", entry);
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new DependencyAuthorityError("UNSUPPORTED_PACKAGE_SPEC", `${field} must be an object of exact package names to specs.`);
  return value as Record<string, unknown>;
}

export function validateGeneratedPackageManifest(
  manifest: GeneratedPackageManifest,
  context: DependencyAuthorityContext = {},
): ManifestValidationResult {
  const decisions: DependencyDecision[] = [];
  if (manifest.packageManager !== undefined && (typeof manifest.packageManager !== "string" || !/^npm(?:@|$)/i.test(manifest.packageManager)))
    decisions.push({ approved: false, code: "PACKAGE_MANAGER_NOT_ALLOWED", packageName: "package-manager", reason: "Generated projects use npm only." });
  const sections: Array<[DependencySection, Record<string, unknown>]> = [
    ["dependencies", objectRecord(manifest.dependencies ?? {}, "dependencies")],
    ["devDependencies", objectRecord(manifest.devDependencies ?? {}, "devDependencies")],
  ];
  const seen = new Set<string>();
  for (const [dependencySection, values] of sections) {
    for (const [packageName, rawSpec] of Object.entries(values)) {
      if (seen.has(packageName)) {
        decisions.push({ approved: false, code: "DUPLICATE_DEPENDENCY", packageName, dependencySection, reason: "A direct package cannot be declared in both dependency sections." });
        continue;
      }
      seen.add(packageName);
      decisions.push(decideDependency({ operation: "ADD", packageName, versionSpec: typeof rawSpec === "string" ? rawSpec : String(rawSpec), dependencySection, context }));
    }
  }
  const declared = new Set(seen);
  for (const entry of DEPENDENCY_CATALOG) {
    if (entry.baselineRequired && !declared.has(entry.packageName))
      decisions.push({ approved: false, code: "BASELINE_DEPENDENCY_REQUIRED", packageName: entry.packageName, dependencySection: entry.allowedDependencySection, allowedSpec: entry.allowedVersionSpec, reason: "The generated-project foundation requires this direct package." });
  }
  return { valid: decisions.every((item) => item.approved), decisions };
}

export function assertGeneratedPackageManifest(
  manifest: GeneratedPackageManifest,
  context: DependencyAuthorityContext = {},
) {
  const result = validateGeneratedPackageManifest(manifest, context);
  const failure = result.decisions.find((item) => !item.approved);
  if (failure) throw new DependencyAuthorityError(failure.code, `${failure.code}: ${failure.reason}`);
  return result;
}

export function validateDependencyPlan(
  dependencies: readonly DependencyPlanIntent[],
  context: DependencyAuthorityContext = {},
) {
  const decisions: DependencyDecision[] = [];
  const seen = new Set<string>();
  const plannedDependencies = context.plannedDependencies ?? dependencies;
  for (const dependency of dependencies) {
    const section: DependencySection = dependency.runtime === "runtime" ? "dependencies" : "devDependencies";
    const parsed = parseDependencySpec(dependency.name);
    if (seen.has(parsed.packageName)) {
      decisions.push({ approved: false, code: "DUPLICATE_DEPENDENCY", packageName: parsed.packageName, dependencySection: section, reason: "DependencyPlan cannot declare a package more than once." });
      continue;
    }
    seen.add(parsed.packageName);
    decisions.push(decideDependency({
      operation: "ADD",
       packageName: parsed.packageName,
       ...(parsed.versionSpec === undefined ? {} : { versionSpec: parsed.versionSpec }),
      dependencySection: section,
      context: {
        ...context,
        plannedDependencies,
      },
    }));
  }
  return { valid: decisions.every((item) => item.approved), decisions };
}

export function validateDependencyReferences(
  references: readonly string[],
  dependencies: readonly DependencyPlanIntent[],
  context: DependencyAuthorityContext = {},
) {
  const planValidation = validateDependencyPlan(dependencies, context);
  const planByName = new Map(
    dependencies.map((dependency) => [
      parseDependencySpec(dependency.name).packageName,
      dependency,
    ]),
  );
  const decisions: DependencyDecision[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const parsed = parseDependencySpec(reference);
    const planned = planByName.get(parsed.packageName);
    const planDecision = planValidation.decisions.find(
      (item) => item.packageName === parsed.packageName,
    );
    const section: DependencySection = planned?.runtime === "dev"
      ? "devDependencies"
      : "dependencies";
    if (seen.has(parsed.packageName)) {
      decisions.push({
        approved: false,
        code: "DUPLICATE_DEPENDENCY",
        packageName: parsed.packageName,
        dependencySection: section,
        reason: "Architecture dependency references cannot repeat a package.",
      });
      continue;
    }
    seen.add(parsed.packageName);
    if (!planned) {
      const authority = decideDependency({
        operation: "ADD",
        packageName: parsed.packageName,
        ...(parsed.versionSpec === undefined ? {} : { versionSpec: parsed.versionSpec }),
        dependencySection: section,
        context: {
          ...context,
          plannedDependencies: context.plannedDependencies?.map((dependency) => ({
            ...dependency,
            name: parseDependencySpec(dependency.name).packageName,
          })) ?? dependencies.map((dependency) => ({
            ...dependency,
            name: parseDependencySpec(dependency.name).packageName,
          })),
        },
      });
      decisions.push(authority.approved
        ? {
            ...authority,
            approved: false,
            code: "NOT_IN_PROJECT_PLAN",
            reason: "Architecture dependency references must point to the current project DependencyPlan.",
          }
        : authority);
      continue;
    }
    if (!planDecision || !planDecision.approved) {
      decisions.push(planDecision ?? {
        approved: false,
        code: "NOT_IN_PROJECT_PLAN",
        packageName: parsed.packageName,
        dependencySection: section,
        reason: "Architecture dependency references must point to an approved project DependencyPlan entry.",
      });
      continue;
    }
    const catalogEntry = getDependencyCatalogEntry(parsed.packageName);
    const expectedSpec = planDecision.allowedSpec ?? catalogEntry?.allowedVersionSpec;
    const effectiveRequestedSpec = parsed.versionSpec ?? expectedSpec;
    if (!expectedSpec || (!catalogEntry?.baselineRequired && parsed.versionSpec === undefined) || effectiveRequestedSpec !== expectedSpec) {
      decisions.push({
        approved: false,
        code: "VERSION_NOT_APPROVED",
        packageName: parsed.packageName,
        ...(parsed.versionSpec === undefined ? {} : { requestedSpec: parsed.versionSpec }),
        ...(expectedSpec ? { allowedSpec: expectedSpec } : {}),
        dependencySection: section,
        reason: "Architecture dependency reference must use the exact DependencyPlan/catalog version specification.",
      });
      continue;
    }
    decisions.push({
      approved: true,
      code: "APPROVED",
      packageName: parsed.packageName,
      ...(parsed.versionSpec === undefined ? {} : { requestedSpec: parsed.versionSpec }),
      allowedSpec: expectedSpec,
      dependencySection: section,
      reason: "Architecture dependency reference matches the approved DependencyPlan and host catalog.",
    });
  }
  return { valid: decisions.every((item) => item.approved), decisions };
}

export function validateDependencyNames(
  names: readonly string[],
  context: DependencyAuthorityContext = {},
) {
  return validateDependencyPlan(
    names.map((name) => ({ name, runtime: "runtime" as const, required: false })),
    context,
  );
}

export function allowedDependencyNamesForPlan(
  dependencies: readonly DependencyPlanIntent[] = [],
  taskType?: string,
) {
  const names = new Set(BASELINE_REQUIRED_PACKAGE_NAMES);
  for (const dependency of dependencies) {
    const entry = getDependencyCatalogEntry(parseDependencySpec(dependency.name).packageName);
    if (entry && (!taskType || entry.allowedCapabilities.includes(taskType))) names.add(entry.packageName);
  }
  return [...names].sort();
}

export function dependencyCatalogPromptContext() {
  return DEPENDENCY_CATALOG.map((entry) => `${entry.packageName}=${entry.allowedVersionSpec} (${entry.allowedDependencySection}; ${entry.dependencyClass}; baseline=${entry.baselineRequired})`).join("; ");
}

export function validateGeneratedLockfile(lockfile: unknown, manifest: GeneratedPackageManifest) {
  if (typeof lockfile !== "object" || lockfile === null || Array.isArray(lockfile))
    return { valid: false, code: "LOCKFILE_INVALID" as const, reason: "package-lock.json must be a JSON object." };
  const value = lockfile as { lockfileVersion?: unknown; packages?: unknown };
  if (value.lockfileVersion !== 3)
    return { valid: false, code: "LOCKFILE_INVALID" as const, reason: "Generated projects require npm lockfileVersion 3." };
  const packages = value.packages;
  if (typeof packages !== "object" || packages === null || Array.isArray(packages))
    return { valid: false, code: "LOCKFILE_INVALID" as const, reason: "package-lock.json packages root is missing." };
  const root = (packages as Record<string, unknown>)[""];
  if (typeof root !== "object" || root === null || Array.isArray(root))
    return { valid: false, code: "LOCKFILE_INVALID" as const, reason: "package-lock.json root package metadata is missing." };
  const rootPackage = root as { dependencies?: unknown; devDependencies?: unknown };
  const direct = (field: "dependencies" | "devDependencies") => {
    const manifestValues = objectRecord(manifest[field] ?? {}, field);
    const lockValues = rootPackage[field] === undefined ? {} : objectRecord(rootPackage[field], `lockfile ${field}`);
    const manifestNames = Object.keys(manifestValues).sort();
    const lockNames = Object.keys(lockValues).sort();
    if (JSON.stringify(manifestNames) !== JSON.stringify(lockNames)) return false;
    return manifestNames.every((name) => lockValues[name] === manifestValues[name]);
  };
  return direct("dependencies") && direct("devDependencies")
    ? { valid: true as const, code: "APPROVED" as const, reason: "The npm lockfile root direct declarations match package.json; transitive packages remain npm-resolved." }
    : { valid: false as const, code: "LOCKFILE_INVALID" as const, reason: "The npm lockfile root direct declarations do not match package.json." };
}

export function assertGeneratedLockfile(lockfile: unknown, manifest: GeneratedPackageManifest) {
  const result = validateGeneratedLockfile(lockfile, manifest);
  if (!result.valid) throw new DependencyAuthorityError(result.code, `${result.code}: ${result.reason}`);
  return result;
}
