import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/shared/errors";
import { BriefV3Error } from "@/domain/requirements/v3/errors";
import { applyBriefChangeSet, isReductionNoOp } from "@/domain/requirements/v3/reducer";
import { deriveBriefProvenance } from "@/domain/requirements/v3/history";
import { normalizeBriefChangeSet } from "@/domain/requirements/v3/normalize";
import { parseBriefChangeSet, type BriefChangeSet } from "@/domain/requirements/v3/changeset";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { transitionWorkflow } from "@/domain/workflow/engine";
import { BriefV3DocumentSchema, BRIEF_V3_DOCUMENT_TYPE, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { BriefRevisionAttemptRepository } from "@/persistence/database/repositories";
import { mapDocumentToRow, mapRowToDocument } from "@/persistence/database/mapping";
import { PersistenceError } from "@/persistence/database/errors";
import type { BriefRevisionAttemptRow, BriefRevisionAtomicCommitInput, BriefRevisionFaultInjector, BriefRevisionProjectionRow, PersistenceDatabase, ProjectRow, ProjectVersionRow } from "@/persistence/database/types";
import { newWorkflowEvent } from "@/persistence/database/workflow-events";
import { BriefV3ProviderError } from "@/integrations/openai-v3/errors";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { DecisionRecord } from "@/domain/workflow/decision";
import { BriefV3ProjectionService } from "./projection";
import { BriefV3TransactionError, type BriefV3TransactionErrorCode } from "./errors";
import { createBriefV3OperationIdentity, createRevisionCurrentnessToken, sameRevisionCurrentness, type RevisionCurrentnessToken } from "./identity";
import type { BriefV3ProjectionPort, BriefV3RevisionProvider, BriefV3SupportingContext } from "./ports";

export type BriefV3CommittedResult = { outcome: "COMMITTED" | "COMMITTED_REPLAY"; projectId: string; projectVersion: number; attemptId: string; changed: boolean; currentBriefChecksum: string; workflowState: ProjectRow["workflow_state"]; historyId: string | null; projectionStatus: "PENDING" | "SYNCED" | "FAILED_RETRYABLE" | "NONE" };
export type BriefV3TransactionInput = { projectId: string; projectVersion: number; revisionInstruction: string; expectedCurrentness: RevisionCurrentnessToken; targetHints?: readonly string[]; targetWorkflowState?: ProjectRow["workflow_state"]; actor?: string; decision?: DecisionRecord; supportingContext?: readonly BriefV3SupportingContext[]; leaseMs?: number; ownerId?: string; clock?: () => string; faults?: BriefRevisionFaultInjector };

type CurrentSnapshot = { project: ProjectRow; version: ProjectVersionRow; documentRow: import("@/persistence/database/mapping").DocumentRow; canonical: CanonicalBriefV3; currentness: RevisionCurrentnessToken };

function now(input: BriefV3TransactionInput) { return input.clock?.() ?? new Date().toISOString(); }
function classifyProviderFailure(error: unknown): BriefV3TransactionErrorCode {
  if (error instanceof BriefV3ProviderError) return "PROVIDER_INVALID_OUTPUT";
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "";
  return code === "AI_OUTPUT_REFUSED" || code === "AI_REQUEST_REFUSED" ? "PROVIDER_REFUSED" : "PROVIDER_FAILED";
}
function classifyDomainFailure(error: unknown): BriefV3TransactionErrorCode {
  if (error instanceof BriefV3ProviderError) return "PROVIDER_INVALID_OUTPUT";
  if (error instanceof DomainError) return "INVARIANT_FAILED";
  if (!(error instanceof BriefV3Error)) return "CHANGESET_INVALID";
  if (error.code === "BRIEF_V3_MIGRATION_AMBIGUOUS") return "MIGRATION_AMBIGUOUS";
  if (error.code === "BRIEF_V3_REDUCTION_INVALID") return "REDUCTION_FAILED";
  if (error.code === "BRIEF_V3_INVARIANT_VIOLATION" || error.code === "BRIEF_V3_SCHEMA_INVALID" || error.code === "BRIEF_V3_INVALID_COMBINATION") return "INVARIANT_FAILED";
  return "CHANGESET_INVALID";
}
function committedResultFromRow(row: BriefRevisionAttemptRow, outcome: "COMMITTED" | "COMMITTED_REPLAY"): BriefV3CommittedResult {
  if (!row.committedResult || typeof row.committedResult !== "object") throw new BriefV3TransactionError("PERSISTENCE_FAILED", { attemptId: row.id });
  const result = row.committedResult as BriefV3CommittedResult;
  if (result.attemptId !== row.id || result.outcome !== "COMMITTED") throw new BriefV3TransactionError("PERSISTENCE_FAILED", { attemptId: row.id });
  return { ...result, outcome };
}

export class BriefV3TransactionService {
  private readonly attempts: BriefRevisionAttemptRepository;
  private readonly projectionService?: BriefV3ProjectionService;

  constructor(private readonly options: { database: PersistenceDatabase; provider: BriefV3RevisionProvider; projection?: BriefV3ProjectionPort; defaultLeaseMs?: number }) {
    this.attempts = new BriefRevisionAttemptRepository(options.database);
    this.projectionService = options.projection ? new BriefV3ProjectionService(options.database, options.projection) : undefined;
  }

  async execute(input: BriefV3TransactionInput): Promise<BriefV3CommittedResult> {
    const expectedCurrentness = createRevisionCurrentnessToken(input.expectedCurrentness);
    const identity = createBriefV3OperationIdentity({ projectId: input.projectId, projectVersion: input.projectVersion, revisionInstruction: input.revisionInstruction, targetHints: input.targetHints, targetWorkflowState: input.targetWorkflowState, currentness: expectedCurrentness });
    const createdAt = now(input);
    const reserved = await this.attempts.reserve({ id: randomUUID(), operationKind: identity.operationKind, operationKey: identity.operationKey, payloadHash: identity.payloadHash, projectId: input.projectId, projectVersion: input.projectVersion, currentnessToken: identity.currentness as unknown as Record<string, unknown>, now: createdAt });
    if (reserved.status === "COMMITTED") return committedResultFromRow(reserved, "COMMITTED_REPLAY");
    if (reserved.status === "REJECTED_INVALID" || reserved.status === "REJECTED_STALE") throw new BriefV3TransactionError(reserved.status === "REJECTED_STALE" ? "REJECTED_STALE" : "REJECTED_INVALID", { attemptId: reserved.id });
    const owner = input.ownerId ?? randomUUID();
    const leaseMs = Math.max(1000, Math.min(input.leaseMs ?? this.options.defaultLeaseMs ?? 30000, 300000));
    const leaseExpiresAt = new Date(Date.parse(createdAt) + leaseMs).toISOString();
    const claim = await this.attempts.claim({ attemptId: reserved.id, operationKind: identity.operationKind, operationKey: identity.operationKey, payloadHash: identity.payloadHash, owner, now: createdAt, leaseExpiresAt });
    if (claim.outcome === "IN_PROGRESS_DUPLICATE") throw new BriefV3TransactionError("IN_PROGRESS_DUPLICATE", { attemptId: claim.row.id });
    if (claim.outcome === "COMMITTED_REPLAY") return committedResultFromRow(claim.row, "COMMITTED_REPLAY");
    if (claim.outcome === "TERMINAL_REPLAY") throw new BriefV3TransactionError(claim.row.status === "REJECTED_STALE" ? "REJECTED_STALE" : "REJECTED_INVALID", { attemptId: claim.row.id });
    let settled = false;
    let committed = false;
    const settle = async (to: "FAILED_RETRYABLE" | "REJECTED_INVALID" | "REJECTED_STALE", failureCode: string) => {
      if (settled) return;
      try {
        await this.attempts.transition({ attemptId: claim.row.id, operationKind: identity.operationKind, operationKey: identity.operationKey, payloadHash: identity.payloadHash, from: "PROVIDER_PENDING", to, attemptGeneration: claim.row.attemptGeneration, owner, now: now(input), failureCode });
        settled = true;
      } catch (error) {
        if (!(error instanceof PersistenceError) || error.code !== "PERSISTENCE_CONFLICT") throw error;
      }
    };
    try {
      let beforeProvider: CurrentSnapshot;
      try {
        beforeProvider = await this.readCurrent(input.projectId, input.projectVersion);
      } catch (error) {
        if (error instanceof BriefV3Error) {
          const code = classifyDomainFailure(error);
          await settle("REJECTED_INVALID", code);
          throw new BriefV3TransactionError(code, { attemptId: claim.row.id });
        }
        throw error;
      }
      if (!sameRevisionCurrentness(beforeProvider.currentness, identity.currentness)) {
        await settle("REJECTED_STALE", "STALE_BEFORE_PROVIDER");
        throw new BriefV3TransactionError("STALE_BEFORE_PROVIDER", { attemptId: claim.row.id });
      }
      await input.faults?.hit("before-provider");
      let providerChanges: BriefChangeSet;
      try {
        providerChanges = await this.options.provider.proposeChanges({ revisionInstruction: input.revisionInstruction, currentCanonicalV3: beforeProvider.canonical, supportingContext: input.supportingContext });
        await input.faults?.hit("after-provider");
      } catch (error) {
        const code = classifyProviderFailure(error);
        await settle(code === "PROVIDER_INVALID_OUTPUT" ? "REJECTED_INVALID" : "FAILED_RETRYABLE", code);
        throw new BriefV3TransactionError(code, { attemptId: claim.row.id });
      }
      let changeSet: BriefChangeSet;
      let next: CanonicalBriefV3;
      try {
        changeSet = normalizeBriefChangeSet(parseBriefChangeSet(providerChanges));
        next = applyBriefChangeSet(beforeProvider.canonical, changeSet);
        const history = deriveBriefProvenance(beforeProvider.canonical, next, changeSet, claim.row.id);
        if (history.previousCurrentChecksum !== beforeProvider.currentness.briefChecksum) throw new BriefV3Error("BRIEF_V3_REDUCTION_INVALID", { invariant: "currentness-checksum" });
      } catch (error) {
        const code = classifyDomainFailure(error);
        await settle("REJECTED_INVALID", code);
        throw new BriefV3TransactionError(code, { attemptId: claim.row.id });
      }
      const changed = !isReductionNoOp(beforeProvider.canonical, next);
      const nextChecksum = canonicalBriefChecksum(next);
      const targetState = changed ? input.targetWorkflowState ?? beforeProvider.project.workflow_state : beforeProvider.project.workflow_state;
      if (changed && targetState !== beforeProvider.project.workflow_state) {
        try {
          transitionWorkflow(beforeProvider.project.workflow_state, targetState);
        } catch (error) {
          const code = classifyDomainFailure(error);
          await settle("REJECTED_INVALID", code);
          throw new BriefV3TransactionError(code, { attemptId: claim.row.id });
        }
      }
      const timestamp = now(input);
      const document = changed ? createBriefV3Document({ projectId: input.projectId, projectVersion: input.projectVersion, brief: next, createdAt: timestamp, updatedAt: timestamp }) : null;
      const documentRow = document ? mapDocumentToRow(document) : null;
      const history = changed ? deriveBriefProvenance(beforeProvider.canonical, next, changeSet, claim.row.id) : null;
      const workflowEvent = changed && targetState !== beforeProvider.project.workflow_state ? newWorkflowEvent(input.projectId, input.projectVersion, beforeProvider.project.workflow_state, targetState, input.actor ?? "brief-revision-v3", "Brief Revision V3 committed", identity.operationKey, claim.row.id) : null;
      const projection: BriefRevisionProjectionRow | null = changed && documentRow ? { id: randomUUID(), attemptId: claim.row.id, projectId: input.projectId, projectVersion: input.projectVersion, documentChecksum: documentRow.checksum, status: "PENDING", attemptCount: 0, lastFailureCode: null, nextAttemptAt: null, createdAt: timestamp, updatedAt: timestamp } : null;
      const historyId = history ? randomUUID() : null;
      const result: BriefV3CommittedResult = { outcome: "COMMITTED", projectId: input.projectId, projectVersion: input.projectVersion, attemptId: claim.row.id, changed, currentBriefChecksum: nextChecksum, workflowState: targetState, historyId, projectionStatus: projection ? "PENDING" : "NONE" };
      await input.faults?.hit("before-final-transaction");
      const commitInput: BriefRevisionAtomicCommitInput = { attemptId: claim.row.id, operationKind: identity.operationKind, operationKey: identity.operationKey, payloadHash: identity.payloadHash, leaseOwner: owner, leaseGeneration: claim.row.attemptGeneration, projectId: input.projectId, projectVersion: input.projectVersion, expected: { projectRowVersion: beforeProvider.currentness.projectRowVersion, workflowState: beforeProvider.project.workflow_state, projectVersionRowVersion: beforeProvider.currentness.projectVersionRowVersion, documentType: beforeProvider.currentness.documentType, documentChecksum: beforeProvider.currentness.documentChecksum, documentRowVersion: beforeProvider.currentness.documentRowVersion, briefChecksum: beforeProvider.currentness.briefChecksum }, document: documentRow, history: history && historyId ? { id: historyId, attemptId: claim.row.id, projectId: input.projectId, projectVersion: input.projectVersion, revisionReference: claim.row.id, previousCurrentChecksum: history.previousCurrentChecksum, nextCurrentChecksum: history.nextCurrentChecksum, changeSetChecksum: history.changeSetChecksum, entries: [...history.entries], createdAt: timestamp } : null, workflow: { targetState, event: workflowEvent }, decision: input.decision ? { record: input.decision, revisionAttemptId: claim.row.id } : null, nextBriefChecksum: nextChecksum, changed, result, projection, now: timestamp, fault: input.faults };
      await this.options.database.transaction((tx) => tx.commitBriefRevision(commitInput));
      committed = true;
      await input.faults?.hit("after-db-commit");
      if (this.projectionService) {
        await input.faults?.hit("during-memory-sync");
        await this.projectionService.processPending();
      }
      await input.faults?.hit("before-response");
      return result;
    } catch (error) {
      if (committed) throw error;
      if (error instanceof BriefV3TransactionError) throw error;
      if (error instanceof PersistenceError && error.code === "PERSISTENCE_CONFLICT") {
        await settle("REJECTED_STALE", "STALE_BEFORE_COMMIT");
        throw new BriefV3TransactionError("STALE_BEFORE_COMMIT", { attemptId: claim.row.id });
      }
      if (error instanceof PersistenceError && error.code === "PERSISTENCE_COMMIT_AMBIGUOUS") {
        const authoritative = await this.attempts.get({ operationKind: identity.operationKind, operationKey: identity.operationKey, payloadHash: identity.payloadHash });
        if (authoritative?.status === "COMMITTED") { committed = true; return committedResultFromRow(authoritative, "COMMITTED_REPLAY"); }
        throw new BriefV3TransactionError("PERSISTENCE_FAILED", { attemptId: claim.row.id });
      }
      await settle("FAILED_RETRYABLE", error instanceof PersistenceError ? error.code : "PERSISTENCE_FAILED");
      const providerCode = error instanceof PersistenceError && typeof error.details?.providerCode === "string" ? error.details.providerCode : undefined;
      throw new BriefV3TransactionError("PERSISTENCE_FAILED", { attemptId: claim.row.id, ...(providerCode ? { providerCode } : {}) });
    }
  }

  private async readCurrent(projectId: string, projectVersion: number): Promise<CurrentSnapshot> {
    return this.options.database.transaction(async (tx) => {
      const project = await tx.getProject(projectId);
      const version = await tx.getVersion(projectId, projectVersion);
      if (!project || !version || project.current_version !== projectVersion) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The V3 project version was not found.");
      const v3Row = await tx.getDocument(projectId, projectVersion, BRIEF_V3_DOCUMENT_TYPE);
      const documentRow = v3Row ?? await tx.getDocument(projectId, projectVersion, "requirements");
      if (!documentRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "A current Brief document was not found.");
      const stored = mapRowToDocument(documentRow);
      const canonical = stored.documentType === BRIEF_V3_DOCUMENT_TYPE ? BriefV3DocumentSchema.parse(stored).brief : migrateLegacyBriefToCanonicalBriefV3(stored);
      const currentness = createRevisionCurrentnessToken({ projectId, projectVersion, projectRowVersion: Number(project.row_version), projectVersionRowVersion: version.rowVersion, workflowState: project.workflow_state, documentType: documentRow.documentType, briefChecksum: canonicalBriefChecksum(canonical), documentChecksum: documentRow.checksum, documentRowVersion: documentRow.rowVersion });
      return { project, version, documentRow, canonical, currentness };
    });
  }
}
