import { z } from "zod";
import type { RequirementCategory } from "@/domain/requirements/v3/schema";

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
