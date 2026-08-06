import { z } from "zod";
import { SelectedDesignSchema } from "../domain/design/schema";
import { FactoryProjectSchema, type FactoryProject } from "../domain/project/schema";
import type { WorkflowState } from "../domain/workflow/engine";
import { ClarificationSessionSchema, type ClarificationSession } from "../domain/requirements/schema";
import { QualityReportSchema } from "../domain/quality/schema";
import { ReleaseReportSchema } from "../domain/release/schema";
import { DecisionRecordSchema, type DecisionRecord } from "../domain/workflow/decision";
import { transitionWorkflow, type TransitionContext } from "../domain/workflow/engine";
import { PersistenceError } from "./errors";
import { mapDocumentToRow, mapProjectToRow, mapRowToDocument, mapRowToProject } from "./mapping";
import { documentPayloadHash, newWorkflowEvent } from "./fake";
import type { PersistenceDatabase, PersistenceTransaction, ProjectVersionRow, StoredDocument, WorkflowEvent, CostRecord } from "./types";

const parse = <T>(schema: z.ZodType<T>, value: unknown, message: string): T => { const result = schema.safeParse(value); if (!result.success) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", message, undefined, result.error); return result.data; };
const token = (key: string | undefined, payload: unknown) => key ? { key, payloadHash: documentPayloadHash(payload) } : undefined;

export class ProjectRepository {
  constructor(private readonly db: PersistenceDatabase) {}
  async create(project: FactoryProject, idempotencyKey?: string) { const parsed = parse(FactoryProjectSchema, project, "Project does not match its domain contract."); return this.db.transaction((tx) => tx.insertProject(mapProjectToRow(parsed), token(idempotencyKey, parsed))).then(mapRowToProject); }
  async get(id: string) { return this.db.transaction(async (tx) => { const row = await tx.getProject(id); return row ? mapRowToProject(row) : null; }); }
  async getWithVersion(id: string) { return this.db.transaction(async (tx) => { const row = await tx.getProject(id); return row ? { project: mapRowToProject(row), rowVersion: row.row_version } : null; }); }
}

export class ProjectVersionRepository {
  constructor(private readonly db: PersistenceDatabase) {}
  async create(row: ProjectVersionRow, idempotencyKey?: string) { if (row.versionNumber < 1) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Project version must be positive."); return this.db.transaction((tx) => tx.insertVersion(row, token(idempotencyKey, row))); }
  async get(projectId: string, version: number) { return this.db.transaction((tx) => tx.getVersion(projectId, version)); }
  async list(projectId: string) { return this.db.transaction((tx) => tx.listVersions(projectId)); }
  async getVersion(projectId: string, version: number) { return this.get(projectId, version); }
  async listVersions(projectId: string) { return this.list(projectId); }
  async reserveNextVersion(projectId: string, idempotencyKey?: string) { return this.db.transaction((tx) => tx.reserveNextVersion(projectId, token(idempotencyKey, { projectId }))); }
  async markImmutable(projectId: string, version: number, releasedAt: string) { return this.db.transaction((tx) => tx.updateVersionImmutable(projectId, version, releasedAt)); }
}

export class DocumentRepository {
  constructor(private readonly db: PersistenceDatabase) {}
  async save(document: StoredDocument, idempotencyKey?: string) { const row = mapDocumentToRow(document); if (document.documentType === "design-directions" && document.directions.length !== 3) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "A design direction set must contain exactly three directions."); return this.db.transaction(async (tx) => { const version = await tx.getVersion(document.projectId, document.projectVersion); if (version?.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Released project versions are immutable."); return mapRowToDocument(await tx.saveDocument(row, token(idempotencyKey, document))); }); }
  async get(projectId: string, version: number, documentType: string) { return this.db.transaction(async (tx) => { const row = await tx.getDocument(projectId, version, documentType); return row ? mapRowToDocument(row) : null; }); }
  async delete(projectId: string, version: number, documentType: string) { return this.db.transaction((tx) => tx.deleteDocument(projectId, version, documentType)); }
}

export class DesignRepository extends DocumentRepository {
  async select(document: StoredDocument, idempotencyKey?: string) {
    if (document.documentType !== "selected-design") throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Only a selected-design document can be selected.");
    const selected = parse(SelectedDesignSchema, document, "Selected design is invalid.");
    const directionSet = await this.get(selected.projectId, selected.projectVersion, "design-directions");
    if (!directionSet || directionSet.documentType !== "design-directions" || directionSet.setId !== selected.directionSetId || !directionSet.directions.some((direction) => direction.id === selected.selectedDirectionId)) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Selected design does not belong to the current three-direction set.");
    return this.save(selected, idempotencyKey);
  }
}

export class ClarificationRepository extends DocumentRepository {
  async saveSession(session: ClarificationSession, idempotencyKey?: string) { return this.save(parse(ClarificationSessionSchema, session, "Clarification session is invalid."), idempotencyKey); }
  async getSession(projectId: string, version: number) { const document = await this.get(projectId, version, "clarification-log"); return document?.documentType === "clarification-log" ? document : null; }
  async hasBlockingUnresolved(projectId: string, version: number) { const session = await this.getSession(projectId, version); return session?.questions.some((question) => question.blocking && question.answerStatus === "unresolved") ?? false; }
}

export class DecisionRepository {
  constructor(private readonly db: PersistenceDatabase) {}
  async append(projectId: string, version: number, record: DecisionRecord) { const parsed = parse(DecisionRecordSchema, record, "Decision does not match its domain contract."); return this.db.transaction(async (tx) => { const versionRow = await tx.getVersion(projectId, version); if (versionRow?.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Released project versions are immutable."); return tx.appendDecision(projectId, version, parsed); }); }
  async list(projectId: string, version: number) { return this.db.transaction((tx) => tx.listDecisions(projectId, version)); }
}

export class WorkflowPersistenceService {
  constructor(private readonly db: PersistenceDatabase) {}
  async transition(input: { projectId: string; projectVersion: number; expectedState: WorkflowState; expectedRowVersion: number; targetState: WorkflowState; actor: string; reason: string; context?: TransitionContext; idempotencyKey?: string }) {
    return this.db.transaction(async (tx) => {
      const current = await tx.getProject(input.projectId); if (!current) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found.");
      if (current.current_version !== input.projectVersion || current.workflow_state !== input.expectedState || current.row_version !== input.expectedRowVersion) throw new PersistenceError("PERSISTENCE_CONFLICT", "The workflow state is stale.");
      transitionWorkflow(input.expectedState, input.targetState, input.context);
      const timestamp = new Date().toISOString();
      const updated = await tx.updateProjectState({ id: input.projectId, expectedState: input.expectedState, expectedRowVersion: input.expectedRowVersion, state: input.targetState, updatedAt: timestamp, ...(input.targetState === "IMPLEMENTING" ? { implementationStartedAt: timestamp } : {}), ...(input.targetState === "PROJECT_READY" ? { completedAt: timestamp } : {}) });
      await tx.appendWorkflowEvent(newWorkflowEvent(input.projectId, input.projectVersion, input.expectedState, input.targetState, input.actor, input.reason, input.idempotencyKey));
      return { project: mapRowToProject(updated), rowVersion: updated.row_version };
    });
  }
}

export class ReleaseRepository {
  constructor(private readonly db: PersistenceDatabase) {}
  async create(projectId: string, version: number, report: z.input<typeof ReleaseReportSchema>) {
    const parsed = parse(ReleaseReportSchema, report, "Release report does not match its domain contract.");
    if (!parsed.ready) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Release report is not ready.");
    return this.db.transaction(async (tx) => { const project = await tx.getProject(projectId); const versionRow = await tx.getVersion(projectId, version); if (!project || !versionRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project version was not found."); if (versionRow.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Released project versions are immutable."); parse(QualityReportSchema, parsed.qualityReport, "Quality report is invalid."); if (parsed.knownErrors.length || parsed.qualityReport.knownErrors.length) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Known errors prevent release."); transitionWorkflow(project.workflow_state, "PROJECT_READY", { qualityReport: parsed.qualityReport, releaseReport: parsed }); const timestamp = parsed.releasedAt ?? new Date().toISOString(); await tx.saveDocument(mapDocumentToRow(parsed)); await tx.updateProjectState({ id: projectId, expectedState: project.workflow_state, expectedRowVersion: project.row_version, state: "PROJECT_READY", updatedAt: timestamp, completedAt: timestamp }); await tx.updateVersionImmutable(projectId, version, timestamp); await tx.appendWorkflowEvent(newWorkflowEvent(projectId, version, project.workflow_state, "PROJECT_READY", parsed.releasedBy ?? "system", "Release report accepted")); return parsed; });
  }
}

export class CostRepository { constructor(private readonly db: PersistenceDatabase) {} async append(record: CostRecord) { if (record.inputTokens < 0 || record.cachedInputTokens < 0 || record.outputTokens < 0 || record.estimatedCost < 0) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Cost values cannot be negative."); return this.db.transaction((tx) => tx.saveCost(record)); } }

export type { PersistenceTransaction, WorkflowEvent };
