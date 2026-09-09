import { z } from "zod";
import { RequirementCategorySchema, type RequirementCategory } from "@/domain/requirements/v3/schema";

/**
 * The coverage contract is a typed view of the canonical requirement
 * category.  It is guidance for the provider and a deterministic admission
 * constraint for the host; it is not a second requirement taxonomy.
 */
export const PlannerCoverageDomainSchema = z.enum([
  "FRONTEND",
  "BACKEND",
  "DATABASE",
  "INTEGRATION",
  "QA",
  "SECURITY",
  "LIFECYCLE",
]);
export type PlannerCoverageDomain = z.infer<typeof PlannerCoverageDomainSchema>;

export const PlannerCoverageElementKindSchema = z.enum([
  "PROFILE",
  "PRODUCT_SCOPE",
  "ROUTE",
  "PAGE",
  "NAVIGATION",
  "USER_FLOW",
  "FORM",
  "DATABASE_MODEL",
  "AUTHENTICATION",
  "SUPABASE",
  "EMAIL",
  "STORAGE",
  "ADMINISTRATION",
  "CONTENT",
  "ASSET",
  "ARCHITECTURE",
  "ENVIRONMENT",
  "DEPENDENCY",
  "TEST_STRATEGY",
  "SECURITY",
  "TRACEABILITY",
]);
export type PlannerCoverageElementKind = z.infer<typeof PlannerCoverageElementKindSchema>;

export const PLANNER_COVERAGE_CONTRACT_VERSION = "planner.coverage.v2" as const;
export const PLANNER_COVERAGE_LEGACY_CONTRACT_VERSION = "planner.coverage.v1" as const;

const PlannerRequirementTokenSchema = z.string().regex(/^REQ_\d{3,}$/);
const PlannerElementTokenSchema = z.string().regex(/^PE_\d{3}$/);
const PlannerCoverageDiagnosticElementTokenSchema = z.string().min(1).max(160).regex(/^[A-Za-z][A-Za-z0-9:_./-]*$/);
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * These are the deterministic coverage reason codes which can be decided
 * from typed requirement constraints and typed PE metadata.  Semantic
 * evidence reasons are deliberately kept in host admission.
 */
export const PlannerCoverageStaticFailureReasonCodeSchema = z.enum([
  "PLANNING_COVERAGE_EMPTY",
  "PLANNING_COVERAGE_ELEMENT_NOT_FOUND",
  "PLANNING_COVERAGE_KIND_INCOMPATIBLE",
  "PLANNING_COVERAGE_DOMAIN_INCOMPATIBLE",
  "PLANNING_COVERAGE_PAGE_BINDING_MISMATCH",
  "PLANNING_COVERAGE_ROUTE_BINDING_MISMATCH",
  "PLANNING_COVERAGE_EXCLUSION_CANNOT_SATISFY",
  "PLANNING_COVERAGE_NEGATIVE_EVIDENCE_MISSING",
  "PLANNING_COVERAGE_NO_ADMISSIBLE_TARGETS",
  "PLANNING_COVERAGE_TARGET_NOT_ADMISSIBLE",
]);
export type PlannerCoverageStaticFailureReasonCode = z.infer<typeof PlannerCoverageStaticFailureReasonCodeSchema>;

export const PlannerCoverageDiagnosticsSchema = z.object({
  requirementToken: PlannerRequirementTokenSchema,
  requirementCategory: RequirementCategorySchema,
  planningElementToken: PlannerCoverageDiagnosticElementTokenSchema.optional(),
  actualDomain: PlannerCoverageDomainSchema.optional(),
  actualKind: PlannerCoverageElementKindSchema.optional(),
  allowedDomains: z.array(PlannerCoverageDomainSchema).min(1).max(7),
  allowedKinds: z.array(PlannerCoverageElementKindSchema).min(1).max(21),
  requiredPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  allowedPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  requiredRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  allowedRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  admissibleTargetCount: z.number().int().nonnegative().max(256),
  minimumCoverageTargets: z.number().int().min(1).max(32),
  reasonCode: PlannerCoverageStaticFailureReasonCodeSchema,
}).strict();
export type PlannerCoverageDiagnostics = z.infer<typeof PlannerCoverageDiagnosticsSchema>;

export type PlannerCoverageElementDescriptor = {
  kind: PlannerCoverageElementKind;
  domains: readonly PlannerCoverageDomain[];
  pageToken?: string;
  routeToken?: string;
  pageTokens?: readonly string[];
  routeTokens?: readonly string[];
  negativeOnly?: boolean;
  negativeEvidence?: boolean;
};

/**
 * The single kind x domain compatibility authority for Planning
 * decomposition.  Provider wire variants and deterministic host admission
 * both derive from this declaration; do not maintain a second matrix.
 */
export const PLANNER_ELEMENT_KIND_DOMAINS = {
  PROFILE: ["FRONTEND", "LIFECYCLE"],
  PRODUCT_SCOPE: ["FRONTEND", "BACKEND", "DATABASE", "LIFECYCLE"],
  ROUTE: ["FRONTEND", "LIFECYCLE"],
  PAGE: ["FRONTEND"],
  NAVIGATION: ["FRONTEND"],
  USER_FLOW: ["FRONTEND", "BACKEND", "LIFECYCLE"],
  FORM: ["FRONTEND", "BACKEND"],
  DATABASE_MODEL: ["DATABASE", "BACKEND"],
  AUTHENTICATION: ["BACKEND", "SECURITY"],
  SUPABASE: ["BACKEND", "DATABASE", "SECURITY", "INTEGRATION"],
  EMAIL: ["BACKEND", "INTEGRATION"],
  STORAGE: ["BACKEND", "DATABASE", "INTEGRATION"],
  ADMINISTRATION: ["FRONTEND", "BACKEND", "SECURITY"],
  CONTENT: ["FRONTEND"],
  ASSET: ["FRONTEND"],
  ARCHITECTURE: ["FRONTEND", "BACKEND", "DATABASE", "INTEGRATION", "LIFECYCLE"],
  ENVIRONMENT: ["BACKEND", "INTEGRATION", "SECURITY"],
  DEPENDENCY: ["BACKEND", "INTEGRATION"],
  TEST_STRATEGY: ["QA"],
  SECURITY: ["SECURITY"],
  TRACEABILITY: ["QA", "LIFECYCLE"],
} as const satisfies Record<PlannerCoverageElementKind, readonly PlannerCoverageDomain[]>;

export const PLANNER_ELEMENT_KINDS_BY_DOMAIN: Record<PlannerCoverageDomain, readonly PlannerCoverageElementKind[]> = Object.fromEntries(
  PlannerCoverageDomainSchema.options.map((domain) => [
    domain,
    PlannerCoverageElementKindSchema.options.filter((kind) => (PLANNER_ELEMENT_KIND_DOMAINS[kind] as readonly PlannerCoverageDomain[]).includes(domain)),
  ]),
) as unknown as Record<PlannerCoverageDomain, readonly PlannerCoverageElementKind[]>;

export function plannerElementKindsForDomain(domain: PlannerCoverageDomain) {
  return PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain];
}

export function isPlannerElementKindAllowedInDomain(kind: PlannerCoverageElementKind, domain: PlannerCoverageDomain) {
  return (PLANNER_ELEMENT_KIND_DOMAINS[kind] as readonly PlannerCoverageDomain[]).includes(domain);
}

export const PlannerDecompositionKindDomainDiagnosticsSchema = z.object({
  actualDomain: PlannerCoverageDomainSchema,
  actualKind: PlannerCoverageElementKindSchema,
  allowedKindsForDomain: z.array(PlannerCoverageElementKindSchema).min(1).max(21),
  elementIndex: z.number().int().min(0).max(255).optional(),
}).strict();
export type PlannerDecompositionKindDomainDiagnostics = z.infer<typeof PlannerDecompositionKindDomainDiagnosticsSchema>;

export const PlannerRequirementCoverageConstraintSchema = z.object({
  allowedDomains: z.array(PlannerCoverageDomainSchema).min(1).max(7),
  allowedElementKinds: z.array(PlannerCoverageElementKindSchema).min(1).max(21),
  requiredPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  allowedPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  requiredRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  allowedRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  positiveRequirement: z.boolean(),
  negativeEvidenceRequired: z.boolean(),
  minimumCoverageTargets: z.number().int().min(1).max(32),
}).strict();
export type PlannerRequirementCoverageConstraint = z.infer<typeof PlannerRequirementCoverageConstraintSchema>;

export const PlannerCoverageTargetBindingSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  expectedRowVersion: z.number().int().positive(),
  approvedBriefChecksum: ChecksumSchema,
  referenceTableChecksum: ChecksumSchema,
  planningElementsChecksum: ChecksumSchema,
  graphChecksum: ChecksumSchema,
  coverageOperationId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/),
  operationChecksum: ChecksumSchema,
  contractVersion: z.literal(PLANNER_COVERAGE_CONTRACT_VERSION),
}).strict();
export type PlannerCoverageTargetBinding = z.infer<typeof PlannerCoverageTargetBindingSchema>;

export const AdmissibleCoverageTargetsByRequirementSchema = z.record(
  PlannerRequirementTokenSchema,
  z.array(PlannerElementTokenSchema).max(256),
);
export type AdmissibleCoverageTargetsByRequirement = z.infer<typeof AdmissibleCoverageTargetsByRequirementSchema>;

export const PlannerCoverageTargetTableSchema = z.object({
  binding: PlannerCoverageTargetBindingSchema,
  admissibleCoverageTargetsByRequirement: AdmissibleCoverageTargetsByRequirementSchema,
}).strict();
export type PlannerCoverageTargetTable = z.infer<typeof PlannerCoverageTargetTableSchema>;

type CoverageDefinition = {
  allowedDomains: readonly PlannerCoverageDomain[];
  allowedElementKinds: readonly PlannerCoverageElementKind[];
  positiveRequirement: boolean;
  negativeEvidenceRequired: boolean;
  pageRouteEligible: boolean;
};

const definition = (
  allowedDomains: readonly PlannerCoverageDomain[],
  allowedElementKinds: readonly PlannerCoverageElementKind[],
  positiveRequirement = true,
  pageRouteEligible = false,
  negativeEvidenceRequired = false,
): CoverageDefinition => ({ allowedDomains, allowedElementKinds, positiveRequirement, negativeEvidenceRequired, pageRouteEligible });

/** Every canonical V3 category has an explicit Planner compatibility policy. */
export const PLANNER_COVERAGE_DEFINITIONS: Record<RequirementCategory, CoverageDefinition> = {
  BUSINESS_GOAL: definition(["LIFECYCLE", "FRONTEND"], ["PROFILE", "PRODUCT_SCOPE"]),
  AUDIENCE: definition(["FRONTEND", "LIFECYCLE"], ["PROFILE", "PRODUCT_SCOPE", "PAGE"], true, true),
  USER_ROLE: definition(["SECURITY", "BACKEND", "FRONTEND"], ["AUTHENTICATION", "ADMINISTRATION", "PROFILE"]),
  FEATURE: definition(["FRONTEND", "BACKEND", "DATABASE", "LIFECYCLE"], ["PRODUCT_SCOPE", "ROUTE", "PAGE", "USER_FLOW", "FORM", "DATABASE_MODEL", "ARCHITECTURE"], true, true),
  FORM: definition(["FRONTEND", "BACKEND"], ["FORM", "PAGE", "USER_FLOW"], true, true),
  CONTENT: definition(["FRONTEND"], ["CONTENT", "PAGE"], true, true),
  BACKEND: definition(["BACKEND", "DATABASE", "SECURITY"], ["ARCHITECTURE", "DATABASE_MODEL", "SUPABASE"]),
  DATABASE: definition(["DATABASE", "BACKEND", "SECURITY"], ["DATABASE_MODEL", "SUPABASE", "ARCHITECTURE"]),
  SEO: definition(["FRONTEND", "LIFECYCLE"], ["ROUTE", "PAGE", "CONTENT"], true, true),
  TECHNICAL: definition(["FRONTEND", "BACKEND", "DATABASE", "INTEGRATION", "QA", "SECURITY", "LIFECYCLE"], ["ARCHITECTURE", "ENVIRONMENT", "DEPENDENCY", "TEST_STRATEGY", "SECURITY", "SUPABASE"]),
  EXCLUSION: definition(["LIFECYCLE", "SECURITY", "INTEGRATION"], ["PRODUCT_SCOPE", "ARCHITECTURE"], false, false, true),
  ACCEPTANCE: definition(["QA", "FRONTEND", "BACKEND", "LIFECYCLE"], ["PRODUCT_SCOPE", "PAGE", "FORM", "USER_FLOW", "TEST_STRATEGY"], true, true),
  CONTACT_FACT: definition(["FRONTEND", "LIFECYCLE"], ["PROFILE", "CONTENT", "PRODUCT_SCOPE"]),
  LEGAL_FACT: definition(["LIFECYCLE", "SECURITY", "FRONTEND"], ["PRODUCT_SCOPE", "CONTENT", "SECURITY"]),
  BRAND_FACT: definition(["FRONTEND", "LIFECYCLE"], ["PROFILE", "PRODUCT_SCOPE", "CONTENT"]),
  LOGO_METADATA: definition(["FRONTEND"], ["ASSET", "PROFILE", "PRODUCT_SCOPE"]),
  IMAGE_NOTE: definition(["FRONTEND"], ["ASSET", "CONTENT", "PAGE"], true, true),
  RECOMMENDATION: definition(["LIFECYCLE", "INTEGRATION", "BACKEND"], ["PRODUCT_SCOPE", "ARCHITECTURE", "DEPENDENCY"]),
  BRAND_VISUAL: definition(["FRONTEND"], ["ASSET", "CONTENT", "PROFILE"]),
  UX_RESPONSIVE: definition(["FRONTEND"], ["PAGE", "NAVIGATION", "ARCHITECTURE"], true, true),
  LEGAL_CONSTRAINT: definition(["LIFECYCLE", "SECURITY", "QA"], ["PRODUCT_SCOPE", "SECURITY", "TEST_STRATEGY"]),
  PROHIBITED: definition(["SECURITY", "LIFECYCLE", "INTEGRATION"], ["PRODUCT_SCOPE", "ARCHITECTURE"], false, false, true),
  DEFERRED_INTEGRATION: definition(["INTEGRATION", "BACKEND", "DATABASE"], ["DEPENDENCY", "ARCHITECTURE", "EMAIL", "STORAGE", "SUPABASE"]),
  DECISION: definition(["LIFECYCLE", "BACKEND", "DATABASE", "SECURITY"], ["PRODUCT_SCOPE", "ARCHITECTURE", "SUPABASE", "AUTHENTICATION"]),
  ADMINISTRATION: definition(["BACKEND", "SECURITY", "FRONTEND"], ["ADMINISTRATION", "AUTHENTICATION", "PAGE"], true, true),
  FORM_INTERACTION: definition(["FRONTEND", "BACKEND"], ["FORM", "USER_FLOW", "PAGE"], true, true),
  OTHER: definition(["LIFECYCLE", "QA", "BACKEND"], ["PRODUCT_SCOPE", "ARCHITECTURE", "TEST_STRATEGY"]),
};

export function createPlannerRequirementCoverageConstraint(input: {
  category: RequirementCategory;
  allPageTokens: readonly string[];
  allRouteTokens: readonly string[];
  requiredPageTokens?: readonly string[];
  requiredRouteTokens?: readonly string[];
}): PlannerRequirementCoverageConstraint {
  const base = PLANNER_COVERAGE_DEFINITIONS[input.category];
  const requiredPageTokens = [...new Set(input.requiredPageTokens ?? [])].sort();
  const requiredRouteTokens = [...new Set(input.requiredRouteTokens ?? [])].sort();
  const pageRouteRequired = requiredPageTokens.length > 0 || requiredRouteTokens.length > 0;
  const allowedElementKinds = [...new Set([
    ...base.allowedElementKinds,
    ...(pageRouteRequired ? (["PAGE", "ROUTE"] as const) : []),
  ])];
  const allowedDomains = [...new Set([
    ...base.allowedDomains,
    ...(pageRouteRequired ? (["FRONTEND"] as const) : []),
  ])];
  return PlannerRequirementCoverageConstraintSchema.parse({
    allowedDomains,
    allowedElementKinds,
    requiredPageTokens,
    allowedPageTokens: base.pageRouteEligible || pageRouteRequired ? [...input.allPageTokens].sort() : [],
    requiredRouteTokens,
    allowedRouteTokens: base.pageRouteEligible || pageRouteRequired ? [...input.allRouteTokens].sort() : [],
    positiveRequirement: base.positiveRequirement,
    negativeEvidenceRequired: base.negativeEvidenceRequired,
    minimumCoverageTargets: 1,
  });
}

/**
 * The one metadata-only Coverage compatibility authority.  Target derivation
 * and host admission must both use this function; semantic evidence is not
 * reduced to a wire-schema predicate.
 */
export function plannerCoverageCompatibility(
  constraints: PlannerRequirementCoverageConstraint,
  descriptor: PlannerCoverageElementDescriptor,
): { compatible: true } | { compatible: false; reasonCode: PlannerCoverageStaticFailureReasonCode } {
  if (!constraints.allowedElementKinds.includes(descriptor.kind))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" };
  if (!descriptor.domains.some((domain) => constraints.allowedDomains.includes(domain)))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_DOMAIN_INCOMPATIBLE" };
  if (descriptor.pageToken && !constraints.allowedPageTokens.includes(descriptor.pageToken))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_PAGE_BINDING_MISMATCH" };
  if (descriptor.routeToken && !constraints.allowedRouteTokens.includes(descriptor.routeToken))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_ROUTE_BINDING_MISMATCH" };
  if (descriptor.pageTokens?.some((token) => !constraints.allowedPageTokens.includes(token)))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_PAGE_BINDING_MISMATCH" };
  if (descriptor.routeTokens?.some((token) => !constraints.allowedRouteTokens.includes(token)))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_ROUTE_BINDING_MISMATCH" };
  if (constraints.positiveRequirement && descriptor.negativeOnly)
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_EXCLUSION_CANNOT_SATISFY" };
  if (constraints.negativeEvidenceRequired && !descriptor.negativeEvidence)
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_NEGATIVE_EVIDENCE_MISSING" };
  if (constraints.requiredPageTokens.some((token) => !(descriptor.pageToken === token || descriptor.pageTokens?.includes(token))))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_PAGE_BINDING_MISMATCH" };
  if (constraints.requiredRouteTokens.some((token) => !(descriptor.routeToken === token || descriptor.routeTokens?.includes(token))))
    return { compatible: false, reasonCode: "PLANNING_COVERAGE_ROUTE_BINDING_MISMATCH" };
  return { compatible: true };
}
