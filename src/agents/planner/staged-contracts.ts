import { z } from "zod";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";
import {
  PLANNER_ELEMENT_KINDS_BY_DOMAIN,
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
  type PlannerCoverageDomain,
  type PlannerCoverageElementKind,
} from "./coverage-contract";
import {
  PlannerPageToken,
  PlannerReferenceTableSchema,
  PlannerRouteToken,
  type PlannerReferenceTable,
} from "./reference-table";

/**
 * Stage contracts are provider proposals, not canonical Planning documents.
 * The decomposition provider never receives or returns a requirement
 * coverage object and never owns a globally referenced Planning identity.
 */
export const PLANNER_DECOMPOSITION_LEGACY_CONTRACT_VERSION = "planner.decomposition.v1" as const;
export const PLANNER_DECOMPOSITION_CONTRACT_VERSION = "planner.decomposition.v2" as const;
export const PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME = "planning-decomposition-v2" as const;
export const PLANNER_COVERAGE_CONTRACT_VERSION = "planner.coverage.v1" as const;
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

const PlanningElementProposalVariants = PlannerCoverageDomainSchema.options.map((domain) => z.object({
  ...PlanningElementProposalFields,
  domain: z.literal(domain),
  kind: kindEnumForDomain(domain),
}).strict());

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

export const PlanningDecompositionProviderOutputSchema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_DECOMPOSITION_CONTRACT_VERSION),
  complete: z.literal(true),
  elements: z.array(PlanningElementProposalSchema).min(1).max(256),
}).strict();
export type PlanningDecompositionProviderOutput = z.infer<typeof PlanningDecompositionProviderOutputSchema>;

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

export const PlanningCoverageValueSchema = z.object({
  planningElementIds: z.array(z.string().regex(/^PE_\d{3}$/)).min(1).max(32),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();

export function createPlanningCoverageProviderWireSchema(table: PlannerReferenceTable) {
  const parsed = PlannerReferenceTableSchema.parse(table);
  const shape: Record<string, typeof PlanningCoverageValueSchema> = {};
  for (const requirement of parsed.requirements.filter((entry) => entry.mandatory))
    shape[requirement.token] = PlanningCoverageValueSchema;
  return z.object({
    schemaVersion: z.literal(1),
    providerContractVersion: z.literal(PLANNER_COVERAGE_CONTRACT_VERSION),
    complete: z.literal(true),
    coverageByRequirement: z.object(shape).strict(),
  }).strict();
}
export type PlanningCoverageProviderOutput = z.infer<ReturnType<typeof createPlanningCoverageProviderWireSchema>>;

export type PlannerDecompositionProviderInput = {
  approvedBrief: RequirementSpecification;
  plannerReferenceTable: PlannerReferenceTable;
  canonicalBrief?: CanonicalBriefV3;
  requiredDomains: readonly PlannerCoverageDomain[];
};

export type PlannerCoverageProviderInput = {
  plannerReferenceTable: PlannerReferenceTable;
  elements: readonly PlanningElement[];
  graph: PlanningElementGraph;
};
