import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { stableValue } from "@/persistence/database/serialization";

const SafeTextSchema = z.string().min(1).max(1000);
export const SafeIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeFingerprintSchema = z.string().min(1).max(256);
const RepoPathSchema = z.string().min(1).max(300).regex(/^(?![A-Za-z]:[\\/])(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*\\.git(?:[\\/]|$))(?!.*(?:^|[\\/])node_modules(?:[\\/]|$))(?!.*(?:^|[\\/])\.next(?:[\\/]|$)).+$/);
const AbsoluteWorkspacePathSchema = z.string().min(1).max(1000).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/).refine((value) => !value.includes("\0") && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value), "Workspace path must remain contained.");
const WorkspacePathSchema = z.union([RepoPathSchema, AbsoluteWorkspacePathSchema]);
const IsoDateTimeSchema = z.string().datetime();

export const REPAIR_POLICY_VERSION = "safe-repair-v1";
export const REPAIR_STATUS_MACHINE_VERSION = "safe-repair-status-v1";

export const RepairSourceSchema = z.enum(["WORKBENCH", "PROVIDER", "BUILD", "TEST", "RUNTIME", "PERSISTENCE", "CONTRACT", "MANUAL"]);
export const RepairRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RepairRisk = z.infer<typeof RepairRiskSchema>;
export const RepairStatusSchema = z.enum(["INCIDENT_CAPTURED", "DIAGNOSING", "IMPACT_ANALYZED", "READY_FOR_REPAIR", "REPAIRING", "VERIFYING", "REVIEW_BLOCKED", "READY_FOR_INTEGRATION", "INTEGRATED", "NO_SOURCE_REPAIR_REQUIRED", "REJECTED", "STALE"]);
export const RepairNodeTypeSchema = z.enum(["FILE", "SYMBOL", "MODULE", "PUBLIC_EXPORT", "TYPE_CONTRACT", "PROVIDER_CONTRACT", "WORKBENCH_ACTION", "LIFECYCLE_STATE", "PERSISTENCE_ENTITY", "DATABASE_SCHEMA", "RLS_POLICY", "ROUTE", "RUNTIME_BOUNDARY", "TEST", "PROTECTED_ARTIFACT", "SPECIALIST_OWNERSHIP", "REGRESSION"]);
export const RepairEdgeTypeSchema = z.enum(["IMPORTS", "RE_EXPORTS", "CALLS", "IMPLEMENTS", "VALIDATES", "PERSISTS", "TRANSITIONS_TO", "USES_CONTRACT", "OWNS", "PROTECTS", "TESTS", "DEPENDS_ON"]);
export const RepairEvidenceSourceSchema = z.enum(["TYPESCRIPT_AST", "PUBLIC_EXPORTS", "WORKBENCH_REGISTRY", "LIFECYCLE_AUTHORITY", "PROVIDER_REGISTRY", "ROUTE_MANIFEST", "ZOD_SCHEMA", "PERSISTENCE_ADAPTER", "DATABASE_METADATA", "TEST_REGISTRY", "SPECIALIST_REGISTRY", "REGRESSION_LEDGER", "HOST"]);

export const RepairIncidentSchema = z.object({
  incidentId: SafeIdSchema,
  source: RepairSourceSchema,
  failureClass: SafeTextSchema,
  stage: SafeTextSchema,
  boundary: SafeTextSchema,
  outerCode: SafeTextSchema,
  reasonCode: SafeTextSchema.optional(),
  safeFingerprint: SafeFingerprintSchema,
  safeTokens: z.array(SafeTextSchema).max(20).default([]),
  affectedProject: z.object({ projectId: z.string().uuid(), projectVersion: z.number().int().positive().optional() }).strict().optional(),
  observedAt: IsoDateTimeSchema,
  evidenceRefs: z.array(RepoPathSchema.or(SafeIdSchema)).max(50).default([]),
}).strict();
export type RepairIncident = z.infer<typeof RepairIncidentSchema>;

export const RepairInvariantSchema = z.object({ id: SafeIdSchema, description: SafeTextSchema, kind: z.enum(["TARGET", "PRESERVE", "SECURITY", "CURRENTNESS", "PERFORMANCE", "BOUNDARY"]) }).strict();
export type RepairInvariant = z.infer<typeof RepairInvariantSchema>;

export const RepairScopeSchema = z.object({ allowedPaths: z.array(RepoPathSchema).min(1).max(200), forbiddenPaths: z.array(RepoPathSchema).max(200), allowedSymbols: z.array(SafeIdSchema).max(200).optional() }).strict();
export type RepairScope = z.infer<typeof RepairScopeSchema>;

export const ChangeBudgetSchema = z.object({
  maxFilesChanged: z.number().int().positive(),
  maxLinesChanged: z.number().int().positive().optional(),
  allowedPaths: z.array(RepoPathSchema).min(1).max(200),
  forbiddenPaths: z.array(RepoPathSchema).max(200),
  allowedSymbols: z.array(SafeIdSchema).max(200).optional(),
  maxPublicContractChanges: z.number().int().nonnegative(),
  migrationAllowed: z.boolean(),
  schemaChangeAllowed: z.boolean(),
  lifecycleChangeAllowed: z.boolean(),
  providerContractChangeAllowed: z.boolean(),
  testModificationPolicy: z.enum(["NO_EXISTING_TEST_CHANGES", "ADD_REGRESSION_ONLY", "AUTHORIZED_CONTRACT_MIGRATION"]),
  dependencyExpansionAllowed: z.boolean(),
}).strict();
export type ChangeBudget = z.infer<typeof ChangeBudgetSchema>;

export const ContractChangeIntentSchema = z.object({ contract: SafeIdSchema, oldBehavior: SafeTextSchema, intendedBehavior: SafeTextSchema, consumers: z.array(SafeIdSchema).min(1).max(100), compatibilityStrategy: SafeTextSchema }).strict();
export type ContractChangeIntent = z.infer<typeof ContractChangeIntentSchema>;

export const VerificationRequirementSchema = z.object({ id: SafeIdSchema, tier: z.enum(["L1_TARGET", "L2_IMPACT", "L3_INTEGRATION"]), reason: SafeTextSchema, mandatory: z.boolean() }).strict();
export type VerificationRequirement = z.infer<typeof VerificationRequirementSchema>;

export const RepairIntentSchema = z.object({
  incidentId: SafeIdSchema,
  rootCauseClassification: SafeTextSchema,
  targetBehavior: z.array(RepairInvariantSchema).min(1).max(50),
  allowedScope: RepairScopeSchema,
  forbiddenScope: RepairScopeSchema,
  mustPreserve: z.array(RepairInvariantSchema).min(1).max(100),
  changeBudget: ChangeBudgetSchema,
  requiredVerification: z.array(VerificationRequirementSchema).min(1).max(100),
  risk: RepairRiskSchema,
  contractChangeIntent: ContractChangeIntentSchema.optional(),
}).strict();
export type RepairIntent = z.infer<typeof RepairIntentSchema>;

export const FailureSnapshotSchema = z.object({
  identity: SafeIdSchema,
  subsystem: SafeIdSchema,
  testRef: SafeIdSchema.optional(),
  code: SafeTextSchema,
  fingerprint: SafeFingerprintSchema,
  detailToken: SafeTextSchema.optional(),
}).strict();
export type FailureSnapshot = z.infer<typeof FailureSnapshotSchema>;

export const GateStatusSchema = z.object({ status: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]), fingerprint: SafeFingerprintSchema.optional() }).strict();
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const ProtectedProjectFingerprintSchema = z.object({ projectId: z.string().uuid(), field: SafeIdSchema, fingerprint: SafeFingerprintSchema }).strict();
export type ProtectedProjectFingerprint = z.infer<typeof ProtectedProjectFingerprintSchema>;

export const RepairBaselineSchema = z.object({
  sourceHead: SafeIdSchema,
  sourceTreeChecksum: HashSchema.optional(),
  contractFingerprints: z.record(z.string(), SafeFingerprintSchema),
  testFailureFingerprints: z.array(FailureSnapshotSchema),
  buildStatus: GateStatusSchema,
  lintStatus: GateStatusSchema,
  typecheckStatus: GateStatusSchema,
  protectedProjectFingerprints: z.array(ProtectedProjectFingerprintSchema),
  risk: RepairRiskSchema,
  providerContractFingerprints: z.record(z.string(), SafeFingerprintSchema).optional(),
  lifecycleActionFingerprints: z.record(z.string(), SafeFingerprintSchema).optional(),
  databaseFingerprint: SafeFingerprintSchema.optional(),
  routeFingerprint: SafeFingerprintSchema.optional(),
  persistenceFingerprint: SafeFingerprintSchema.optional(),
  capturedAt: IsoDateTimeSchema,
}).strict();
export type RepairBaseline = z.infer<typeof RepairBaselineSchema>;

export const ImpactNodeSchema = z.object({
  nodeId: SafeIdSchema,
  type: RepairNodeTypeSchema,
  label: SafeTextSchema,
  path: RepoPathSchema.optional(),
  source: RepairEvidenceSourceSchema,
  protected: z.boolean().default(false),
}).strict();
export type ImpactNode = z.infer<typeof ImpactNodeSchema>;

export const ImpactEdgeSchema = z.object({
  edgeId: SafeIdSchema,
  from: SafeIdSchema,
  to: SafeIdSchema,
  type: RepairEdgeTypeSchema,
  source: RepairEvidenceSourceSchema,
  evidenceRefs: z.array(SafeIdSchema).max(20).default([]),
}).strict();
export type ImpactEdge = z.infer<typeof ImpactEdgeSchema>;

export const ChangeImpactGraphSchema = z.object({
  graphId: SafeIdSchema,
  sourceHead: SafeIdSchema,
  changedFiles: z.array(RepoPathSchema).max(200),
  nodes: z.array(ImpactNodeSchema).max(5000),
  edges: z.array(ImpactEdgeSchema).max(10000),
  directNodeIds: z.array(SafeIdSchema).max(5000),
  transitiveNodeIds: z.array(SafeIdSchema).max(5000),
  mandatoryRegressionIds: z.array(SafeIdSchema).max(500),
  maxDepth: z.number().int().nonnegative(),
  bounded: z.boolean(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  checksum: HashSchema,
}).strict();
export type ChangeImpactGraph = z.infer<typeof ChangeImpactGraphSchema>;

export const RepairWorkspaceIdentitySchema = z.object({
  workspaceId: SafeIdSchema,
  repairId: SafeIdSchema,
  sourceHead: SafeIdSchema,
  path: WorkspacePathSchema,
  candidateChecksum: HashSchema.optional(),
  actualChangedFiles: z.array(RepoPathSchema).max(200).default([]),
  createdAt: IsoDateTimeSchema,
}).strict();
export type RepairWorkspaceIdentity = z.infer<typeof RepairWorkspaceIdentitySchema>;

export const RepairTestMutationSchema = z.object({ path: RepoPathSchema, kind: z.enum(["ADDED", "MODIFIED", "DELETED"]), removedAssertions: z.number().int().nonnegative(), changedExpectations: z.number().int().nonnegative(), addedSkips: z.number().int().nonnegative(), addedOnly: z.number().int().nonnegative(), timeoutIncreaseMs: z.number().int().nonnegative(), fixtureBypass: z.boolean() }).strict();
export type RepairTestMutation = z.infer<typeof RepairTestMutationSchema>;
export const TestMutationReportSchema = z.object({ changedExistingTests: z.array(RepairTestMutationSchema), addedTests: z.array(RepairTestMutationSchema), suspicious: z.array(SafeIdSchema), passed: z.boolean() }).strict();
export type TestMutationReport = z.infer<typeof TestMutationReportSchema>;

export const RepairTargetProofSchema = z.object({ mode: z.enum(["EXACT_REPLAY", "HISTORICAL_EXACT_REPLAY_UNAVAILABLE"]), before: z.literal("FAIL"), after: z.literal("PASS"), evidenceRef: SafeIdSchema }).strict();
export type RepairTargetProof = z.infer<typeof RepairTargetProofSchema>;

export const ProtectedStateDifferenceSchema = z.object({ projectId: z.string().uuid(), field: SafeIdSchema, before: SafeFingerprintSchema.optional(), after: SafeFingerprintSchema.optional() }).strict();
export type ProtectedStateDifference = z.infer<typeof ProtectedStateDifferenceSchema>;
export const ProtectedStateDeltaReportSchema = z.object({ differences: z.array(ProtectedStateDifferenceSchema), passed: z.boolean() }).strict();
export type ProtectedStateDeltaReport = z.infer<typeof ProtectedStateDeltaReportSchema>;
export const RepairOwnershipCheckSchema = z.object({ passed: z.boolean(), reasons: z.array(SafeTextSchema).max(50) }).strict();
export type RepairOwnershipCheck = z.infer<typeof RepairOwnershipCheckSchema>;

export const ImpactGraphMeasurementSchema = z.object({ buildDurationMs: z.number().nonnegative(), nodeCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative(), traversedNodeCount: z.number().int().nonnegative(), bounded: z.boolean(), cacheKey: SafeIdSchema.optional() }).strict();
export type ImpactGraphMeasurement = z.infer<typeof ImpactGraphMeasurementSchema>;

export const RepairProposalSchema = z.object({
  proposalId: SafeIdSchema,
  repairId: SafeIdSchema,
  workspaceId: SafeIdSchema,
  sourceHead: SafeIdSchema,
  actualChangedFiles: z.array(RepoPathSchema).max(200),
  changedLines: z.number().int().nonnegative(),
  diffChecksum: HashSchema,
  targetProof: RepairTargetProofSchema,
  targetPassed: z.boolean(),
  impactChecksPassed: z.boolean(),
  candidateFailures: z.array(FailureSnapshotSchema),
  candidateContracts: z.record(z.string(), SafeFingerprintSchema),
  candidateTests: z.array(RepairTestMutationSchema),
  protectedProjectFingerprints: z.array(ProtectedProjectFingerprintSchema),
  providerCalls: z.number().int().nonnegative(),
  verificationGates: z.record(z.string(), GateStatusSchema).default({}),
  specialistId: SafeIdSchema,
  ownershipHandoff: z.object({ ownerId: SafeIdSchema, approved: z.boolean() }).strict().optional(),
  canonicalWriteAttempted: z.boolean(),
  suspiciousPatterns: z.array(SafeTextSchema).max(50).default([]),
  createdAt: IsoDateTimeSchema,
}).strict();
export type RepairProposal = z.infer<typeof RepairProposalSchema>;

/** Host-produced verification; specialist-reported evidence is never authoritative. */
export const RepairVerificationResultSchema = z.object({
  actualChangedFiles: z.array(RepoPathSchema).max(200),
  changedLines: z.number().int().nonnegative(),
  diffChecksum: HashSchema,
  targetProof: RepairTargetProofSchema,
  targetPassed: z.boolean(),
  impactChecksPassed: z.boolean(),
  candidateFailures: z.array(FailureSnapshotSchema),
  candidateContracts: z.record(z.string(), SafeFingerprintSchema),
  candidateTests: z.array(RepairTestMutationSchema),
  protectedProjectFingerprints: z.array(ProtectedProjectFingerprintSchema),
  providerCalls: z.number().int().nonnegative(),
  canonicalWriteAttempted: z.boolean(),
  suspiciousPatterns: z.array(SafeTextSchema).max(50),
  verificationGates: z.record(z.string(), GateStatusSchema),
}).strict();
export type RepairVerificationResult = z.infer<typeof RepairVerificationResultSchema>;

export const ContractDeltaEntrySchema = z.object({ surface: SafeIdSchema, contractId: SafeIdSchema, before: SafeFingerprintSchema.optional(), after: SafeFingerprintSchema.optional(), classification: z.enum(["EXPECTED", "AUTHORIZED", "UNEXPECTED"]) }).strict();
export type ContractDeltaEntry = z.infer<typeof ContractDeltaEntrySchema>;
export const ContractDeltaReportSchema = z.object({ entries: z.array(ContractDeltaEntrySchema), unexpectedCount: z.number().int().nonnegative(), authorizedCount: z.number().int().nonnegative(), expectedCount: z.number().int().nonnegative(), passed: z.boolean() }).strict();
export type ContractDeltaReport = z.infer<typeof ContractDeltaReportSchema>;

export const FailureDeltaEntrySchema = z.object({ identity: SafeIdSchema, classification: z.enum(["NEW_FAILURE", "CHANGED_FAILURE", "UNCHANGED_BASELINE_FAILURE", "RESOLVED_BASELINE_FAILURE"]), baselineFingerprint: SafeFingerprintSchema.optional(), candidateFingerprint: SafeFingerprintSchema.optional() }).strict();
export type FailureDeltaEntry = z.infer<typeof FailureDeltaEntrySchema>;
export const RegressionDeltaReportSchema = z.object({ entries: z.array(FailureDeltaEntrySchema), baselineFailures: z.array(FailureSnapshotSchema), resolvedFailures: z.array(FailureSnapshotSchema), unchangedFailures: z.array(FailureSnapshotSchema), newFailures: z.array(FailureSnapshotSchema), changedFailures: z.array(FailureSnapshotSchema), passed: z.boolean() }).strict();
export type RegressionDeltaReport = z.infer<typeof RegressionDeltaReportSchema>;

export const RepairReviewFindingSchema = z.object({ code: SafeIdSchema, severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), evidence: SafeTextSchema, recommendation: SafeTextSchema }).strict();
export type RepairReviewFinding = z.infer<typeof RepairReviewFindingSchema>;
export const RepairReviewSchema = z.object({ decision: z.enum(["PASS", "BLOCK"]), findings: z.array(RepairReviewFindingSchema), checkedAt: IsoDateTimeSchema }).strict();
export type RepairReview = z.infer<typeof RepairReviewSchema>;

export const RepairIntegrationDecisionSchema = z.object({ decision: z.enum(["ALLOW", "BLOCK"]), reason: SafeIdSchema, reasons: z.array(SafeTextSchema).max(50), decidedAt: IsoDateTimeSchema }).strict();
export type RepairIntegrationDecision = z.infer<typeof RepairIntegrationDecisionSchema>;

export const RegressionLedgerEntrySchema = z.object({
  regressionId: SafeIdSchema,
  safeFingerprint: SafeFingerprintSchema,
  subsystem: SafeIdSchema,
  rootCauseClass: SafeIdSchema,
  protectingInvariant: SafeIdSchema,
  regressionTestRefs: z.array(SafeIdSchema).min(1).max(100),
  affectedContracts: z.array(SafeIdSchema).max(100),
  affectedRuntimeBoundaries: z.array(SafeIdSchema).max(100),
  status: z.enum(["ACTIVE", "RESOLVED", "RETIRED"]),
  introducedAt: IsoDateTimeSchema.optional(),
  fixedAt: IsoDateTimeSchema.optional(),
}).strict();
export type RegressionLedgerEntry = z.infer<typeof RegressionLedgerEntrySchema>;

export const RepairTransactionSchema = z.object({
  repairId: SafeIdSchema,
  incident: RepairIncidentSchema,
  baseline: RepairBaselineSchema.optional(),
  intent: RepairIntentSchema.optional(),
  impact: ChangeImpactGraphSchema.optional(),
  workspace: RepairWorkspaceIdentitySchema.optional(),
  proposal: RepairProposalSchema.optional(),
  verification: RepairVerificationResultSchema.optional(),
  contractDelta: ContractDeltaReportSchema.optional(),
  regressionDelta: RegressionDeltaReportSchema.optional(),
  testMutation: TestMutationReportSchema.optional(),
  protectedStateDelta: ProtectedStateDeltaReportSchema.optional(),
  ownership: RepairOwnershipCheckSchema.optional(),
  adversarialReview: RepairReviewSchema.optional(),
  integrationDecision: RepairIntegrationDecisionSchema.optional(),
  performance: ImpactGraphMeasurementSchema.optional(),
  status: RepairStatusSchema,
  risk: RepairRiskSchema,
  providerBudget: z.number().int().nonnegative(),
  providerCalls: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();
export type RepairTransaction = z.infer<typeof RepairTransactionSchema>;

export type RepairFailureClass = FailureDeltaEntry["classification"];

export function checksumRepairValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function createRepairIncident(input: Omit<RepairIncident, "incidentId"> & { incidentId?: string }): RepairIncident {
  return RepairIncidentSchema.parse({ ...input, incidentId: input.incidentId ?? `incident-${randomUUID()}` });
}

export function createRepairTransaction(incident: RepairIncident, input: Partial<Pick<RepairTransaction, "repairId" | "risk" | "providerBudget">> = {}): RepairTransaction {
  const timestamp = new Date().toISOString();
  return RepairTransactionSchema.parse({ repairId: input.repairId ?? `repair-${randomUUID()}`, incident, status: "INCIDENT_CAPTURED", risk: input.risk ?? "MEDIUM", providerBudget: input.providerBudget ?? 0, providerCalls: 0, createdAt: timestamp, updatedAt: timestamp });
}

export function checksumImpactGraph(value: Omit<ChangeImpactGraph, "checksum">): string {
  return checksumRepairValue(value);
}

export function checksumRepairProposal(value: Omit<RepairProposal, "diffChecksum">): string {
  return checksumRepairValue(value);
}
