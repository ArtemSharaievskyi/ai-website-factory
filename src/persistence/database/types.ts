import type { FactoryProject } from "@/domain/project/schema";
import type { WorkflowState } from "@/domain/workflow/engine";
import type { DecisionRecord } from "@/domain/workflow/decision";
import type { PersistedDocument, DocumentRow } from "./mapping";
import type { ProjectAsset } from "@/domain/assets/project";
import type { ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import type { BriefRevisionFailureDiagnosticEntry } from "./brief-revision-failure-diagnostics";
import type { RequirementIdentityLineageRecord, RequirementIdentityMigrationRecord } from "@/domain/requirements/v3/identity";
import type { RequirementIdentityLineage } from "@/domain/requirements/v3/identity";

export type ProjectRow = ReturnType<typeof import("./mapping").mapProjectToRow>;
export type ProjectAssetRow = ProjectAsset;
export type ProjectVersionRow = { id: string; projectId: string; versionNumber: number; state: WorkflowState; memoryRootPath: string | null; requirementsChecksum: string | null; selectedDesignChecksum: string | null; architectureChecksum: string | null; releasedAt: string | null; immutable: boolean; createdAt: string; updatedAt: string; rowVersion: number };
export type WorkflowEvent = { id: string; projectId: string; projectVersion: number; fromState: WorkflowState; toState: WorkflowState; actor: string; reason: string; createdAt: string; idempotencyKey?: string; revisionAttemptId?: string };
export type CostRecord = { id: string; projectId: string; projectVersion: number; role: string; taskId?: string; provider: string; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCost: number; createdAt: string };
export type IdempotencyRecord = { key: string; operation: string; payloadHash: string; result: unknown };
export type OperationStatus = "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
export type OperationReservation =
  | { status: "NEW"; key: string }
  | { status: "IN_PROGRESS"; key: string }
  | { status: "SUCCEEDED"; key: string; result: unknown };

export type BriefRevisionAttemptStatus = "RESERVED" | "PROVIDER_PENDING" | "COMMITTED" | "FAILED_RETRYABLE" | "REJECTED_INVALID" | "REJECTED_STALE";
export type BriefRevisionProjectionStatus = "PENDING" | "SYNCED" | "FAILED_RETRYABLE" | "SUPERSEDED";
export type BriefRevisionAttemptRow = { id: string; operationKind: string; operationKey: string; payloadHash: string; projectId: string; projectVersion: number; currentnessToken: Record<string, unknown>; status: BriefRevisionAttemptStatus; leaseOwner: string | null; leaseExpiresAt: string | null; attemptGeneration: number; claimedAt: string | null; committedResult: unknown | null; failureCode: string | null; failureDiagnostics: readonly BriefRevisionFailureDiagnosticEntry[] | null; createdAt: string; updatedAt: string };
export type BriefRevisionHistoryRow = { id: string; attemptId: string; projectId: string; projectVersion: number; revisionReference: string; previousCurrentChecksum: string; nextCurrentChecksum: string; changeSetChecksum: string; entries: unknown[]; createdAt: string };
export type BriefRevisionProjectionRow = { id: string; attemptId: string; projectId: string; projectVersion: number; documentChecksum: string; status: BriefRevisionProjectionStatus; attemptCount: number; lastFailureCode: string | null; nextAttemptAt: string | null; createdAt: string; updatedAt: string };
/** Immutable forensic record for a host-authorized full Planning recovery. */
export type PlanningRecoveryEvidenceRow = {
  id: string;
  operationKey: string;
  projectId: string;
  projectVersion: number;
  recoveryPlanChecksum: string;
  briefRowVersion: number;
  briefSemanticChecksum: string;
  briefDocumentChecksum: string;
  priorPlanningRowVersion: number;
  priorPlanningSemanticChecksum: string;
  priorPlanningDocumentChecksum: string;
  priorPlanningPackage: unknown;
  nextPlanningRowVersion: number;
  nextPlanningSemanticChecksum: string;
  nextPlanningDocumentChecksum: string;
  createdAt: string;
};
export type BriefRevisionAttemptClaim = { outcome: "CLAIMED" | "IN_PROGRESS_DUPLICATE" | "COMMITTED_REPLAY" | "TERMINAL_REPLAY"; row: BriefRevisionAttemptRow };
export type BriefRevisionAttemptTransition = { attemptId: string; operationKind: string; operationKey: string; payloadHash: string; from: BriefRevisionAttemptStatus; to: BriefRevisionAttemptStatus; attemptGeneration: number; owner?: string; now: string; leaseExpiresAt?: string | null; failureCode?: string | null; failureDiagnostic?: ProviderFailureDiagnostic | null; committedResult?: unknown };
export type BriefRevisionFaultPoint = "before-provider" | "after-provider" | "before-final-transaction" | "after-cas" | "after-brief-write" | "after-history-write" | "after-workflow-write" | "after-attempt-committed-write" | "before-db-commit" | "after-db-commit" | "during-memory-sync" | "before-response";
export type BriefRevisionFaultInjector = { hit(point: BriefRevisionFaultPoint): void | Promise<void> };
export type BriefRevisionAtomicCommitInput = {
  attemptId: string;
  operationKind: string;
  operationKey: string;
  payloadHash: string;
  leaseOwner: string;
  leaseGeneration: number;
  projectId: string;
  projectVersion: number;
  expected: { projectRowVersion: number; workflowState: WorkflowState; projectVersionRowVersion: number; documentType: string; documentChecksum: string; documentRowVersion: number; briefChecksum: string };
  document: DocumentRow | null;
  history: BriefRevisionHistoryRow | null;
  workflow: { targetState: WorkflowState; event: WorkflowEvent | null };
  decision: { record: DecisionRecord; revisionAttemptId: string } | null;
  nextBriefChecksum: string;
  changed: boolean;
  result: unknown;
  projection: BriefRevisionProjectionRow | null;
  identityLineage?: readonly RequirementIdentityLineage[];
  now: string;
  fault?: BriefRevisionFaultInjector;
};
export type BriefRevisionAtomicCommitResult = { attempt: BriefRevisionAttemptRow; project: ProjectRow; document: DocumentRow | null; projection: BriefRevisionProjectionRow | null };
export type RequirementIdentityLineageRow = RequirementIdentityLineageRecord;
export type RequirementIdentityMigrationRow = RequirementIdentityMigrationRecord;

export interface PersistenceTransaction {
  getProject(id: string): Promise<ProjectRow | null>;
  listProjects(): Promise<ProjectRow[]>;
  insertProject(row: ProjectRow, idempotency?: { key: string; payloadHash: string }): Promise<ProjectRow>;
  updateProjectState(input: { id: string; expectedState: WorkflowState; expectedRowVersion: number; state: WorkflowState; updatedAt: string; implementationStartedAt?: string; completedAt?: string }): Promise<ProjectRow>;
  updateProjectSiteLanguage(input: { id: string; siteLanguage: string; updatedAt: string }): Promise<ProjectRow>;
  listAssets(projectId: string): Promise<ProjectAssetRow[]>;
  getAsset(projectId: string, assetId: string): Promise<ProjectAssetRow | null>;
  insertAsset(row: ProjectAssetRow): Promise<ProjectAssetRow>;
  updateAsset(row: ProjectAssetRow): Promise<ProjectAssetRow>;
  deleteAsset(projectId: string, assetId: string): Promise<void>;
  getVersion(projectId: string, version: number): Promise<ProjectVersionRow | null>;
  listVersions(projectId: string): Promise<ProjectVersionRow[]>;
  insertVersion(row: ProjectVersionRow, idempotency?: { key: string; payloadHash: string }): Promise<ProjectVersionRow>;
  reserveNextVersion(projectId: string, idempotency?: { key: string; payloadHash: string }): Promise<ProjectVersionRow>;
  updateVersionImmutable(projectId: string, version: number, releasedAt: string): Promise<ProjectVersionRow>;
  updateVersionRequirementsChecksum(input: { projectId: string; version: number; expectedRowVersion: number; checksum: string; updatedAt: string }): Promise<ProjectVersionRow>;
  updateVersionArtifactChecksums(input: { projectId: string; version: number; expectedRowVersion: number; requirementsChecksum: string | null; selectedDesignChecksum: string | null; architectureChecksum: string | null; updatedAt: string }): Promise<ProjectVersionRow>;
  saveDocument(row: DocumentRow, idempotency?: { key: string; payloadHash: string }): Promise<DocumentRow>;
  saveDocumentCAS(input: { row: DocumentRow; expectedRowVersion: number | null; expectedChecksum: string | null }): Promise<DocumentRow>;
  deleteDocument(projectId: string, version: number, documentType: string): Promise<void>;
  getDocument(projectId: string, version: number, documentType: string): Promise<DocumentRow | null>;
  appendDecision(projectId: string, version: number, record: DecisionRecord, revisionAttemptId?: string): Promise<DecisionRecord>;
  listDecisions(projectId: string, version: number): Promise<DecisionRecord[]>;
  appendWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEvent>;
  saveCost(record: CostRecord): Promise<CostRecord>;
  reserveOperation(input: { operation: string; key: string; payloadHash: string }): Promise<OperationReservation>;
  completeOperation(input: { operation: string; key: string; payloadHash: string; result: unknown }): Promise<void>;
  failOperation(input: { operation: string; key: string; payloadHash: string }): Promise<void>;
  getBriefRevisionAttempt(input: { operationKind: string; operationKey: string; payloadHash?: string }): Promise<BriefRevisionAttemptRow | null>;
  listBriefRevisionAttempts(projectId: string, projectVersion: number): Promise<BriefRevisionAttemptRow[]>;
  getBriefRevisionHistory(attemptId: string): Promise<BriefRevisionHistoryRow | null>;
  listBriefRevisionHistory(projectId: string, projectVersion: number): Promise<BriefRevisionHistoryRow[]>;
  getBriefRevisionProjectionSync(attemptId: string): Promise<BriefRevisionProjectionRow | null>;
  listWorkflowEvents(projectId: string, projectVersion: number): Promise<WorkflowEvent[]>;
  reserveBriefRevisionAttempt(input: { id: string; operationKind: string; operationKey: string; payloadHash: string; projectId: string; projectVersion: number; currentnessToken: Record<string, unknown>; now: string }): Promise<BriefRevisionAttemptRow>;
  claimBriefRevisionAttempt(input: { attemptId: string; operationKind: string; operationKey: string; payloadHash: string; owner: string; now: string; leaseExpiresAt: string }): Promise<BriefRevisionAttemptClaim>;
  transitionBriefRevisionAttempt(input: BriefRevisionAttemptTransition): Promise<BriefRevisionAttemptRow>;
  commitBriefRevision(input: BriefRevisionAtomicCommitInput): Promise<BriefRevisionAtomicCommitResult>;
  listBriefRevisionProjectionSync(limit: number): Promise<BriefRevisionProjectionRow[]>;
  updateBriefRevisionProjectionSync(input: { id: string; expectedStatus: BriefRevisionProjectionStatus; status: BriefRevisionProjectionStatus; attemptCount?: number; failureCode?: string | null; nextAttemptAt?: string | null; updatedAt: string }): Promise<BriefRevisionProjectionRow>;
  getPlanningRecoveryEvidence(projectId: string, projectVersion: number, operationKey: string): Promise<PlanningRecoveryEvidenceRow | null>;
  listPlanningRecoveryEvidence(projectId: string, projectVersion: number): Promise<PlanningRecoveryEvidenceRow[]>;
  appendPlanningRecoveryEvidence(row: PlanningRecoveryEvidenceRow): Promise<PlanningRecoveryEvidenceRow>;
  listRequirementIdentityLineage(projectId: string, projectVersion: number): Promise<RequirementIdentityLineageRow[]>;
  appendRequirementIdentityLineage(row: RequirementIdentityLineageRow): Promise<RequirementIdentityLineageRow>;
  getRequirementIdentityMigration(projectId: string, projectVersion: number, migrationId: string): Promise<RequirementIdentityMigrationRow | null>;
  listRequirementIdentityMigrations(projectId: string, projectVersion: number): Promise<RequirementIdentityMigrationRow[]>;
  appendRequirementIdentityMigration(row: RequirementIdentityMigrationRow): Promise<RequirementIdentityMigrationRow>;
}

export interface PersistenceDatabase { transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T>; }
export type StoredProject = FactoryProject & { rowVersion: number };
export type StoredDocument = PersistedDocument;
