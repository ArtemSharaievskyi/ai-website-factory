import { z } from "zod";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";
import {
  PLANNER_ELEMENT_KINDS_BY_DOMAIN,
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
  AdmissibleCoverageTargetsByRequirementSchema,
  PLANNER_COVERAGE_CONTRACT_VERSION,
  PLANNER_COVERAGE_LEGACY_CONTRACT_VERSION,
  type PlannerCoverageDomain,
  type PlannerCoverageElementKind,
  type AdmissibleCoverageTargetsByRequirement,
} from "./coverage-contract";
import {
  PlannerPageToken,
  PlannerReferenceTableSchema,
  PlannerRouteToken,
  type PlannerReferenceTable,
} from "./reference-table";
import type { DecompositionMinimumContract } from "./decomposition-minimum";
import { validateDecompositionMinimumContract } from "./decomposition-minimum";
import {
  CoverageRepresentabilityPlanSchema,
  type CoverageRepresentabilityAnchor,
  type CoverageRepresentabilityPlan,
} from "./coverage-representability";

export { PLANNER_COVERAGE_CONTRACT_VERSION, PLANNER_COVERAGE_LEGACY_CONTRACT_VERSION } from "./coverage-contract";

/**
 * Stage contracts are provider proposals, not canonical Planning documents.
 * The decomposition provider never receives or returns a requirement
 * coverage object and never owns a globally referenced Planning identity.
 */
export const PLANNER_DECOMPOSITION_LEGACY_CONTRACT_VERSION = "planner.decomposition.v1" as const;
export const PLANNER_DECOMPOSITION_PREVIOUS_CONTRACT_VERSION = "planner.decomposition.v2" as const;
export const PLANNER_DECOMPOSITION_HISTORICAL_CONTRACT_VERSION = "planner.decomposition.v3" as const;
export const PLANNER_DECOMPOSITION_CONTRACT_VERSION = "planner.decomposition.v4" as const;
export const PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME = "planning-decomposition-v4" as const;
export const PLANNING_COVERAGE_PROVIDER_SCHEMA_NAME = "planning-coverage-v2" as const;
export const PLANNING_COVERAGE_PROVIDER_SCHEMA_NAME_V1 = "planning-coverage-v1" as const;
export const STAGED_PLANNER_PIPELINE_VERSION = "planner.staged.v1" as const;

const ProposalIndexSchema = z.number().int().nonnegative().max(255);

const PlanningElementProposalFields = {
  title: NonEmptyStringSchema.max(240),
  description: NonEmptyStringSchema.max(2000),
  pageTokens: z.array(PlannerPageToken).max(32).nullable(),
  routeTokens: z.array(PlannerRouteToken).max(32).nullable(),
  /** Stage-1 local proposal indexes are resolved to PE_* by the host. */
  dependencies: z.array(ProposalIndexSchema).max(32).nullable(),
  negativeEvidence: z.boolean().nullable(),
  negativeOnly: z.boolean().nullable(),
} as const;

function kindEnumForDomain(domain: PlannerCoverageDomain) {
  const kinds = PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain];
  return z.enum(kinds as unknown as [PlannerCoverageElementKind, ...PlannerCoverageElementKind[]]);
}

export function planningElementProposalSchemaForDomain(domain: PlannerCoverageDomain) {
  return z.object({
    ...PlanningElementProposalFields,
    domain: z.literal(domain),
    kind: kindEnumForDomain(domain),
  }).strict();
}

const PlanningElementProposalVariants = PlannerCoverageDomainSchema.options.map(planningElementProposalSchemaForDomain);

export const PlanningElementProposalSchema = z.discriminatedUnion(
  "domain",
  PlanningElementProposalVariants as [typeof PlanningElementProposalVariants[number], ...typeof PlanningElementProposalVariants[number][]],
);
export type PlanningElementProposal = z.infer<typeof PlanningElementProposalSchema>;

/** Historical v1 wire reader. It is never used for new provider requests. */
export const PlanningElementProposalV1Schema = z.object({
  kind: PlannerCoverageElementKindSchema,
  domain: PlannerCoverageDomainSchema,
  ...PlanningElementProposalFields,
}).strict();
export const PlanningDecompositionProviderOutputV1Schema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_DECOMPOSITION_LEGACY_CONTRACT_VERSION),
  complete: z.literal(true),
  elements: z.array(PlanningElementProposalV1Schema).min(1).max(256),
}).strict();
export type PlanningDecompositionProviderOutputV1 = z.infer<typeof PlanningDecompositionProviderOutputV1Schema>;

/** Historical v2 wire reader. New provider requests use the bucketed v3 wire. */
export const PlanningDecompositionProviderOutputV2Schema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_DECOMPOSITION_PREVIOUS_CONTRACT_VERSION),
  complete: z.literal(true),
  elements: z.array(PlanningElementProposalSchema).min(1).max(256),
}).strict();
export type PlanningDecompositionProviderOutputV2 = z.infer<typeof PlanningDecompositionProviderOutputV2Schema>;

/** Historical flat v3 reader retained for persisted evidence and compatibility. */
export const PlanningDecompositionProviderOutputV3Schema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_DECOMPOSITION_HISTORICAL_CONTRACT_VERSION),
  complete: z.literal(true),
  elements: z.array(PlanningElementProposalSchema).min(1).max(256),
}).strict();
export type PlanningDecompositionProviderOutputV3 = z.infer<typeof PlanningDecompositionProviderOutputV3Schema>;

/** Historical bucketed v3 wire reader. It is never used for new requests. */
export function createHistoricalPlanningDecompositionProviderWireSchemaV3(minimum: DecompositionMinimumContract) {
  const contract = validateDecompositionMinimumContract(minimum);
  const shape: Record<string, z.ZodTypeAny> = {
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_DECOMPOSITION_HISTORICAL_CONTRACT_VERSION),
    complete: z.literal(true),
  };
  for (const domain of PLANNER_DECOMPOSITION_DOMAIN_ORDER) {
    const bucket = DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain];
    shape[bucket] = z.array(planningElementProposalSchemaForDomain(domain))
      .min(contract.minimumByDomain[domain])
      .max(256);
  }
  return z.object(shape).strict();
}
export type PlanningDecompositionProviderWireOutputV3 = z.infer<ReturnType<typeof createHistoricalPlanningDecompositionProviderWireSchemaV3>>;

/** Current normalized v4 representation after host-defined anchor flattening. */
export const PlanningDecompositionProviderOutputV4Schema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_DECOMPOSITION_CONTRACT_VERSION),
  complete: z.literal(true),
  elements: z.array(PlanningElementProposalSchema).min(1).max(256),
}).strict();
export type PlanningDecompositionProviderOutput = z.infer<typeof PlanningDecompositionProviderOutputV4Schema>;
export const PlanningDecompositionProviderOutputSchema = PlanningDecompositionProviderOutputV4Schema;

export const DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN = {
  FRONTEND: "frontendElements",
  BACKEND: "backendElements",
  DATABASE: "databaseElements",
  INTEGRATION: "integrationElements",
  QA: "qaElements",
  SECURITY: "securityElements",
  LIFECYCLE: "lifecycleElements",
} as const satisfies Record<PlannerCoverageDomain, string>;
export type DecompositionDomainBucket = typeof DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[PlannerCoverageDomain];
/** Stable flattening order preserves deterministic dependency indexes and PE identity. */
export const PLANNER_DECOMPOSITION_DOMAIN_ORDER = ["FRONTEND", "BACKEND", "DATABASE", "SECURITY", "INTEGRATION", "LIFECYCLE", "QA"] as const satisfies readonly PlannerCoverageDomain[];

function boundedEnum(values: readonly string[]) {
  return z.enum(values as [string, ...string[]]);
}

function anchorProposalSchema(anchor: CoverageRepresentabilityAnchor, plan: CoverageRepresentabilityPlan) {
  const obligation = plan.obligations.find((candidate) => candidate.obligationToken === anchor.obligationToken);
  if (!obligation) throw new Error("PLANNING_COVERAGE_REPRESENTABILITY_OBLIGATION_UNKNOWN");
  const pageTokens = obligation.allowedPageTokens.length > 0
    ? z.array(boundedEnum(obligation.allowedPageTokens)).max(32).nullable()
    : z.null();
  const routeTokens = obligation.allowedRouteTokens.length > 0
    ? z.array(boundedEnum(obligation.allowedRouteTokens)).max(32).nullable()
    : z.null();
  const variants = obligation.allowedDomains.flatMap((domain) => {
    const kinds = PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain].filter((kind) => obligation.allowedKinds.includes(kind));
    if (kinds.length === 0) return [];
    return [z.object({
      ...PlanningElementProposalFields,
      domain: z.literal(domain),
      kind: boundedEnum(kinds),
      pageTokens,
      routeTokens,
      negativeOnly: obligation.positiveRequirement ? z.literal(false).nullable() : z.boolean().nullable(),
      negativeEvidence: obligation.negativeEvidenceRequired ? z.literal(true) : z.boolean().nullable(),
    }).strict()];
  });
  if (variants.length === 0) throw new Error("PLANNING_COVERAGE_REPRESENTABILITY_ANCHOR_UNREPRESENTABLE");
  return z.union(variants as [typeof variants[number], ...typeof variants[number][]]).superRefine((value, context) => {
    const pages = value.pageTokens ?? [];
    const routes = value.routeTokens ?? [];
    if (obligation.requiredPageTokens.some((token) => !pages.includes(token)))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pageTokens"], message: "Anchor must bind every required host page token." });
    if (obligation.requiredRouteTokens.some((token) => !routes.includes(token)))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["routeTokens"], message: "Anchor must bind every required host route token." });
  });
}

/** Current v4 provider wire schema. Anchors are host-issued required keys. */
export function createPlanningDecompositionProviderWireSchema(
  minimum: DecompositionMinimumContract,
  representabilityPlan: CoverageRepresentabilityPlan,
) {
  const contract = validateDecompositionMinimumContract(minimum);
  const plan = CoverageRepresentabilityPlanSchema.parse(representabilityPlan);
  const shape: Record<string, z.ZodTypeAny> = {
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_DECOMPOSITION_CONTRACT_VERSION),
    complete: z.literal(true),
    anchors: z.object(Object.fromEntries(plan.anchors.map((anchor) => [anchor.anchorToken, anchorProposalSchema(anchor, plan)]))).strict(),
  };
  for (const domain of PLANNER_DECOMPOSITION_DOMAIN_ORDER) {
    const bucket = DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain];
    shape[bucket] = z.array(planningElementProposalSchemaForDomain(domain))
      .min(contract.minimumByDomain[domain])
      .max(256);
  }
  return z.object(shape).strict();
}

export type PlanningDecompositionProviderWireOutput = z.infer<ReturnType<typeof createPlanningDecompositionProviderWireSchema>>;

/** Flatten anchors first, then the stable free-domain bucket order. */
export function normalizePlanningDecompositionProviderOutput(
  value: unknown,
  minimum: DecompositionMinimumContract,
  representabilityPlan: CoverageRepresentabilityPlan,
): PlanningDecompositionProviderOutput {
  const plan = CoverageRepresentabilityPlanSchema.parse(representabilityPlan);
  const parsed = createPlanningDecompositionProviderWireSchema(minimum, plan).parse(value) as Record<DecompositionDomainBucket, PlanningElementProposal[]> & { anchors: Record<string, PlanningElementProposal>; schemaVersion: 1; providerContractVersion: typeof PLANNER_DECOMPOSITION_CONTRACT_VERSION; complete: true };
  const elements = [
    ...plan.anchors.map((anchor) => parsed.anchors[anchor.anchorToken]!),
    ...PLANNER_DECOMPOSITION_DOMAIN_ORDER.flatMap((domain) => parsed[DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain]]),
  ];
  return PlanningDecompositionProviderOutputV4Schema.parse({ schemaVersion: parsed.schemaVersion, providerContractVersion: parsed.providerContractVersion, complete: parsed.complete, elements });
}

export function normalizeHistoricalPlanningDecompositionProviderOutputV3(value: unknown, minimum: DecompositionMinimumContract): PlanningDecompositionProviderOutputV3 {
  const parsed = createHistoricalPlanningDecompositionProviderWireSchemaV3(minimum).parse(value) as Record<DecompositionDomainBucket, PlanningElementProposal[]> & { schemaVersion: 1; providerContractVersion: typeof PLANNER_DECOMPOSITION_HISTORICAL_CONTRACT_VERSION; complete: true };
  const elements = PLANNER_DECOMPOSITION_DOMAIN_ORDER.flatMap((domain) => parsed[DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain]]);
  return PlanningDecompositionProviderOutputV3Schema.parse({ schemaVersion: parsed.schemaVersion, providerContractVersion: parsed.providerContractVersion, complete: parsed.complete, elements });
}

export const PlanningElementSchema = z.object({
  elementId: z.string().regex(/^PE_\d{3}$/),
  kind: PlannerCoverageElementKindSchema,
  domain: PlannerCoverageDomainSchema,
  title: NonEmptyStringSchema.max(240),
  description: NonEmptyStringSchema.max(2000),
  pageTokens: z.array(PlannerPageToken).max(32),
  routeTokens: z.array(PlannerRouteToken).max(32),
  dependencies: z.array(z.string().regex(/^PE_\d{3}$/)).max(32),
  negativeEvidence: z.boolean(),
  negativeOnly: z.boolean(),
}).strict();
export type PlanningElement = z.infer<typeof PlanningElementSchema>;

/** Safe, bounded evidence for a rejected directed dependency cycle. */
export const PlanningGraphCycleEdgeSchema = z.object({
  fromPE: z.string().regex(/^PE_\d{3}$/),
  toPE: z.string().regex(/^PE_\d{3}$/),
  relationshipType: z.literal("DEPENDS_ON"),
  source: z.literal("PROVIDER_DECLARED"),
  fromDomain: PlannerCoverageDomainSchema,
  fromKind: PlannerCoverageElementKindSchema,
  toDomain: PlannerCoverageDomainSchema,
  toKind: PlannerCoverageElementKindSchema,
}).strict();
export type PlanningGraphCycleEdge = z.infer<typeof PlanningGraphCycleEdgeSchema>;

export const PlanningGraphCycleDiagnosticsSchema = z.object({
  cycleLength: z.number().int().min(1).max(256),
  cyclePeTokens: z.array(z.string().regex(/^PE_\d{3}$/)).min(1).max(256),
  cycleEdges: z.array(PlanningGraphCycleEdgeSchema).min(1).max(256),
}).strict().superRefine((value, context) => {
  if (value.cyclePeTokens.length !== value.cycleLength)
    context.addIssue({ code: "custom", path: ["cyclePeTokens"], message: "Cycle token count must equal cycleLength." });
  if (value.cycleEdges.length !== value.cycleLength)
    context.addIssue({ code: "custom", path: ["cycleEdges"], message: "Cycle edge count must equal cycleLength." });
});
export type PlanningGraphCycleDiagnostics = z.infer<typeof PlanningGraphCycleDiagnosticsSchema>;

export const PlanningElementGraphEdgeSchema = z.object({
  from: z.string().regex(/^PE_\d{3}$/),
  to: z.string().regex(/^PE_\d{3}$/),
  relation: z.literal("DEPENDS_ON"),
}).strict();
export type PlanningElementGraphEdge = z.infer<typeof PlanningElementGraphEdgeSchema>;

export const PlanningElementGraphSchema = z.object({
  schemaVersion: z.literal(1),
  elements: z.array(PlanningElementSchema).min(1).max(256),
  edges: z.array(PlanningElementGraphEdgeSchema).max(8192),
}).strict();
export type PlanningElementGraph = z.infer<typeof PlanningElementGraphSchema>;

/** Historical v1 value reader. New requests use the per-REQ v2 value below. */
export const PlanningCoverageValueV1Schema = z.object({
  planningElementIds: z.array(z.string().regex(/^PE_\d{3}$/)).min(1).max(32),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();

/** @deprecated Use the explicit v1 reader when inspecting retained evidence. */
export const PlanningCoverageValueSchema = PlanningCoverageValueV1Schema;

const PlanningCoverageValueV2Schema = z.object({
  planningElementIds: z.array(z.string().regex(/^PE_\d{3}$/)).min(1).max(32),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();

function planningCoverageWireValueSchema(targets: readonly string[], minimumCoverageTargets: number) {
  if (targets.length === 0) throw new Error("PLANNING_COVERAGE_NO_ADMISSIBLE_TARGETS");
  return z.object({
    /** Ordered, host-issued, requirement-local target aliases. */
    planningElementRefs: z.array(z.number().int().min(0).max(targets.length - 1)).min(minimumCoverageTargets).max(32),
    semanticEvidence: NonEmptyStringSchema.max(2000),
  }).strict();
}

/** Historical v1 wire reader; never use it for new staged provider requests. */
export function createPlanningCoverageProviderWireSchemaV1(table: PlannerReferenceTable) {
  const parsed = PlannerReferenceTableSchema.parse(table);
  const shape: Record<string, typeof PlanningCoverageValueV1Schema> = {};
  for (const requirement of parsed.requirements.filter((entry) => entry.mandatory))
    shape[requirement.token] = PlanningCoverageValueV1Schema;
  return z.object({
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_COVERAGE_LEGACY_CONTRACT_VERSION),
    complete: z.literal(true),
    coverageByRequirement: z.object(shape).strict(),
  }).strict();
}

/**
 * Current v2 wire schema. Every mandatory REQ property has its own closed PE
 * enum derived by the host from the current typed requirement constraints and
 * admitted PE metadata.
 */
export function createPlanningCoverageProviderWireSchema(
  table: PlannerReferenceTable,
  admissibleCoverageTargetsByRequirement: AdmissibleCoverageTargetsByRequirement,
) {
  const parsed = PlannerReferenceTableSchema.parse(table);
  const targets = AdmissibleCoverageTargetsByRequirementSchema.parse(admissibleCoverageTargetsByRequirement);
  const mandatory = parsed.requirements.filter((entry) => entry.mandatory);
  const mandatoryTokens = new Set(mandatory.map((entry) => entry.token));
  if (Object.keys(targets).some((token) => !mandatoryTokens.has(token)) || mandatory.some((entry) => !Object.hasOwn(targets, entry.token)))
    throw new Error("PLANNING_COVERAGE_TARGET_SET_INVALID");
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const requirement of mandatory)
    shape[requirement.token] = planningCoverageWireValueSchema(targets[requirement.token]!, requirement.coverageConstraints.minimumCoverageTargets);
  return z.object({
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_COVERAGE_CONTRACT_VERSION),
    complete: z.literal(true),
    coverageByRequirement: z.object(shape).strict(),
  }).strict();
}
export function createPlanningCoverageProviderOutputSchema(table: PlannerReferenceTable) {
  const parsed = PlannerReferenceTableSchema.parse(table);
  const shape: Record<string, typeof PlanningCoverageValueV2Schema> = {};
  for (const requirement of parsed.requirements.filter((entry) => entry.mandatory))
    shape[requirement.token] = PlanningCoverageValueV2Schema;
  return z.object({
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_COVERAGE_CONTRACT_VERSION),
    complete: z.literal(true),
    coverageByRequirement: z.object(shape).strict(),
  }).strict();
}
export type PlanningCoverageProviderOutput = z.infer<ReturnType<typeof createPlanningCoverageProviderOutputSchema>>;
export type PlanningCoverageProviderOutputV1 = z.infer<ReturnType<typeof createPlanningCoverageProviderWireSchemaV1>>;

export function normalizePlanningCoverageProviderOutput(
  value: unknown,
  table: PlannerReferenceTable,
  admissibleCoverageTargetsByRequirement: AdmissibleCoverageTargetsByRequirement,
): PlanningCoverageProviderOutput {
  const parsedTable = PlannerReferenceTableSchema.parse(table);
  const wire = createPlanningCoverageProviderWireSchema(parsedTable, admissibleCoverageTargetsByRequirement).parse(value);
  return createPlanningCoverageProviderOutputSchema(parsedTable).parse({
    ...wire,
    coverageByRequirement: Object.fromEntries((Object.entries(wire.coverageByRequirement) as Array<[string, { planningElementRefs: number[]; semanticEvidence: string }]>).map(([requirementToken, entry]) => {
      const targets = admissibleCoverageTargetsByRequirement[requirementToken]!;
      return [requirementToken, {
        planningElementIds: entry.planningElementRefs.map((reference) => targets[reference]!),
        semanticEvidence: entry.semanticEvidence,
      }];
    })),
  });
}

export type PlannerDecompositionProviderInput = {
  approvedBrief: RequirementSpecification;
  plannerReferenceTable: PlannerReferenceTable;
  canonicalBrief?: CanonicalBriefV3;
  minimumContract: DecompositionMinimumContract;
  coverageRepresentabilityPlan: CoverageRepresentabilityPlan;
};

export type PlannerCoverageProviderInput = {
  plannerReferenceTable: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  graph: PlanningElementGraph;
  admissibleCoverageTargetsByRequirement: AdmissibleCoverageTargetsByRequirement;
};
