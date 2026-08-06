import type { FactoryProject } from "../domain/project/schema";
import type { WorkflowState } from "../domain/workflow/engine";
import type { DecisionRecord } from "../domain/workflow/decision";
import type { PersistedDocument, DocumentRow } from "./mapping";

export type ProjectRow = ReturnType<typeof import("./mapping").mapProjectToRow>;
export type ProjectVersionRow = { id: string; projectId: string; versionNumber: number; state: WorkflowState; memoryRootPath: string | null; requirementsChecksum: string | null; selectedDesignChecksum: string | null; architectureChecksum: string | null; releasedAt: string | null; immutable: boolean; createdAt: string; updatedAt: string; rowVersion: number };
export type WorkflowEvent = { id: string; projectId: string; projectVersion: number; fromState: WorkflowState; toState: WorkflowState; actor: string; reason: string; createdAt: string; idempotencyKey?: string };
export type CostRecord = { id: string; projectId: string; projectVersion: number; role: string; taskId?: string; provider: string; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedCost: number; createdAt: string };
export type IdempotencyRecord = { key: string; operation: string; payloadHash: string; result: unknown };

export interface PersistenceTransaction {
  getProject(id: string): Promise<ProjectRow | null>;
  insertProject(row: ProjectRow, idempotency?: { key: string; payloadHash: string }): Promise<ProjectRow>;
  updateProjectState(input: { id: string; expectedState: WorkflowState; expectedRowVersion: number; state: WorkflowState; updatedAt: string; implementationStartedAt?: string; completedAt?: string }): Promise<ProjectRow>;
  getVersion(projectId: string, version: number): Promise<ProjectVersionRow | null>;
  listVersions(projectId: string): Promise<ProjectVersionRow[]>;
  insertVersion(row: ProjectVersionRow, idempotency?: { key: string; payloadHash: string }): Promise<ProjectVersionRow>;
  reserveNextVersion(projectId: string, idempotency?: { key: string; payloadHash: string }): Promise<ProjectVersionRow>;
  updateVersionImmutable(projectId: string, version: number, releasedAt: string): Promise<ProjectVersionRow>;
  saveDocument(row: DocumentRow, idempotency?: { key: string; payloadHash: string }): Promise<DocumentRow>;
  getDocument(projectId: string, version: number, documentType: string): Promise<DocumentRow | null>;
  appendDecision(projectId: string, version: number, record: DecisionRecord): Promise<DecisionRecord>;
  listDecisions(projectId: string, version: number): Promise<DecisionRecord[]>;
  appendWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEvent>;
  saveCost(record: CostRecord): Promise<CostRecord>;
}

export interface PersistenceDatabase { transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T>; }
export type StoredProject = FactoryProject & { rowVersion: number };
export type StoredDocument = PersistedDocument;
