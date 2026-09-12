import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DecompositionMinimumDiagnosticsSchema,
  DecompositionMinimumKindGroupSchema,
  type DecompositionMinimumContract,
  type DecompositionMinimumDiagnostics,
} from "./decomposition-minimum";
import {
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
  type PlannerCoverageDomain,
} from "./coverage-contract";
import type { PlanningDecompositionProviderOutput, PlanningElement } from "./staged-contracts";
import {
  CoverageRepresentabilityPlanSchema,
  type CoverageRepresentabilityPlan,
} from "./coverage-representability";
import type { PlannerReferenceTable } from "./reference-table";
import {
  ProviderTerminationMetadataSchema,
  type ProviderTerminationMetadata,
} from "@/integrations/openai/usage";

export const PLANNING_ADMISSION_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export const PlanningAdmissionStageSchema = z.enum([
  "PREFLIGHT",
  "DECOMPOSITION_PROVIDER",
  "DECOMPOSITION_PARSE",
  "DECOMPOSITION_ADMISSION",
  "DECOMPOSITION_REPRESENTABILITY",
  "PE_ASSIGNMENT",
  "GRAPH_ASSEMBLY",
  "GRAPH_ADMISSION",
  "COVERAGE_PROVIDER",
  "COVERAGE_PARSE",
  "COVERAGE_ADMISSION",
  "FINAL_ASSEMBLY",
  "FINAL_ADMISSION",
  "PERSISTENCE",
  "LIFECYCLE_TRANSITION",
]);
export type PlanningAdmissionStage = z.infer<typeof PlanningAdmissionStageSchema>;

export const PlanningAdmissionFailurePredicateSchema = z.enum([
  "MISSING_PRODUCT_SCOPE",
  "MISSING_PAGE_ROUTE",
  "PAGE_ROUTE_BINDING_MISSING",
  "INSUFFICIENT_FRONTEND_ELEMENTS",
  "INSUFFICIENT_BACKEND_ELEMENTS",
  "INSUFFICIENT_DATABASE_ELEMENTS",
  "INSUFFICIENT_SECURITY_ELEMENTS",
  "INSUFFICIENT_INTEGRATION_ELEMENTS",
  "INSUFFICIENT_LIFECYCLE_ELEMENTS",
  "INSUFFICIENT_QA_ELEMENTS",
  "MISSING_REQUIRED_KIND",
  "MISSING_REQUIRED_DOMAIN",
  "INSUFFICIENT_TOTAL_ELEMENTS",
]);
export type PlanningAdmissionFailurePredicate = z.infer<typeof PlanningAdmissionFailurePredicateSchema>;

const SafeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/).max(120);
const SafeOperationIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/);
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

const RequiredStructuralPredicatesSchema = z.object({
  requiredDomains: z.array(PlannerCoverageDomainSchema).max(7),
  requiredKinds: z.array(PlannerCoverageElementKindSchema).max(21),
  requiredKindGroups: z.array(DecompositionMinimumKindGroupSchema).max(4),
  pageOrRouteBindingRequired: z.boolean(),
}).strict();

const StageEvidenceSchema = z.object({
  graphStageReached: z.boolean(),
  representabilityStageReached: z.boolean(),
  coverageStageReached: z.boolean(),
  traceabilityStageReached: z.boolean(),
}).strict();

export const PlanningAdmissionDiagnosticEnvelopeSchema = z.object({
  schemaVersion: z.literal(PLANNING_ADMISSION_DIAGNOSTIC_SCHEMA_VERSION),
  projectId: z.string().uuid(),
  operationId: SafeOperationIdSchema,
  correlationId: z.string().uuid(),
  timestamp: z.string().datetime(),
  planningContractVersion: z.string().min(1).max(100),
  minimumContractVersion: z.string().min(1).max(100),
  stage: PlanningAdmissionStageSchema,
  failureCode: SafeCodeSchema,
  failureReasonCode: SafeCodeSchema.optional(),
  failurePredicate: PlanningAdmissionFailurePredicateSchema,
  providerTermination: ProviderTerminationMetadataSchema,
  parsedElementCount: z.number().int().nonnegative().max(256),
  normalizedElementCount: z.number().int().nonnegative().max(256),
  actualCountByDomain: DecompositionMinimumDiagnosticsSchema.shape.actualCountByDomain,
  minimumCountByDomain: DecompositionMinimumDiagnosticsSchema.shape.minimumCountByDomain,
  actualCountByKind: DecompositionMinimumDiagnosticsSchema.shape.actualCountByKind,
  minimumCountByKind: DecompositionMinimumDiagnosticsSchema.shape.minimumCountByKind,
  requiredStructuralPredicates: RequiredStructuralPredicatesSchema,
  productScopePresent: z.boolean(),
  pageOrRoutePresent: z.boolean(),
  pageRouteBindingCount: z.number().int().nonnegative().max(256),
  unboundPageRouteCount: z.number().int().nonnegative().max(256),
  hostIssuedAnchorCount: z.number().int().nonnegative().max(256),
  hostIssuedAnchorCoverageCount: z.number().int().nonnegative().max(256),
  duplicateElementFindings: z.number().int().nonnegative().max(256),
  schemaInvalidCount: z.number().int().nonnegative().max(256),
  stageEvidence: StageEvidenceSchema,
  providerPackageChecksum: ChecksumSchema,
  normalizedPackageChecksum: ChecksumSchema,
}).strict();
export type PlanningAdmissionDiagnosticEnvelope = z.infer<typeof PlanningAdmissionDiagnosticEnvelopeSchema>;

export type PlanningAdmissionEvidence = {
  planningContractVersion: string;
  minimumContractVersion: string;
  failureCode: string;
  failureReasonCode?: string;
  failurePredicate: PlanningAdmissionFailurePredicate;
  parsedElementCount: number;
  normalizedElementCount: number;
  actualCountByDomain: DecompositionMinimumDiagnostics["actualCountByDomain"];
  minimumCountByDomain: DecompositionMinimumDiagnostics["minimumCountByDomain"];
  actualCountByKind: DecompositionMinimumDiagnostics["actualCountByKind"];
  minimumCountByKind: DecompositionMinimumDiagnostics["minimumCountByKind"];
  requiredStructuralPredicates: z.infer<typeof RequiredStructuralPredicatesSchema>;
  productScopePresent: boolean;
  pageOrRoutePresent: boolean;
  pageRouteBindingCount: number;
  unboundPageRouteCount: number;
  hostIssuedAnchorCount: number;
  hostIssuedAnchorCoverageCount: number;
  duplicateElementFindings: number;
  schemaInvalidCount: number;
  providerPackageChecksum: string;
  normalizedPackageChecksum: string;
};

const domainPredicate: Record<PlannerCoverageDomain, PlanningAdmissionFailurePredicate> = {
  FRONTEND: "INSUFFICIENT_FRONTEND_ELEMENTS",
  BACKEND: "INSUFFICIENT_BACKEND_ELEMENTS",
  DATABASE: "INSUFFICIENT_DATABASE_ELEMENTS",
  SECURITY: "INSUFFICIENT_SECURITY_ELEMENTS",
  INTEGRATION: "INSUFFICIENT_INTEGRATION_ELEMENTS",
  LIFECYCLE: "INSUFFICIENT_LIFECYCLE_ELEMENTS",
  QA: "INSUFFICIENT_QA_ELEMENTS",
};

export function planningAdmissionFailurePredicate(input: {
  diagnostics: DecompositionMinimumDiagnostics;
  contract: DecompositionMinimumContract;
  hasPageOrRoute: boolean;
  hasRequiredPageOrRouteBinding: boolean;
}): PlanningAdmissionFailurePredicate {
  const insufficientDomain = input.contract.requiredDomains.find((domain) => input.diagnostics.actualCountByDomain[domain] < input.contract.minimumByDomain[domain]);
  if (insufficientDomain) return domainPredicate[insufficientDomain];
  if (input.diagnostics.missingRequiredKinds.includes("PRODUCT_SCOPE")) return "MISSING_PRODUCT_SCOPE";
  if (!input.hasPageOrRoute) return "MISSING_PAGE_ROUTE";
  if (!input.hasRequiredPageOrRouteBinding) return "PAGE_ROUTE_BINDING_MISSING";
  if (input.diagnostics.missingRequiredKinds.length > 0) return "MISSING_REQUIRED_KIND";
  if (input.diagnostics.missingRequiredDomains.length > 0) return "MISSING_REQUIRED_DOMAIN";
  return "INSUFFICIENT_TOTAL_ELEMENTS";
}

function pageRouteBinding(proposal: { pageTokens: string[] | null; routeTokens: string[] | null }, table: PlannerReferenceTable) {
  const pages = new Set(table.pages.map((entry) => entry.token));
  const routes = new Set(table.routes.map((entry) => entry.token));
  return (proposal.pageTokens ?? []).some((token) => pages.has(token)) || (proposal.routeTokens ?? []).some((token) => routes.has(token));
}

export function createPlanningAdmissionEvidence(input: {
  parsed: PlanningDecompositionProviderOutput;
  elements: readonly PlanningElement[];
  table: PlannerReferenceTable;
  minimumContract: DecompositionMinimumContract;
  representabilityPlan?: CoverageRepresentabilityPlan;
  hasRequiredPageOrRouteBinding: boolean;
  failureCode: string;
  failureReasonCode?: string;
  minimumDiagnostics: DecompositionMinimumDiagnostics;
}): PlanningAdmissionEvidence {
  const plan = input.representabilityPlan ? CoverageRepresentabilityPlanSchema.parse(input.representabilityPlan) : undefined;
  const pageOrRouteProposals = input.parsed.elements.filter((proposal) => proposal.kind === "PAGE" || proposal.kind === "ROUTE");
  return {
    planningContractVersion: input.parsed.providerContractVersion,
    minimumContractVersion: input.minimumContract.contractVersion,
    failureCode: SafeCodeSchema.parse(input.failureCode),
    ...(input.failureReasonCode ? { failureReasonCode: SafeCodeSchema.parse(input.failureReasonCode) } : {}),
    failurePredicate: planningAdmissionFailurePredicate({ diagnostics: input.minimumDiagnostics, contract: input.minimumContract, hasPageOrRoute: input.parsed.elements.some((proposal) => proposal.kind === "PAGE" || proposal.kind === "ROUTE"), hasRequiredPageOrRouteBinding: input.hasRequiredPageOrRouteBinding }),
    parsedElementCount: input.parsed.elements.length,
    normalizedElementCount: input.elements.length,
    actualCountByDomain: input.minimumDiagnostics.actualCountByDomain,
    minimumCountByDomain: input.minimumDiagnostics.minimumCountByDomain,
    actualCountByKind: input.minimumDiagnostics.actualCountByKind,
    minimumCountByKind: input.minimumDiagnostics.minimumCountByKind,
    requiredStructuralPredicates: {
      requiredDomains: input.minimumContract.requiredDomains,
      requiredKinds: input.minimumContract.requiredKinds,
      requiredKindGroups: input.minimumContract.requiredKindGroups,
      pageOrRouteBindingRequired: true,
    },
    productScopePresent: input.minimumDiagnostics.actualCountByKind.PRODUCT_SCOPE > 0,
    pageOrRoutePresent: input.parsed.elements.some((proposal) => proposal.kind === "PAGE" || proposal.kind === "ROUTE"),
    pageRouteBindingCount: pageOrRouteProposals.filter((proposal) => pageRouteBinding(proposal, input.table)).length,
    unboundPageRouteCount: pageOrRouteProposals.filter((proposal) => !pageRouteBinding(proposal, input.table)).length,
    hostIssuedAnchorCount: plan?.anchors.length ?? 0,
    hostIssuedAnchorCoverageCount: plan ? Math.min(plan.anchors.length, input.parsed.elements.length) : 0,
    duplicateElementFindings: 0,
    schemaInvalidCount: 0,
    providerPackageChecksum: checksumPersistedDocument(input.parsed),
    normalizedPackageChecksum: checksumPersistedDocument(input.elements),
  };
}

function stageEvidence(stage: PlanningAdmissionStage): z.infer<typeof StageEvidenceSchema> {
  const stages = PlanningAdmissionStageSchema.options;
  const index = stages.indexOf(stage);
  const reached = (...names: PlanningAdmissionStage[]) => names.some((name) => index >= stages.indexOf(name));
  return {
    graphStageReached: reached("PE_ASSIGNMENT"),
    representabilityStageReached: reached("DECOMPOSITION_REPRESENTABILITY"),
    coverageStageReached: reached("COVERAGE_PROVIDER"),
    traceabilityStageReached: reached("FINAL_ASSEMBLY"),
  };
}

export function createPlanningAdmissionDiagnosticEnvelope(input: {
  evidence: PlanningAdmissionEvidence;
  projectId: string;
  operationId: string;
  correlationId: string;
  stage: PlanningAdmissionStage;
  providerTermination?: ProviderTerminationMetadata;
  timestamp?: string;
}): PlanningAdmissionDiagnosticEnvelope {
  return PlanningAdmissionDiagnosticEnvelopeSchema.parse({
    schemaVersion: PLANNING_ADMISSION_DIAGNOSTIC_SCHEMA_VERSION,
    projectId: input.projectId,
    operationId: input.operationId,
    correlationId: input.correlationId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input.evidence,
    providerTermination: input.providerTermination ?? ProviderTerminationMetadataSchema.parse({
      schemaVersion: 1,
      transportStatus: "RESPONSE_RECEIVED",
      parseStatus: "PASSED",
      requestAttempted: true,
      responseReceived: true,
      finishReason: null,
      outputComplete: true,
      tokenExhaustion: false,
      parsedPresent: true,
      jsonParseSucceeded: true,
      schemaName: null,
      rawResponseRetained: false,
    }),
    stage: input.stage,
    stageEvidence: stageEvidence(input.stage),
  });
}
