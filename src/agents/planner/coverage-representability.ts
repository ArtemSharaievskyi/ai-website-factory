import { z } from "zod";
import {
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
  PlannerRequirementCoverageConstraintSchema,
  type PlannerRequirementCoverageConstraint,
} from "./coverage-contract";
import { PlannerReferenceTableSchema, type PlannerReferenceTable } from "./reference-table";

const RequirementTokenSchema = z.string().regex(/^REQ_\d{3,}$/);
const ObligationTokenSchema = z.string().regex(/^OBLIGATION_\d{3}$/);
const AnchorTokenSchema = z.string().regex(/^ANCHOR_\d{3}$/);

export const COVERAGE_REPRESENTABILITY_CONTRACT_VERSION = "planner.coverage-representability.v1" as const;
export const MAX_COVERAGE_REPRESENTABILITY_ANCHORS = 256;

/**
 * A structural obligation is derived from the current host reference table.
 * It deliberately contains no canonical requirement identity; REQ tokens are
 * bounded provider aliases and remain individually owned by Coverage v2.
 */
export const CoverageRepresentabilityObligationSchema = z.object({
  obligationToken: ObligationTokenSchema,
  requirementTokens: z.array(RequirementTokenSchema).min(1).max(512),
  allowedDomains: z.array(PlannerCoverageDomainSchema).min(1).max(7),
  allowedKinds: z.array(PlannerCoverageElementKindSchema).min(1).max(21),
  requiredPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  allowedPageTokens: z.array(z.string().regex(/^PAGE_\d{3,}$/)).max(256),
  requiredRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  allowedRouteTokens: z.array(z.string().regex(/^ROUTE_\d{3,}$/)).max(256),
  positiveRequirement: z.boolean(),
  negativeEvidenceRequired: z.boolean(),
  minimumDistinctTargets: z.number().int().min(1).max(32),
  equivalenceSignature: z.string().min(1).max(4096),
}).strict();
export type CoverageRepresentabilityObligation = z.infer<typeof CoverageRepresentabilityObligationSchema>;

export const CoverageRepresentabilityAnchorSchema = z.object({
  anchorToken: AnchorTokenSchema,
  obligationToken: ObligationTokenSchema,
  targetOrdinal: z.number().int().min(1).max(32),
  minimumDistinctTargets: z.number().int().min(1).max(32),
}).strict();
export type CoverageRepresentabilityAnchor = z.infer<typeof CoverageRepresentabilityAnchorSchema>;

export const CoverageRepresentabilityAnchorFailureReasonCodeSchema = z.enum([
  "PLANNING_COVERAGE_REPRESENTABILITY_ANCHOR_MISSING",
  "PLANNING_COVERAGE_REPRESENTABILITY_ANCHOR_INVALID",
]);
export type CoverageRepresentabilityAnchorFailureReasonCode = z.infer<typeof CoverageRepresentabilityAnchorFailureReasonCodeSchema>;

export const CoverageRepresentabilityAnchorDiagnosticsSchema = z.object({
  anchorToken: AnchorTokenSchema,
  obligationToken: ObligationTokenSchema,
  requirementTokens: z.array(RequirementTokenSchema).min(1).max(512),
  actualDomain: PlannerCoverageDomainSchema.optional(),
  actualKind: PlannerCoverageElementKindSchema.optional(),
  allowedDomains: z.array(PlannerCoverageDomainSchema).min(1).max(7),
  allowedKinds: z.array(PlannerCoverageElementKindSchema).min(1).max(21),
  minimumDistinctTargets: z.number().int().min(1).max(32),
  reasonCode: CoverageRepresentabilityAnchorFailureReasonCodeSchema,
}).strict();
export type CoverageRepresentabilityAnchorDiagnostics = z.infer<typeof CoverageRepresentabilityAnchorDiagnosticsSchema>;

export const CoverageRepresentabilityPlanSchema = z.object({
  contractVersion: z.literal(COVERAGE_REPRESENTABILITY_CONTRACT_VERSION),
  obligations: z.array(CoverageRepresentabilityObligationSchema).min(1).max(512),
  anchors: z.array(CoverageRepresentabilityAnchorSchema).min(1).max(MAX_COVERAGE_REPRESENTABILITY_ANCHORS),
}).strict().superRefine((value, context) => {
  const obligations = new Map(value.obligations.map((obligation) => [obligation.obligationToken, obligation]));
  if (obligations.size !== value.obligations.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations"], message: "Representability obligation tokens must be unique." });
  const requirementTokens = value.obligations.flatMap((obligation) => obligation.requirementTokens);
  if (new Set(requirementTokens).size !== requirementTokens.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligations"], message: "Each mandatory requirement token must belong to exactly one representability obligation." });
  if (new Set(value.anchors.map((anchor) => anchor.anchorToken)).size !== value.anchors.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "Representability anchor tokens must be unique." });
  const anchorOrdinals = new Map<string, number[]>();
  for (const anchor of value.anchors) {
    const obligation = obligations.get(anchor.obligationToken);
    if (!obligation) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "Every anchor must bind to a current obligation." });
      continue;
    }
    if (anchor.minimumDistinctTargets !== obligation.minimumDistinctTargets)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "Anchor cardinality must equal its obligation cardinality." });
    anchorOrdinals.set(anchor.obligationToken, [...(anchorOrdinals.get(anchor.obligationToken) ?? []), anchor.targetOrdinal]);
  }
  for (const obligation of value.obligations) {
    const ordinals = [...(anchorOrdinals.get(obligation.obligationToken) ?? [])].sort((left, right) => left - right);
    if (ordinals.length !== obligation.minimumDistinctTargets || ordinals.some((ordinal, index) => ordinal !== index + 1))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["anchors"], message: "Each obligation must have contiguous anchor ordinals for its minimum cardinality." });
  }
});
export type CoverageRepresentabilityPlan = z.infer<typeof CoverageRepresentabilityPlanSchema>;

export const CoverageRepresentabilityMetricsSchema = z.object({
  planningElementCount: z.number().int().nonnegative().max(256),
  obligationCount: z.number().int().positive().max(512),
  anchorCount: z.number().int().positive().max(MAX_COVERAGE_REPRESENTABILITY_ANCHORS),
  countByDomain: z.record(PlannerCoverageDomainSchema, z.number().int().nonnegative().max(256)),
  countByKind: z.record(PlannerCoverageElementKindSchema, z.number().int().nonnegative().max(256)),
  minimumAdmissibleTargetCount: z.number().int().nonnegative().max(256),
  maximumAdmissibleTargetCount: z.number().int().nonnegative().max(256),
  averageAdmissibleTargetCount: z.number().nonnegative().max(256),
  medianAdmissibleTargetCount: z.number().nonnegative().max(256),
  totalAdmissibleEdges: z.number().int().nonnegative().max(131072),
  distinctTargetSetSignatureCount: z.number().int().positive().max(512),
  requirementsAtMinimumBoundary: z.array(RequirementTokenSchema).max(512),
  zeroTargetRequirements: z.array(RequirementTokenSchema).max(512),
}).strict();
export type CoverageRepresentabilityMetrics = z.infer<typeof CoverageRepresentabilityMetricsSchema>;

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();

function canonicalConstraint(constraint: PlannerRequirementCoverageConstraint) {
  return {
    allowedDomains: sortedUnique(constraint.allowedDomains),
    allowedKinds: sortedUnique(constraint.allowedElementKinds),
    requiredPageTokens: sortedUnique(constraint.requiredPageTokens),
    allowedPageTokens: sortedUnique(constraint.allowedPageTokens),
    requiredRouteTokens: sortedUnique(constraint.requiredRouteTokens),
    allowedRouteTokens: sortedUnique(constraint.allowedRouteTokens),
    positiveRequirement: constraint.positiveRequirement,
    negativeEvidenceRequired: constraint.negativeEvidenceRequired,
    minimumDistinctTargets: constraint.minimumCoverageTargets,
  } as const;
}

function constraintSignature(constraint: PlannerRequirementCoverageConstraint) {
  return JSON.stringify(canonicalConstraint(constraint));
}

/**
 * Derive deterministic, lossless structural obligations from the mandatory
 * reference-table requirements. Equivalent static constraints share one
 * obligation; Coverage later still receives every individual REQ token.
 */
export function deriveCoverageRepresentabilityPlan(table: PlannerReferenceTable): CoverageRepresentabilityPlan {
  const parsed = PlannerReferenceTableSchema.parse(table);
  const groups = new Map<string, string[]>();
  const constraints = new Map<string, PlannerRequirementCoverageConstraint>();
  for (const requirement of parsed.requirements.filter((entry) => entry.mandatory).sort((left, right) => left.token.localeCompare(right.token))) {
    const constraint = PlannerRequirementCoverageConstraintSchema.parse(requirement.coverageConstraints);
    const signature = constraintSignature(constraint);
    groups.set(signature, [...(groups.get(signature) ?? []), requirement.token]);
    constraints.set(signature, constraint);
  }
  const signatures = [...groups.keys()].sort();
  const obligations = signatures.map((signature, index) => {
    const constraint = canonicalConstraint(constraints.get(signature)!);
    return CoverageRepresentabilityObligationSchema.parse({
      obligationToken: `OBLIGATION_${String(index + 1).padStart(3, "0")}`,
      requirementTokens: groups.get(signature)!.sort(),
      ...constraint,
      equivalenceSignature: signature,
    });
  });
  const anchors = obligations.flatMap((obligation) => Array.from({ length: obligation.minimumDistinctTargets }, (_, index) => ({
    anchorToken: `ANCHOR_${String(index + 1 + anchorsFor(obligations.slice(0, obligations.indexOf(obligation)))).padStart(3, "0")}`,
    obligationToken: obligation.obligationToken,
    targetOrdinal: index + 1,
    minimumDistinctTargets: obligation.minimumDistinctTargets,
  })));
  return CoverageRepresentabilityPlanSchema.parse({
    contractVersion: COVERAGE_REPRESENTABILITY_CONTRACT_VERSION,
    obligations,
    anchors,
  });
}

function anchorsFor(obligations: readonly CoverageRepresentabilityObligation[]) {
  return obligations.reduce((total, obligation) => total + obligation.minimumDistinctTargets, 0);
}

export function obligationForAnchor(plan: CoverageRepresentabilityPlan, anchor: CoverageRepresentabilityAnchor) {
  const parsed = CoverageRepresentabilityPlanSchema.parse(plan);
  const obligation = parsed.obligations.find((candidate) => candidate.obligationToken === anchor.obligationToken);
  if (!obligation) throw new Error("PLANNING_COVERAGE_REPRESENTABILITY_OBLIGATION_UNKNOWN");
  return obligation;
}

export function obligationForRequirement(plan: CoverageRepresentabilityPlan, requirementToken: string) {
  const parsed = CoverageRepresentabilityPlanSchema.parse(plan);
  return parsed.obligations.find((obligation) => obligation.requirementTokens.includes(requirementToken));
}

export function obligationAsCoverageConstraint(obligation: CoverageRepresentabilityObligation): PlannerRequirementCoverageConstraint {
  return PlannerRequirementCoverageConstraintSchema.parse({
    allowedDomains: obligation.allowedDomains,
    allowedElementKinds: obligation.allowedKinds,
    requiredPageTokens: obligation.requiredPageTokens,
    allowedPageTokens: obligation.allowedPageTokens,
    requiredRouteTokens: obligation.requiredRouteTokens,
    allowedRouteTokens: obligation.allowedRouteTokens,
    positiveRequirement: obligation.positiveRequirement,
    negativeEvidenceRequired: obligation.negativeEvidenceRequired,
    minimumCoverageTargets: obligation.minimumDistinctTargets,
  });
}
