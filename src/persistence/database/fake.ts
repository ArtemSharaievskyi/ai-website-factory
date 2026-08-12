import { randomUUID } from "node:crypto";
import { PersistenceError } from "./errors";
import { checksumPersistedDocument } from "./serialization";
import type { PersistenceDatabase, PersistenceTransaction, ProjectRow, ProjectVersionRow, WorkflowEvent, CostRecord, IdempotencyRecord } from "./types";
import type { DocumentRow } from "./mapping";
import type { DecisionRecord } from "@/domain/workflow/decision";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemoryPersistenceDatabase implements PersistenceDatabase {
  readonly projects = new Map<string, ProjectRow>();
  readonly versions = new Map<string, ProjectVersionRow>();
  readonly documents = new Map<string, DocumentRow>();
  readonly decisions = new Map<string, DecisionRecord[]>();
  readonly events: WorkflowEvent[] = [];
  readonly costs: CostRecord[] = [];
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  async transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T> {
    const projects = new Map(this.projects); const versions = new Map(this.versions); const documents = new Map(this.documents); const decisions = new Map([...this.decisions].map(([key, value]) => [key, copy(value)])); const events = [...this.events]; const costs = [...this.costs]; const idempotency = new Map(this.idempotency);
    const transaction: PersistenceTransaction = {
      getProject: async (id) => copy(this.projects.get(id) ?? null),
      listProjects: async () => copy([...this.projects.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at))),
      insertProject: async (row, token) => { const result = this.idempotent("project:create", token, row); if (result) return copy(result as ProjectRow); if (this.projects.has(row.id)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Project already exists."); this.projects.set(row.id, copy(row)); return copy(row); },
      updateProjectState: async (input) => { const row = this.projects.get(input.id); if (!row) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found."); if (row.workflow_state !== input.expectedState || row.row_version !== input.expectedRowVersion) throw new PersistenceError("PERSISTENCE_CONFLICT", "Project state changed before this operation completed."); const next = { ...row, workflow_state: input.state, updated_at: input.updatedAt, implementation_started_at: input.implementationStartedAt ?? row.implementation_started_at, completed_at: input.completedAt ?? row.completed_at, row_version: row.row_version + 1 }; this.projects.set(row.id, next); return copy(next); },
      getVersion: async (projectId, version) => copy(this.versions.get(versionKey(projectId, version)) ?? null),
      listVersions: async (projectId) => copy([...this.versions.values()].filter((version) => version.projectId === projectId).sort((left, right) => left.versionNumber - right.versionNumber)),
      insertVersion: async (row, token) => { const result = this.idempotent("version:create", token, row); if (result) return copy(result as ProjectVersionRow); const key = versionKey(row.projectId, row.versionNumber); if (this.versions.has(key)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Project version already exists."); this.versions.set(key, copy(row)); return copy(row); },
      reserveNextVersion: async (projectId, token) => {
        const existing = this.findIdempotency("version:reserve", token); if (existing) return copy(existing.result as ProjectVersionRow);
        const project = this.projects.get(projectId); if (!project) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found.");
        const hasCurrent = [...this.versions.values()].some((version) => version.projectId === projectId && version.versionNumber === project.current_version);
        const versionNumber = hasCurrent ? project.current_version + 1 : project.current_version;
        const now = new Date().toISOString(); const row: ProjectVersionRow = { id: randomUUID(), projectId, versionNumber, state: project.workflow_state, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: now, updatedAt: now, rowVersion: 1 };
        this.versions.set(versionKey(projectId, versionNumber), row); this.projects.set(projectId, { ...project, current_version: versionNumber, updated_at: now }); if (token) this.idempotency.set(`version:reserve:${token.key}`, { key: token.key, operation: "version:reserve", payloadHash: token.payloadHash, result: copy(row) }); return copy(row);
      },
      updateVersionImmutable: async (projectId, version, releasedAt) => { const key = versionKey(projectId, version); const row = this.versions.get(key); if (!row) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project version was not found."); if (row.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Released project versions are immutable."); const next = { ...row, state: "PROJECT_READY" as const, releasedAt, immutable: true, updatedAt: releasedAt, rowVersion: row.rowVersion + 1 }; this.versions.set(key, next); return copy(next); },
      saveDocument: async (row, token) => { const key = documentKey(row.projectId, row.projectVersion, row.documentType); const existing = this.documents.get(key); const result = this.idempotent(`document:${key}`, token, row); if (result) return copy(result as DocumentRow); if (existing && existing.checksum === row.checksum) return copy(existing); if (existing) row = { ...row, createdAt: existing.createdAt, rowVersion: existing.rowVersion + 1 }; this.documents.set(key, copy(row)); return copy(row); },
      getDocument: async (projectId, version, documentType) => copy(this.documents.get(documentKey(projectId, version, documentType)) ?? null),
      deleteDocument: async (projectId, version, documentType) => { this.documents.delete(documentKey(projectId, version, documentType)); },
      appendDecision: async (projectId, version, record) => { const key = versionKey(projectId, version); const records = this.decisions.get(key) ?? []; records.push(copy(record)); this.decisions.set(key, records); return copy(record); },
      listDecisions: async (projectId, version) => copy(this.decisions.get(versionKey(projectId, version)) ?? []),
      appendWorkflowEvent: async (event) => { this.events.push(copy(event)); return copy(event); },
      saveCost: async (record) => { this.costs.push(copy(record)); return copy(record); },
    };
    try { return await work(transaction); } catch (error) {
      this.projects.clear(); for (const [key, value] of projects) this.projects.set(key, value);
      this.versions.clear(); for (const [key, value] of versions) this.versions.set(key, value);
      this.documents.clear(); for (const [key, value] of documents) this.documents.set(key, value);
      this.decisions.clear(); for (const [key, value] of decisions) this.decisions.set(key, value);
      this.events.splice(0, this.events.length, ...events); this.costs.splice(0, this.costs.length, ...costs);
      this.idempotency.clear(); for (const [key, value] of idempotency) this.idempotency.set(key, value);
      throw error;
    }
  }

  private idempotent(operation: string, token: { key: string; payloadHash: string } | undefined, result: unknown) {
    if (!token) return undefined;
    const key = `${operation}:${token.key}`;
    const existing = this.idempotency.get(key);
    if (existing && existing.payloadHash !== token.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different payload.");
    if (existing) return existing.result;
    this.idempotency.set(key, { key: token.key, operation, payloadHash: token.payloadHash, result: copy(result) });
    return undefined;
  }

  private findIdempotency(operation: string, token: { key: string; payloadHash: string } | undefined) {
    if (!token) return undefined; const existing = this.idempotency.get(`${operation}:${token.key}`); if (existing && existing.payloadHash !== token.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different payload."); return existing;
  }
}

export const versionKey = (projectId: string, version: number) => `${projectId}:${version}`;
export const documentKey = (projectId: string, version: number, documentType: string) => `${projectId}:${version}:${documentType}`;
export const newWorkflowEvent = (projectId: string, projectVersion: number, fromState: WorkflowEvent["fromState"], toState: WorkflowEvent["toState"], actor: string, reason: string, idempotencyKey?: string): WorkflowEvent => ({ id: randomUUID(), projectId, projectVersion, fromState, toState, actor, reason, createdAt: new Date().toISOString(), ...(idempotencyKey ? { idempotencyKey } : {}) });
export const documentPayloadHash = (value: unknown) => checksumPersistedDocument(value);
