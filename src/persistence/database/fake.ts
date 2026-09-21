import { randomUUID } from "node:crypto";
import { PersistenceError } from "./errors";
import { appendBriefRevisionFailureDiagnostic } from "./brief-revision-failure-diagnostics";
import { PlanningRecoveryRunSchema, assertPlanningRecoveryRunTransition, hasPlanningRecoveryRunImmutablePatch, hasValidNewPlanningRecoveryRunSourceBinding, isLeaseActive, isPlanningRecoveryRunTerminal, terminalOutcomeFor, type PlanningRecoveryProviderAttemptStart, type PlanningRecoveryProviderAttemptStartInput, type PlanningRecoveryRunClaim, type PlanningRecoveryRunRow, type PlanningRecoveryRunTransition } from "@/agents/planner/recovery-runs";
import { checksumPersistedDocument } from "./serialization";
import type { BriefRevisionAtomicCommitResult, BriefRevisionAttemptClaim, BriefRevisionAttemptRow, BriefRevisionAttemptStatus, BriefRevisionAttemptTransition, BriefRevisionProjectionRow, PersistenceDatabase, PersistenceTransaction, ProjectRow, ProjectAssetRow, ProjectVersionRow, WorkflowEvent, CostRecord, IdempotencyRecord, PlanningRecoveryEvidenceRow, RequirementIdentityLineageRow, RequirementIdentityMigrationRow } from "./types";
import { mapRowToDocument, type DocumentRow } from "./mapping";
import { canonicalBriefChecksumForDocument } from "./brief-revision-v3-contracts";
import { assertPlanningRecoveryProviderAttemptStartCurrentness } from "./planning-recovery-currentness";
import type { DecisionRecord } from "@/domain/workflow/decision";
import { RequirementIdentityLineageRecordSchema, RequirementIdentityMigrationRecordSchema } from "@/domain/requirements/v3/identity";
import { stableSerialize } from "@/domain/requirements/v3/serialization";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemoryPersistenceDatabase implements PersistenceDatabase {
  readonly projects = new Map<string, ProjectRow>();
  readonly assets = new Map<string, ProjectAssetRow>();
  readonly versions = new Map<string, ProjectVersionRow>();
  readonly documents = new Map<string, DocumentRow>();
  readonly decisions = new Map<string, DecisionRecord[]>();
  readonly events: WorkflowEvent[] = [];
  readonly costs: CostRecord[] = [];
  readonly briefRevisionAttempts = new Map<string, BriefRevisionAttemptRow>();
  readonly briefRevisionHistory = new Map<string, import("./types").BriefRevisionHistoryRow>();
  readonly briefRevisionProjectionSync = new Map<string, BriefRevisionProjectionRow>();
  readonly planningRecoveryEvidence = new Map<string, PlanningRecoveryEvidenceRow>();
  readonly planningRecoveryRuns = new Map<string, PlanningRecoveryRunRow>();
  readonly requirementIdentityLineage = new Map<string, RequirementIdentityLineageRow>();
  readonly requirementIdentityMigrations = new Map<string, RequirementIdentityMigrationRow>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const projects = new Map(this.projects); const assets = new Map(this.assets); const versions = new Map(this.versions); const documents = new Map(this.documents); const decisions = new Map([...this.decisions].map(([key, value]) => [key, copy(value)])); const events = [...this.events]; const costs = [...this.costs]; const idempotency = new Map(this.idempotency); const briefRevisionAttempts = new Map([...this.briefRevisionAttempts].map(([key, value]) => [key, copy(value)])); const briefRevisionHistory = new Map([...this.briefRevisionHistory].map(([key, value]) => [key, copy(value)])); const briefRevisionProjectionSync = new Map([...this.briefRevisionProjectionSync].map(([key, value]) => [key, copy(value)])); const planningRecoveryEvidence = new Map([...this.planningRecoveryEvidence].map(([key, value]) => [key, copy(value)])); const planningRecoveryRuns = new Map([...this.planningRecoveryRuns].map(([key, value]) => [key, copy(value)])); const requirementIdentityLineage = new Map([...this.requirementIdentityLineage].map(([key, value]) => [key, copy(value)])); const requirementIdentityMigrations = new Map([...this.requirementIdentityMigrations].map(([key, value]) => [key, copy(value)]));
    const savePlanningRecoveryRun = (row: PlanningRecoveryRunRow, expectedState: PlanningRecoveryRunRow["state"]) => {
      const current = this.planningRecoveryRuns.get(row.runId);
      if (!current || current.operationKey !== row.operationKey || current.state !== expectedState) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery run state is stale.");
      this.planningRecoveryRuns.set(row.runId, copy(row));
      return copy(row);
    };
    const transaction: PersistenceTransaction = {
      getProject: async (id) => copy(this.projects.get(id) ?? null),
      listProjects: async () => copy([...this.projects.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at))),
      insertProject: async (row, token) => { const result = this.idempotent("project:create", token, row); if (result) return copy(result as ProjectRow); if (this.projects.has(row.id)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Project already exists."); this.projects.set(row.id, copy(row)); return copy(row); },
      updateProjectState: async (input) => { const row = this.projects.get(input.id); if (!row) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found."); if (row.workflow_state !== input.expectedState || row.row_version !== input.expectedRowVersion) throw new PersistenceError("PERSISTENCE_CONFLICT", "Project state changed before this operation completed."); const next = { ...row, workflow_state: input.state, updated_at: input.updatedAt, implementation_started_at: input.implementationStartedAt ?? row.implementation_started_at, completed_at: input.completedAt ?? row.completed_at, row_version: row.row_version + 1 }; this.projects.set(row.id, next); return copy(next); },
      updateProjectSiteLanguage: async (input) => { const row = this.projects.get(input.id); if (!row) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found."); const next = { ...row, site_language: input.siteLanguage, updated_at: input.updatedAt }; this.projects.set(row.id, next); return copy(next); },
      listAssets: async (projectId) => copy([...this.assets.values()].filter((asset) => asset.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))),
      getAsset: async (projectId, assetId) => copy(this.assets.get(assetKey(projectId, assetId)) ?? null),
      insertAsset: async (row) => { const key = assetKey(row.projectId, row.assetId); if (this.assets.has(key)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Asset already exists."); this.assets.set(key, copy(row)); return copy(row); },
      updateAsset: async (row) => { const key = assetKey(row.projectId, row.assetId); if (!this.assets.has(key)) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Asset was not found."); this.assets.set(key, copy(row)); return copy(row); },
      deleteAsset: async (projectId, assetId) => { this.assets.delete(assetKey(projectId, assetId)); },
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
      updateVersionRequirementsChecksum: async (input) => { const key = versionKey(input.projectId, input.version); const row = this.versions.get(key); if (!row || row.rowVersion !== input.expectedRowVersion || row.immutable) throw new PersistenceError("PERSISTENCE_CONFLICT", "The project version checksum is stale or immutable."); const next = { ...row, requirementsChecksum: input.checksum, updatedAt: input.updatedAt, rowVersion: row.rowVersion + 1 }; this.versions.set(key, next); return copy(next); },
      updateVersionArtifactChecksums: async (input) => { const key = versionKey(input.projectId, input.version); const row = this.versions.get(key); if (!row || row.rowVersion !== input.expectedRowVersion || row.immutable) throw new PersistenceError("PERSISTENCE_CONFLICT", "The project version artifact checksums are stale or immutable."); const next = { ...row, requirementsChecksum: input.requirementsChecksum, selectedDesignChecksum: input.selectedDesignChecksum, architectureChecksum: input.architectureChecksum, updatedAt: input.updatedAt, rowVersion: row.rowVersion + 1 }; this.versions.set(key, next); return copy(next); },
      saveDocument: async (row, token) => { const key = documentKey(row.projectId, row.projectVersion, row.documentType); const existing = this.documents.get(key); const result = this.idempotent(`document:${key}`, token, row); if (result) return copy(result as DocumentRow); if (existing && existing.checksum === row.checksum) return copy(existing); if (existing) row = { ...row, createdAt: existing.createdAt, rowVersion: existing.rowVersion + 1 }; this.documents.set(key, copy(row)); return copy(row); },
      saveDocumentCAS: async (input) => { const key = documentKey(input.row.projectId, input.row.projectVersion, input.row.documentType); const existing = this.documents.get(key); if (input.expectedRowVersion === null) { if (existing) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 current document was created concurrently."); this.documents.set(key, copy(input.row)); return copy(input.row); } if (!existing || existing.rowVersion !== input.expectedRowVersion || existing.checksum !== input.expectedChecksum) throw new PersistenceError("PERSISTENCE_CONFLICT", "The current document is stale."); const next = { ...input.row, createdAt: existing.createdAt, rowVersion: existing.rowVersion + 1 }; this.documents.set(key, copy(next)); return copy(next); },
      getDocument: async (projectId, version, documentType) => copy(this.documents.get(documentKey(projectId, version, documentType)) ?? null),
      deleteDocument: async (projectId, version, documentType) => { this.documents.delete(documentKey(projectId, version, documentType)); },
      appendDecision: async (projectId, version, record, revisionAttemptId) => { const key = versionKey(projectId, version); const records = this.decisions.get(key) ?? []; records.push(copy(record)); this.decisions.set(key, records); if (revisionAttemptId) { const existing = [...this.decisions.values()].flat().filter((candidate) => candidate.id === record.id); if (existing.length > 1) throw new PersistenceError("PERSISTENCE_CONFLICT", "A revision decision already exists."); } return copy(record); },
      listDecisions: async (projectId, version) => copy(this.decisions.get(versionKey(projectId, version)) ?? []),
      appendWorkflowEvent: async (event) => { this.events.push(copy(event)); return copy(event); },
      saveCost: async (record) => { this.costs.push(copy(record)); return copy(record); },
      reserveOperation: async (input) => {
        const recordKey = `${input.operation}:${input.key}`;
        const existing = this.idempotency.get(recordKey);
        if (!existing) {
          this.idempotency.set(recordKey, { key: input.key, operation: input.operation, payloadHash: input.payloadHash, result: { status: "IN_PROGRESS", ...(input.initialResult === undefined ? {} : { result: copy(input.initialResult) }) }, createdAt: new Date().toISOString() });
          return { status: "NEW", key: input.key };
        }
        if (existing.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key was already used with a different payload.");
        const state = existing.result as { status?: string; result?: unknown };
        if (state.status === "IN_PROGRESS") return { status: "IN_PROGRESS", key: input.key };
        if (state.status === "SUCCEEDED") return { status: "SUCCEEDED", key: input.key, result: copy(state.result) };
        this.idempotency.set(recordKey, { ...existing, result: { status: "IN_PROGRESS", ...(input.initialResult === undefined ? {} : { result: copy(input.initialResult) }) } });
        return { status: "NEW", key: input.key };
      },
      getOperation: async (input) => {
        const existing = this.idempotency.get(`${input.operation}:${input.key}`);
        if (!existing) return null;
        if (input.payloadHash && existing.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key was already used with a different payload.");
        const state = existing.result as { status?: string; result?: unknown };
        if (state.status !== "IN_PROGRESS" && state.status !== "SUCCEEDED" && state.status !== "FAILED") throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The operation state is invalid.");
        return { key: existing.key, operation: existing.operation, status: state.status, payloadHash: existing.payloadHash, ...(state.result === undefined ? {} : { result: copy(state.result) }), createdAt: existing.createdAt ?? "" };
      },
      listOperations: async (input) => {
        const limit = Math.max(1, Math.min(input.limit ?? 8, 100));
        return copy([...this.idempotency.values()]
          .filter((record) => record.operation === input.operation && (!input.keyPrefix || record.key.startsWith(input.keyPrefix)))
          .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.key.localeCompare(right.key))
          .slice(0, limit)
          .map((record) => {
            const state = record.result as { status?: string; result?: unknown };
            if (state.status !== "IN_PROGRESS" && state.status !== "SUCCEEDED" && state.status !== "FAILED") throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The operation state is invalid.");
            return { key: record.key, operation: record.operation, status: state.status, payloadHash: record.payloadHash, ...(state.result === undefined ? {} : { result: copy(state.result) }), createdAt: record.createdAt ?? "" };
          }));
      },
      updateOperationResult: async (input) => {
        const recordKey = `${input.operation}:${input.key}`;
        const existing = this.idempotency.get(recordKey);
        const state = existing?.result as { status?: string; result?: { attemptId?: string } } | undefined;
        if (!existing || existing.payloadHash !== input.payloadHash || state?.status !== "IN_PROGRESS" || input.leaseId !== undefined && state.result?.attemptId !== input.leaseId) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key is not current.");
        this.idempotency.set(recordKey, { ...existing, result: { status: "IN_PROGRESS", result: copy(input.result) } });
      },
      completeOperation: async (input) => {
        const recordKey = `${input.operation}:${input.key}`;
        const existing = this.idempotency.get(recordKey);
        const state = existing?.result as { status?: string; result?: { attemptId?: string } } | undefined;
        if (!existing || existing.payloadHash !== input.payloadHash || state?.status !== "IN_PROGRESS" || input.leaseId !== undefined && state.result?.attemptId !== input.leaseId) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key is not current.");
        this.idempotency.set(recordKey, { ...existing, result: { status: "SUCCEEDED", result: copy(input.result) } });
      },
      failOperation: async (input) => {
        const recordKey = `${input.operation}:${input.key}`;
        const existing = this.idempotency.get(recordKey);
        const state = existing?.result as { status?: string; result?: { attemptId?: string } } | undefined;
        if (!existing || existing.payloadHash !== input.payloadHash || state?.status !== "IN_PROGRESS" || input.leaseId !== undefined && state.result?.attemptId !== input.leaseId) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key is not current.");
        this.idempotency.set(recordKey, { ...existing, result: { status: "FAILED", ...(input.result === undefined ? {} : { result: copy(input.result) }) } });
      },
      getBriefRevisionAttempt: async (input) => {
        const row = [...this.briefRevisionAttempts.values()].find((candidate) => candidate.operationKind === input.operationKind && candidate.operationKey === input.operationKey) ?? null;
        if (row && input.payloadHash && row.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
        return row ? copy(row) : null;
      },
      listBriefRevisionAttempts: async (projectId, projectVersion) => copy([...this.briefRevisionAttempts.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))),
      getBriefRevisionHistory: async (attemptId) => copy([...this.briefRevisionHistory.values()].find((row) => row.attemptId === attemptId) ?? null),
      listBriefRevisionHistory: async (projectId, projectVersion) => copy([...this.briefRevisionHistory.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))),
      getBriefRevisionProjectionSync: async (attemptId) => copy([...this.briefRevisionProjectionSync.values()].find((row) => row.attemptId === attemptId) ?? null),
      listWorkflowEvents: async (projectId, projectVersion) => copy(this.events.filter((event) => event.projectId === projectId && event.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))),
      reserveBriefRevisionAttempt: async (input) => {
        const existing = [...this.briefRevisionAttempts.values()].find((candidate) => candidate.operationKind === input.operationKind && candidate.operationKey === input.operationKey);
        if (existing) {
          if (existing.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
          return copy(existing);
        }
        const row: BriefRevisionAttemptRow = { id: input.id, operationKind: input.operationKind, operationKey: input.operationKey, payloadHash: input.payloadHash, projectId: input.projectId, projectVersion: input.projectVersion, currentnessToken: copy(input.currentnessToken), status: "RESERVED", leaseOwner: null, leaseExpiresAt: null, attemptGeneration: 0, claimedAt: null, committedResult: null, failureCode: null, failureDiagnostics: null, createdAt: input.now, updatedAt: input.now };
        this.briefRevisionAttempts.set(row.id, row);
        return copy(row);
      },
      claimBriefRevisionAttempt: async (input): Promise<BriefRevisionAttemptClaim> => {
        const row = this.briefRevisionAttempts.get(input.attemptId);
        if (!row || row.operationKind !== input.operationKind || row.operationKey !== input.operationKey) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The V3 attempt was not found.");
        if (row.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
        if (row.status === "COMMITTED") return { outcome: "COMMITTED_REPLAY", row: copy(row) };
        if (row.status === "REJECTED_INVALID" || row.status === "REJECTED_STALE") return { outcome: "TERMINAL_REPLAY", row: copy(row) };
        if (row.status === "PROVIDER_PENDING" && row.leaseExpiresAt && Date.parse(row.leaseExpiresAt) > Date.parse(input.now)) return { outcome: "IN_PROGRESS_DUPLICATE", row: copy(row) };
        if (!(row.status === "RESERVED" || row.status === "FAILED_RETRYABLE" || row.status === "PROVIDER_PENDING")) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt cannot be claimed from its current state.");
        const next: BriefRevisionAttemptRow = { ...row, status: "PROVIDER_PENDING", leaseOwner: input.owner, leaseExpiresAt: input.leaseExpiresAt, attemptGeneration: row.attemptGeneration + 1, claimedAt: input.now, failureCode: null, updatedAt: input.now };
        this.briefRevisionAttempts.set(row.id, next);
        return { outcome: "CLAIMED", row: copy(next) };
      },
      transitionBriefRevisionAttempt: async (input: BriefRevisionAttemptTransition) => {
        const allowed: Record<BriefRevisionAttemptStatus, readonly BriefRevisionAttemptStatus[]> = { RESERVED: ["PROVIDER_PENDING", "FAILED_RETRYABLE", "REJECTED_INVALID", "REJECTED_STALE"], PROVIDER_PENDING: ["FAILED_RETRYABLE", "REJECTED_INVALID", "REJECTED_STALE"], FAILED_RETRYABLE: ["PROVIDER_PENDING"], COMMITTED: [], REJECTED_INVALID: [], REJECTED_STALE: [] };
        if (!allowed[input.from].includes(input.to)) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt transition is invalid.");
        const row = this.briefRevisionAttempts.get(input.attemptId);
        if (!row || row.operationKind !== input.operationKind || row.operationKey !== input.operationKey || row.payloadHash !== input.payloadHash || row.status !== input.from || row.attemptGeneration !== input.attemptGeneration || (input.owner && row.leaseOwner !== input.owner)) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt transition was stale.");
        const next: BriefRevisionAttemptRow = { ...row, status: input.to, leaseOwner: null, leaseExpiresAt: null, failureCode: input.failureCode ?? null, failureDiagnostics: input.failureDiagnostic ? appendBriefRevisionFailureDiagnostic(row.failureDiagnostics, input.attemptGeneration, input.failureDiagnostic) : row.failureDiagnostics, committedResult: input.committedResult ?? null, updatedAt: input.now };
        this.briefRevisionAttempts.set(row.id, next);
        return copy(next);
      },
      commitBriefRevision: async (input): Promise<BriefRevisionAtomicCommitResult> => {
        const project = this.projects.get(input.projectId);
        const version = this.versions.get(versionKey(input.projectId, input.projectVersion));
        const currentDocument = this.documents.get(documentKey(input.projectId, input.projectVersion, input.expected.documentType));
        const attempt = this.briefRevisionAttempts.get(input.attemptId);
        if (!project || !version) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project version was not found.");
        if (version.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Project version is immutable.");
        if (!attempt || attempt.operationKind !== input.operationKind || attempt.operationKey !== input.operationKey || attempt.payloadHash !== input.payloadHash || attempt.status !== "PROVIDER_PENDING" || attempt.leaseOwner !== input.leaseOwner || attempt.attemptGeneration !== input.leaseGeneration) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt is no longer owned for commit.");
        if (project.current_version !== input.projectVersion || project.workflow_state !== input.expected.workflowState || project.row_version !== input.expected.projectRowVersion || version.rowVersion !== input.expected.projectVersionRowVersion || !currentDocument || currentDocument.rowVersion !== input.expected.documentRowVersion || currentDocument.checksum !== input.expected.documentChecksum || canonicalBriefChecksumForDocument(mapRowToDocument(currentDocument)) !== input.expected.briefChecksum) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 currentness token is stale.");
        if (!input.changed) {
          await input.fault?.hit("after-cas");
          const committed = { ...attempt, status: "COMMITTED" as const, leaseOwner: null, leaseExpiresAt: null, committedResult: copy(input.result), failureCode: null, updatedAt: input.now };
          this.briefRevisionAttempts.set(attempt.id, committed);
          await input.fault?.hit("after-attempt-committed-write");
          await input.fault?.hit("before-db-commit");
          return { attempt: copy(committed), project: copy(project), document: null, projection: null };
        }
        const nextProject = { ...project, workflow_state: input.workflow.targetState, updated_at: input.now, row_version: project.row_version + 1 };
        this.projects.set(project.id, nextProject);
        await input.fault?.hit("after-cas");
        const nextDocument = input.document ? await transaction.saveDocumentCAS({ row: input.document, expectedRowVersion: input.expected.documentType === input.document.documentType ? input.expected.documentRowVersion : null, expectedChecksum: input.expected.documentType === input.document.documentType ? input.expected.documentChecksum : null }) : null;
        await input.fault?.hit("after-brief-write");
        await transaction.updateVersionRequirementsChecksum({ projectId: input.projectId, version: input.projectVersion, expectedRowVersion: input.expected.projectVersionRowVersion, checksum: input.nextBriefChecksum, updatedAt: input.now });
        if (input.history) this.briefRevisionHistory.set(input.history.id, copy(input.history));
        if (input.identityLineage) for (const lineage of input.identityLineage) await transaction.appendRequirementIdentityLineage({ ...lineage, createdAt: input.now });
        await input.fault?.hit("after-history-write");
        if (input.workflow.event) this.events.push(copy(input.workflow.event));
        if (input.decision) { const records = this.decisions.get(versionKey(input.projectId, input.projectVersion)) ?? []; records.push(copy(input.decision.record)); this.decisions.set(versionKey(input.projectId, input.projectVersion), records); }
        await input.fault?.hit("after-workflow-write");
        const committed = { ...attempt, status: "COMMITTED" as const, leaseOwner: null, leaseExpiresAt: null, committedResult: copy(input.result), failureCode: null, updatedAt: input.now };
        this.briefRevisionAttempts.set(attempt.id, committed);
        await input.fault?.hit("after-attempt-committed-write");
        if (input.projection) this.briefRevisionProjectionSync.set(input.projection.id, copy(input.projection));
        await input.fault?.hit("before-db-commit");
        return { attempt: copy(committed), project: copy(nextProject), document: nextDocument, projection: input.projection ? copy(input.projection) : null };
      },
      listBriefRevisionProjectionSync: async (limit) => copy([...this.briefRevisionProjectionSync.values()].filter((row) => (row.status === "PENDING" || row.status === "FAILED_RETRYABLE") && (!row.nextAttemptAt || Date.parse(row.nextAttemptAt) <= Date.now()) && (!row.leaseOwner || !row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) <= Date.now())).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(0, Math.max(1, Math.min(limit, 100)))),
      claimBriefRevisionProjectionSync: async (input) => { const project = this.projects.get(input.projectId); const row = this.briefRevisionProjectionSync.get(input.id); const leaseExpiresAt = row?.leaseExpiresAt; const activeLease = typeof leaseExpiresAt === "string" && Date.parse(leaseExpiresAt) > Date.parse(input.now); if (!project || !row || (row.status !== "PENDING" && row.status !== "FAILED_RETRYABLE") || (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > Date.parse(input.now)) || activeLease) return { outcome: "NOT_CLAIMABLE", row: null }; const next = { ...row, claimGeneration: row.claimGeneration + 1, leaseOwner: input.owner, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now }; this.briefRevisionProjectionSync.set(row.id, next); return { outcome: "CLAIMED", row: copy(next) }; },
      updateBriefRevisionProjectionSync: async (input) => { const row = this.briefRevisionProjectionSync.get(input.id); const leaseExpiresAt = row?.leaseExpiresAt; const owned = row?.leaseOwner === input.owner && row.claimGeneration === input.claimGeneration && typeof leaseExpiresAt === "string" && Date.parse(leaseExpiresAt) > Date.parse(input.updatedAt); if (!row || row.status !== input.expectedStatus || !owned) throw new PersistenceError("PERSISTENCE_CONFLICT", "The projection sync status is stale."); const next = { ...row, status: input.status, attemptCount: input.attemptCount ?? row.attemptCount, lastFailureCode: input.failureCode ?? null, nextAttemptAt: input.nextAttemptAt ?? null, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.updatedAt }; this.briefRevisionProjectionSync.set(row.id, next); return copy(next); },
      getPlanningRecoveryRun: async (projectId, projectVersion, operationKey) => copy([...this.planningRecoveryRuns.values()].find((row) => row.projectId === projectId && row.projectVersion === projectVersion && row.operationKey === operationKey) ?? null),
      listPlanningRecoveryRuns: async (projectId, projectVersion) => copy([...this.planningRecoveryRuns.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId))),
      createPlanningRecoveryRun: async (input) => {
        const row = PlanningRecoveryRunSchema.parse(input);
        if (!hasValidNewPlanningRecoveryRunSourceBinding(row)) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "New Planning recovery runs require an immutable source-head binding.");
        const existing = [...this.planningRecoveryRuns.values()].find((candidate) => candidate.projectId === row.projectId && candidate.projectVersion === row.projectVersion && candidate.operationKey === row.operationKey);
        if (existing) {
          const identity = (candidate: PlanningRecoveryRunRow) => ({ runId: candidate.runId, projectId: candidate.projectId, projectVersion: candidate.projectVersion, versionId: candidate.versionId, expectedSourceHead: candidate.expectedSourceHead, recoveryPlanChecksum: candidate.recoveryPlanChecksum, recoveryPlan: candidate.recoveryPlan, projectRowVersion: candidate.projectRowVersion, projectVersionRowVersion: candidate.projectVersionRowVersion, briefRowVersion: candidate.briefRowVersion, briefSemanticChecksum: candidate.briefSemanticChecksum, briefDocumentChecksum: candidate.briefDocumentChecksum, planningRowVersion: candidate.planningRowVersion, planningSemanticChecksum: candidate.planningSemanticChecksum, planningDocumentChecksum: candidate.planningDocumentChecksum, providerBudget: candidate.providerBudget });
          if (stableSerialize(identity(existing)) !== stableSerialize(identity(row))) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The Planning recovery operation key is bound to different execution inputs.");
          return copy(existing);
        }
        this.planningRecoveryRuns.set(row.runId, copy(row));
        return copy(row);
      },
      claimPlanningRecoveryRun: async (input): Promise<PlanningRecoveryRunClaim> => {
        const row = this.planningRecoveryRuns.get(input.runId);
        if (!row || row.operationKey !== input.operationKey) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Planning recovery run was not found.");
        if (row.state === "COMMITTED" || row.state === "COMMITTED_RECONCILED") return { outcome: "COMMITTED_REPLAY", row: copy(row) };
        if (isPlanningRecoveryRunTerminal(row.state)) return { outcome: "TERMINAL_FAILURE_REPLAY", row: copy(row) };
        if (row.state === "CREATED") {
          if (row.providerAttemptCount >= row.providerBudget) return { outcome: "PROVIDER_ATTEMPT_ALREADY_CONSUMED", row: copy(row) };
          const next = PlanningRecoveryRunSchema.parse({ ...row, state: "CLAIMED", leaseOwner: input.owner, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now });
          return { outcome: "CLAIMED", row: savePlanningRecoveryRun(next, row.state) };
        }
        if (row.state === "CLAIMED") {
          if (isLeaseActive(row, input.now)) return { outcome: "RUN_ALREADY_ACTIVE", row: copy(row) };
          const next = PlanningRecoveryRunSchema.parse({ ...row, leaseOwner: input.owner, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now });
          return { outcome: "RESUMED", row: savePlanningRecoveryRun(next, row.state) };
        }
        if (row.state === "PROVIDER_CALL_STARTED") {
          if (isLeaseActive(row, input.now)) return { outcome: "RUN_ALREADY_ACTIVE", row: copy(row) };
          assertPlanningRecoveryRunTransition(row.state, "OUTCOME_INDETERMINATE");
          const next = PlanningRecoveryRunSchema.parse({ ...row, state: "OUTCOME_INDETERMINATE", terminalOutcome: "OUTCOME_INDETERMINATE", leaseOwner: null, leaseExpiresAt: null, diagnosticStage: "provider", diagnosticCode: "PROVIDER_RESULT_MISSING", diagnosticMessage: "The provider attempt was durably consumed but its result was not recorded.", updatedAt: input.now });
          return { outcome: "PROVIDER_ATTEMPT_ALREADY_CONSUMED", row: savePlanningRecoveryRun(next, row.state) };
        }
        if (isLeaseActive(row, input.now)) return { outcome: "RUN_ALREADY_ACTIVE", row: copy(row) };
        const next = PlanningRecoveryRunSchema.parse({ ...row, leaseOwner: input.owner, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now });
        return { outcome: "RESUMED", row: savePlanningRecoveryRun(next, row.state) };
      },
      startPlanningRecoveryProviderAttempt: async (input: PlanningRecoveryProviderAttemptStartInput): Promise<PlanningRecoveryProviderAttemptStart> => {
        const row = this.planningRecoveryRuns.get(input.runId);
        if (!row || row.operationKey !== input.operationKey) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Planning recovery run was not found.");
        if (row.state !== "CLAIMED" || row.leaseOwner !== input.owner || row.leaseExpiresAt !== input.leaseExpiresAt || !isLeaseActive(row, input.now) || row.providerAttemptCount !== 0 || row.providerBudget < 1) {
          throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery provider attempt cannot start from the claimed run state.");
        }
        const project = this.projects.get(input.currentness.projectId);
        const version = this.versions.get(`${input.currentness.projectId}:${input.currentness.projectVersion}`);
        const briefRow = this.documents.get(`${input.currentness.projectId}:${input.currentness.projectVersion}:brief-v3`);
        const planningRow = this.documents.get(`${input.currentness.projectId}:${input.currentness.projectVersion}:planning-package`);
        if (!project || !version || !briefRow || !planningRow) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery canonical currentness is unavailable.");
        try {
          assertPlanningRecoveryProviderAttemptStartCurrentness({ run: row, currentness: input.currentness, expectedSourceHead: input.expectedSourceHead, recoveryPlanChecksum: input.recoveryPlanChecksum, project, version, briefRow, planningRow });
        } catch (error) {
          if (error instanceof PersistenceError) throw error;
          throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery canonical currentness is stale.");
        }
        assertPlanningRecoveryRunTransition(row.state, "PROVIDER_CALL_STARTED");
        const next = PlanningRecoveryRunSchema.parse({ ...row, state: "PROVIDER_CALL_STARTED", providerAttemptCount: 1, updatedAt: input.now });
        return { outcome: "PROVIDER_STARTED", row: savePlanningRecoveryRun(next, row.state) };
      },
      transitionPlanningRecoveryRun: async (input: PlanningRecoveryRunTransition) => {
        const current = this.planningRecoveryRuns.get(input.runId);
        if (!current || current.operationKey !== input.operationKey || current.state !== input.from) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery run transition is stale.");
        if (hasPlanningRecoveryRunImmutablePatch(input.patch)) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Planning recovery run identity is immutable.");
        if (input.owner && (current.leaseOwner !== input.owner || !isLeaseActive(current, input.now))) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery run lease is stale.");
        assertPlanningRecoveryRunTransition(input.from, input.to);
        const terminal = isPlanningRecoveryRunTerminal(input.to);
        const next = PlanningRecoveryRunSchema.parse({ ...current, ...(input.patch ?? {}), state: input.to, terminalOutcome: terminalOutcomeFor(input.to), ...(terminal ? { leaseOwner: null, leaseExpiresAt: null } : {}), updatedAt: input.now });
        return savePlanningRecoveryRun(next, input.from);
      },
      updatePlanningRecoveryRunProjection: async (input) => {
        const current = this.planningRecoveryRuns.get(input.runId);
        if (!current || current.operationKey !== input.operationKey || !["COMMITTED", "COMMITTED_RECONCILED"].includes(current.state)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery run projection state is stale.");
        const next = PlanningRecoveryRunSchema.parse({ ...current, projectMemoryStatus: input.status, projectMemoryFailureCode: input.failureCode ?? null, projectMemoryFailureMessage: input.failureMessage ?? null, updatedAt: input.now });
        this.planningRecoveryRuns.set(input.runId, copy(next));
        return copy(next);
      },
      getPlanningRecoveryEvidence: async (projectId, projectVersion, operationKey) => copy([...this.planningRecoveryEvidence.values()].find((row) => row.projectId === projectId && row.projectVersion === projectVersion && row.operationKey === operationKey) ?? null),
      listPlanningRecoveryEvidence: async (projectId, projectVersion) => copy([...this.planningRecoveryEvidence.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))),
      appendPlanningRecoveryEvidence: async (input) => { const existing = this.planningRecoveryEvidence.get(`${input.projectId}:${input.projectVersion}:${input.operationKey}`); if (existing) { if (stableSerialize(existing) !== stableSerialize(input)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Planning recovery evidence conflicts with immutable history."); return copy(existing); } const row = copy(input); this.planningRecoveryEvidence.set(`${row.projectId}:${row.projectVersion}:${row.operationKey}`, row); return copy(row); },
      listRequirementIdentityLineage: async (projectId, projectVersion) => copy([...this.requirementIdentityLineage.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.lineageId.localeCompare(right.lineageId))),
      appendRequirementIdentityLineage: async (input) => { const row = RequirementIdentityLineageRecordSchema.parse(input); const sourceKey = `${row.projectId}:${row.projectVersion}:${row.fromRequirementId}`; const existing = this.requirementIdentityLineage.get(sourceKey); if (existing) { if (stableSerialize(existing) !== stableSerialize(row)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Requirement identity lineage conflicts with immutable history."); return copy(existing); } const targetConflict = [...this.requirementIdentityLineage.values()].find((candidate) => candidate.projectId === row.projectId && candidate.projectVersion === row.projectVersion && candidate.toRequirementId === row.toRequirementId); if (targetConflict) throw new PersistenceError("PERSISTENCE_CONFLICT", "Requirement identity lineage target is already assigned."); this.requirementIdentityLineage.set(sourceKey, copy(row)); return copy(row); },
      getRequirementIdentityMigration: async (projectId, projectVersion, migrationId) => copy(this.requirementIdentityMigrations.get(`${projectId}:${projectVersion}:${migrationId}`) ?? null),
      listRequirementIdentityMigrations: async (projectId, projectVersion) => copy([...this.requirementIdentityMigrations.values()].filter((row) => row.projectId === projectId && row.projectVersion === projectVersion).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.migrationId.localeCompare(right.migrationId))),
      appendRequirementIdentityMigration: async (input) => { const row = RequirementIdentityMigrationRecordSchema.parse(input); const key = `${row.projectId}:${row.projectVersion}:${row.migrationId}`; const existing = this.requirementIdentityMigrations.get(key); if (existing) { if (stableSerialize(existing) !== stableSerialize(row)) throw new PersistenceError("PERSISTENCE_CONFLICT", "Requirement identity migration conflicts with immutable history."); return copy(existing); } this.requirementIdentityMigrations.set(key, copy(row)); return copy(row); },
    };
    try { return await work(transaction); } catch (error) {
      this.projects.clear(); for (const [key, value] of projects) this.projects.set(key, value);
      this.assets.clear(); for (const [key, value] of assets) this.assets.set(key, value);
      this.versions.clear(); for (const [key, value] of versions) this.versions.set(key, value);
      this.documents.clear(); for (const [key, value] of documents) this.documents.set(key, value);
      this.decisions.clear(); for (const [key, value] of decisions) this.decisions.set(key, value);
      this.events.splice(0, this.events.length, ...events); this.costs.splice(0, this.costs.length, ...costs);
      this.idempotency.clear(); for (const [key, value] of idempotency) this.idempotency.set(key, value);
      this.briefRevisionAttempts.clear(); for (const [key, value] of briefRevisionAttempts) this.briefRevisionAttempts.set(key, value);
      this.briefRevisionHistory.clear(); for (const [key, value] of briefRevisionHistory) this.briefRevisionHistory.set(key, value);
      this.briefRevisionProjectionSync.clear(); for (const [key, value] of briefRevisionProjectionSync) this.briefRevisionProjectionSync.set(key, value);
      this.planningRecoveryEvidence.clear(); for (const [key, value] of planningRecoveryEvidence) this.planningRecoveryEvidence.set(key, value);
      this.planningRecoveryRuns.clear(); for (const [key, value] of planningRecoveryRuns) this.planningRecoveryRuns.set(key, value);
      this.requirementIdentityLineage.clear(); for (const [key, value] of requirementIdentityLineage) this.requirementIdentityLineage.set(key, value);
      this.requirementIdentityMigrations.clear(); for (const [key, value] of requirementIdentityMigrations) this.requirementIdentityMigrations.set(key, value);
      throw error;
    } finally { release(); }
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
export const assetKey = (projectId: string, assetId: string) => `${projectId}:${assetId}`;
export const documentKey = (projectId: string, version: number, documentType: string) => `${projectId}:${version}:${documentType}`;
export const documentPayloadHash = (value: unknown) => checksumPersistedDocument(value);
