import { z } from "zod";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import {
  PLANNER_ELEMENT_KINDS_BY_DOMAIN,
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
  type PlannerCoverageDomain,
  type PlannerCoverageElementKind,
} from "./coverage-contract";

/**
 * The minimum decomposition contract is host-owned. It is derived from the
 * approved capability state, then consumed by the provider wire schema,
 * prompt builder, and deterministic admission. It is not a second
 * requirements authority and it never creates provider proposals.
 */
export const DECOMPOSITION_MINIMUM_CONTRACT_VERSION = "planner.decomposition.minimum.v1" as const;

const domainCountShape = Object.fromEntries(
  PlannerCoverageDomainSchema.options.map((domain) => [domain, z.number().int().nonnegative().max(256)]),
) as Record<PlannerCoverageDomain, z.ZodNumber>;
const kindCountShape = Object.fromEntries(
  PlannerCoverageElementKindSchema.options.map((kind) => [kind, z.number().int().nonnegative().max(256)]),
) as Record<PlannerCoverageElementKind, z.ZodNumber>;

export const DecompositionMinimumKindGroupSchema = z.object({
  group: z.literal("PAGE_OR_ROUTE"),
  kinds: z.array(PlannerCoverageElementKindSchema).min(2).max(21),
  minimum: z.number().int().positive().max(32),
}).strict();
export type DecompositionMinimumKindGroup = z.infer<typeof DecompositionMinimumKindGroupSchema>;

export const DecompositionMinimumContractSchema = z.object({
  contractVersion: z.literal(DECOMPOSITION_MINIMUM_CONTRACT_VERSION),
  minimumTotalElements: z.number().int().positive().max(256),
  requiredDomains: z.array(PlannerCoverageDomainSchema).min(1).max(7),
  minimumByDomain: z.object(domainCountShape).strict(),
  requiredKinds: z.array(PlannerCoverageElementKindSchema).max(21),
  minimumByKind: z.object(kindCountShape).strict(),
  requiredKindGroups: z.array(DecompositionMinimumKindGroupSchema).max(4),
}).strict();
export type DecompositionMinimumContract = z.infer<typeof DecompositionMinimumContractSchema>;

export const DecompositionMinimumDiagnosticsSchema = z.object({
  actualElementCount: z.number().int().nonnegative().max(256),
  minimumElementCount: z.number().int().positive().max(256),
  actualCountByDomain: z.object(domainCountShape).strict(),
  minimumCountByDomain: z.object(domainCountShape).strict(),
  missingRequiredDomains: z.array(PlannerCoverageDomainSchema).max(7),
  actualCountByKind: z.object(kindCountShape).strict(),
  minimumCountByKind: z.object(kindCountShape).strict(),
  missingRequiredKinds: z.array(PlannerCoverageElementKindSchema).max(21),
}).strict();
export type DecompositionMinimumDiagnostics = z.infer<typeof DecompositionMinimumDiagnosticsSchema>;

const sortedUnique = <T extends string>(values: readonly T[]) => [...new Set(values)].sort() as T[];

/** This is the existing capability-derived required-domain rule. */
export function requiredDecompositionDomains(input: { brief: RequirementSpecification; canonicalBrief?: CanonicalBriefV3 }): PlannerCoverageDomain[] {
  const { brief, canonicalBrief } = input;
  const required = new Set<PlannerCoverageDomain>(["FRONTEND"]);
  const canonicalStateful = canonicalBrief && (
    canonicalBrief.decisions.database.mode !== "NONE"
    || canonicalBrief.decisions.auth.mode === "REQUIRED"
    || canonicalBrief.decisions.form.persistenceMode === "DATABASE"
    || canonicalBrief.decisions.form.serverProcessingMode === "SERVER"
  );
  const stateful = Boolean(
    canonicalStateful
    || brief.backendRequirements.length
    || brief.supabaseRequirements.length
    || brief.authenticationDecision === "authentication-required"
    || brief.protectedFunctionalityRequired
    || brief.storageDecision === "needed"
    || brief.emailDecision === "needed"
    || brief.administrationDecision === "needed"
    || brief.formBehaviorRequirements?.persistence === "DATABASE"
    || brief.formBehaviorRequirements?.dataTransmission !== "NONE",
  );
  if (stateful) required.add("BACKEND");
  if (canonicalStateful || brief.supabaseRequirements.length || brief.formBehaviorRequirements?.persistence === "DATABASE") required.add("DATABASE");
  if (brief.authenticationDecision === "authentication-required" || brief.protectedFunctionalityRequired || canonicalBrief?.decisions.auth.mode === "REQUIRED") required.add("SECURITY");
  return [...required].sort();
}

function emptyDomainCounts() {
  return Object.fromEntries(PlannerCoverageDomainSchema.options.map((domain) => [domain, 0])) as Record<PlannerCoverageDomain, number>;
}

function emptyKindCounts() {
  return Object.fromEntries(PlannerCoverageElementKindSchema.options.map((kind) => [kind, 0])) as Record<PlannerCoverageElementKind, number>;
}

/**
 * Derive the smallest meaningful structure equivalent to the current host
 * guard: one scope target and one page/route target are both frontend
 * responsibilities; every other required capability domain needs one
 * representation. The page-or-route kind group remains host-only because a
 * heterogeneous domain bucket cannot express an "at least one of" constraint
 * in the certified strict JSON Schema subset.
 */
export function createDecompositionMinimumContract(input: { brief: RequirementSpecification; canonicalBrief?: CanonicalBriefV3 }): DecompositionMinimumContract {
  const requiredDomains = requiredDecompositionDomains(input);
  const minimumByDomain = emptyDomainCounts();
  minimumByDomain.FRONTEND = 2;
  for (const domain of requiredDomains) if (domain !== "FRONTEND") minimumByDomain[domain] = 1;
  const minimumByKind = emptyKindCounts();
  minimumByKind.PRODUCT_SCOPE = 1;
  return validateDecompositionMinimumContract({
    contractVersion: DECOMPOSITION_MINIMUM_CONTRACT_VERSION,
    minimumTotalElements: Object.values(minimumByDomain).reduce((sum, count) => sum + count, 0),
    requiredDomains,
    minimumByDomain,
    requiredKinds: ["PRODUCT_SCOPE"],
    minimumByKind,
    requiredKindGroups: [{ group: "PAGE_OR_ROUTE", kinds: ["PAGE", "ROUTE"], minimum: 1 }],
  });
}

export function validateDecompositionMinimumContract(value: unknown): DecompositionMinimumContract {
  const parsed = DecompositionMinimumContractSchema.parse(value);
  const domainSum = Object.values(parsed.minimumByDomain).reduce((sum, count) => sum + count, 0);
  if (domainSum !== parsed.minimumTotalElements) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_TOTAL_MISMATCH");
  if (parsed.requiredDomains.some((domain) => parsed.minimumByDomain[domain] < 1)) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_REQUIRED_DOMAIN_INVALID");
  if (parsed.requiredKinds.some((kind) => parsed.minimumByKind[kind] < 1)) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_REQUIRED_KIND_INVALID");
  for (const domain of PlannerCoverageDomainSchema.options) {
    if (parsed.minimumByDomain[domain] > 256) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_DOMAIN_MAX_INVALID");
    if (parsed.minimumByDomain[domain] > 0 && PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain].length === 0) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_DOMAIN_UNREPRESENTABLE");
  }
  if (parsed.minimumTotalElements > 256) throw new Error("PLANNING_DECOMPOSITION_MINIMUM_CONTRACT_TOTAL_MAX_INVALID");
  return parsed;
}

export function decompositionMinimumDiagnostics(elements: readonly { domain: PlannerCoverageDomain; kind: PlannerCoverageElementKind }[], contract: DecompositionMinimumContract): DecompositionMinimumDiagnostics {
  const actualCountByDomain = emptyDomainCounts();
  const actualCountByKind = emptyKindCounts();
  for (const element of elements) {
    actualCountByDomain[element.domain] += 1;
    actualCountByKind[element.kind] += 1;
  }
  const missingRequiredDomains = sortedUnique(contract.requiredDomains.filter((domain) => actualCountByDomain[domain] < contract.minimumByDomain[domain]));
  const missingRequiredKinds = sortedUnique(contract.requiredKinds.filter((kind) => actualCountByKind[kind] < contract.minimumByKind[kind]));
  return DecompositionMinimumDiagnosticsSchema.parse({
    actualElementCount: elements.length,
    minimumElementCount: contract.minimumTotalElements,
    actualCountByDomain,
    minimumCountByDomain: contract.minimumByDomain,
    missingRequiredDomains,
    actualCountByKind,
    minimumCountByKind: contract.minimumByKind,
    missingRequiredKinds,
  });
}

export function decompositionMinimumSatisfied(input: {
  elements: readonly { domain: PlannerCoverageDomain; kind: PlannerCoverageElementKind }[];
  contract: DecompositionMinimumContract;
  hasPageOrRoute: boolean;
  hasRequiredPageOrRouteBinding: boolean;
}) {
  const diagnostics = decompositionMinimumDiagnostics(input.elements, input.contract);
  const groupSatisfied = input.contract.requiredKindGroups.every((group) => {
    if (group.group === "PAGE_OR_ROUTE") return input.hasPageOrRoute;
    return true;
  });
  const structuralSatisfied = diagnostics.actualElementCount >= diagnostics.minimumElementCount
    && diagnostics.missingRequiredDomains.length === 0
    && diagnostics.missingRequiredKinds.length === 0
    && groupSatisfied
    && input.hasRequiredPageOrRouteBinding;
  return { satisfied: structuralSatisfied, diagnostics } as const;
}
