import { randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateBriefReadiness } from "@/domain/requirements/v3/readiness";
import { transitionWorkflow } from "@/domain/workflow/engine";
import { WorkflowStateSchema } from "@/domain/project/schema";
import { migrateLegacyBriefToCanonicalBriefV3, migrateLegacyBriefToCanonicalBriefV3WithLineage } from "@/domain/requirements/v3/migrate";
import { canonicalRequirementEntries, isLegacyRequirementId } from "@/domain/requirements/v3/identity";
import type { RequirementIdentityLineage } from "@/domain/requirements/v3/identity";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { BriefV3DocumentSchema, canonicalBriefChecksumForDocument, createBriefV3Document, type BriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { mapDocumentToRow, mapRowToDocument } from "@/persistence/database/mapping";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { PersistenceDatabase, ProjectRow, ProjectVersionRow } from "@/persistence/database/types";
import { newWorkflowEvent } from "@/persistence/database/workflow-events";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const BriefApprovalCurrentnessSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  workflowState: WorkflowStateSchema,
  documentType: z.enum(["brief-v3", "requirements"]),
  documentChecksum: Sha256Schema,
  documentRowVersion: z.number().int().positive(),
  briefChecksum: Sha256Schema,
}).strict();
export type BriefApprovalCurrentness = z.infer<typeof BriefApprovalCurrentnessSchema>;

export type BriefApprovalInput = {
  projectId: string;
  projectVersion: number;
  briefChecksum: string;
  expectedRowVersion: number;
  approvedBy: string;
  approvalNote?: string;
  idempotencyKey?: string;
  expectedCurrentness?: BriefApprovalCurrentness;
};

const BriefApprovalInputSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  briefChecksum: Sha256Schema,
  expectedRowVersion: z.number().int().positive(),
  approvedBy: z.string().trim().min(1),
  approvalNote: z.string().max(4000).optional(),
  idempotencyKey: z.string().min(1).optional(),
  expectedCurrentness: BriefApprovalCurrentnessSchema.optional(),
}).strict();

export type BriefApprovalResult = {
  projectId: string;
  projectVersion: number;
  projectState: "AWAITING_PLANNING_GENERATION";
  rowVersion: number;
  briefChecksum: string;
  documentChecksum: string;
  approved: true;
  projectionStatus: "SYNCED" | "UNAVAILABLE";
};

export type BriefV3AdmissionInput = {
  projectId: string;
  projectVersion: number;
  expectedRowVersion: number;
};

const BriefV3AdmissionInputSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  expectedRowVersion: z.number().int().positive(),
}).strict();

export type BriefV3AdmissionResult = {
  projectId: string;
  projectVersion: number;
  projectState: "AWAITING_BRIEF_APPROVAL";
  rowVersion: number;
  briefChecksum: string;
  documentChecksum: string;
  documentRowVersion: number;
  approved: false;
  created: boolean;
  projectionStatus: "SYNCED" | "UNAVAILABLE";
};

export class BriefApprovalError extends Error {
  constructor(public readonly code: "BRIEF_NOT_FOUND" | "BRIEF_NOT_READY" | "BRIEF_CHECKSUM_MISMATCH" | "BRIEF_APPROVAL_STALE" | "BRIEF_APPROVAL_WORKFLOW_INVALID" | "BRIEF_ALREADY_APPROVED" | "BRIEF_APPROVAL_IN_PROGRESS" | "BRIEF_APPROVAL_PROJECTION_FAILED", message: string) {
    super(message);
    this.name = "BriefApprovalError";
  }
}

const sameCurrentness = (left: BriefApprovalCurrentness, right: BriefApprovalCurrentness) => JSON.stringify(left) === JSON.stringify(right);

function requireCurrentIdentity(document: BriefV3Document): BriefV3Document {
  if (canonicalRequirementEntries(document.brief).some((entry) => isLegacyRequirementId(entry.id))) throw new BriefApprovalError("BRIEF_NOT_READY", "The current Brief requires explicit requirement identity migration before approval.");
  return document;
}

function currentness(project: ProjectRow, version: ProjectVersionRow, row: import("@/persistence/database/mapping").DocumentRow, document: BriefV3Document): BriefApprovalCurrentness {
  return BriefApprovalCurrentnessSchema.parse({
    projectId: project.id,
    projectVersion: project.current_version,
    projectRowVersion: project.row_version,
    projectVersionRowVersion: version.rowVersion,
    workflowState: project.workflow_state,
    documentType: row.documentType === "requirements" ? "requirements" : "brief-v3",
    documentChecksum: row.checksum,
    documentRowVersion: row.rowVersion,
    briefChecksum: canonicalBriefChecksumForDocument(document),
  });
}

export class BriefApprovalService {
  constructor(private readonly options: { database: PersistenceDatabase; projection?: ProjectMemorySyncPort }) {}

  /**
   * Materializes a legacy Brief as the current canonical V3 document without
   * approving it or advancing the workflow. The legacy document remains
   * immutable source evidence; a concurrent V3 insert fails closed through
   * the document CAS boundary and a repeated call reads the existing V3 row.
   */
  async admitCurrentBrief(input: BriefV3AdmissionInput): Promise<BriefV3AdmissionResult> {
    const request = BriefV3AdmissionInputSchema.parse(input);
    const committed = await this.options.database.transaction(async (tx) => {
      const project = await tx.getProject(request.projectId);
      const version = await tx.getVersion(request.projectId, request.projectVersion);
      const v3Row = await tx.getDocument(request.projectId, request.projectVersion, "brief-v3");
      const legacyRow = await tx.getDocument(request.projectId, request.projectVersion, "requirements");
      const row = v3Row ?? legacyRow;
      if (!project || !version || !row) throw new BriefApprovalError("BRIEF_NOT_FOUND", "The current Project Brief was not found.");
      if (project.current_version !== request.projectVersion || project.row_version !== request.expectedRowVersion) throw new BriefApprovalError("BRIEF_APPROVAL_STALE", "The Project Brief currentness is stale.");
      if (project.workflow_state !== "AWAITING_BRIEF_APPROVAL") throw new BriefApprovalError("BRIEF_APPROVAL_WORKFLOW_INVALID", "The project is not awaiting Brief approval.");

      if (row.documentType === "brief-v3") {
        const document = requireCurrentIdentity(BriefV3DocumentSchema.parse(mapRowToDocument(row)));
        if (document.approval?.approved) throw new BriefApprovalError("BRIEF_ALREADY_APPROVED", "The current Project Brief is already approved.");
        return {
          result: {
            projectId: project.id,
            projectVersion: request.projectVersion,
            projectState: "AWAITING_BRIEF_APPROVAL" as const,
            rowVersion: project.row_version,
            briefChecksum: document.briefChecksum,
            documentChecksum: row.checksum,
            documentRowVersion: row.rowVersion,
            approved: false as const,
            created: false,
            projectionStatus: this.options.projection ? "SYNCED" as const : "UNAVAILABLE" as const,
          },
          document: null as BriefV3Document | null,
        };
      }

      const stored = mapRowToDocument(row);
      const migrated = migrateLegacyBriefToCanonicalBriefV3WithLineage(stored);
      const document = createBriefV3Document({ projectId: request.projectId, projectVersion: request.projectVersion, brief: migrated.brief, createdAt: stored.createdAt, updatedAt: stored.updatedAt });
      const saved = await tx.saveDocumentCAS({ row: mapDocumentToRow(document), expectedRowVersion: null, expectedChecksum: null });
      for (const lineage of migrated.lineage) await tx.appendRequirementIdentityLineage({ ...lineage, createdAt: stored.updatedAt });
      return {
        result: {
          projectId: project.id,
          projectVersion: request.projectVersion,
          projectState: "AWAITING_BRIEF_APPROVAL" as const,
          rowVersion: project.row_version,
          briefChecksum: document.briefChecksum,
          documentChecksum: saved.checksum,
          documentRowVersion: saved.rowVersion,
          approved: false as const,
          created: true,
          projectionStatus: this.options.projection ? "SYNCED" as const : "UNAVAILABLE" as const,
        },
        document,
      };
    });

    if (committed.document && this.options.projection) {
      try {
        await this.options.projection.writeVersionSnapshot(request.projectId, request.projectVersion, { "brief-v3.json": committed.document });
      } catch {
        throw new BriefApprovalError("BRIEF_APPROVAL_PROJECTION_FAILED", "The canonical Brief was persisted, but its derived Project Memory projection failed.");
      }
    }
    return committed.result;
  }

  async approve(input: BriefApprovalInput): Promise<BriefApprovalResult> {
    const request = BriefApprovalInputSchema.parse(input);
    const operation = "brief-approval-v3";
    const operationKey = request.idempotencyKey ?? `brief-approval-v3:${request.projectId}:${request.briefChecksum}`;
    const payload = { ...request, expectedCurrentness: request.expectedCurrentness ?? null };
    const committed = await this.options.database.transaction(async (tx) => {
      const payloadHash = checksumPersistedDocument(payload);
      const reservation = await tx.reserveOperation({ operation, key: operationKey, payloadHash });
      if (reservation.status === "IN_PROGRESS") throw new BriefApprovalError("BRIEF_APPROVAL_IN_PROGRESS", "Brief approval is already in progress.");
      if (reservation.status === "SUCCEEDED") {
        const replayRow = await tx.getDocument(request.projectId, request.projectVersion, "brief-v3");
        const replayDocument = replayRow ? BriefV3DocumentSchema.parse(mapRowToDocument(replayRow)) : null;
        return { result: reservation.result as BriefApprovalResult, document: replayDocument, replay: true };
      }

      const project = await tx.getProject(request.projectId);
      const version = await tx.getVersion(request.projectId, request.projectVersion);
      const row = (await tx.getDocument(request.projectId, request.projectVersion, "brief-v3")) ?? (await tx.getDocument(request.projectId, request.projectVersion, "requirements"));
      if (!project || !version || !row) throw new BriefApprovalError("BRIEF_NOT_FOUND", "The current Project Brief was not found.");
      const stored = mapRowToDocument(row);
      let migrationLineage: readonly RequirementIdentityLineage[] = [];
      const document = stored.documentType === "brief-v3"
        ? requireCurrentIdentity(BriefV3DocumentSchema.parse(stored))
        : (() => {
            const migrated = migrateLegacyBriefToCanonicalBriefV3WithLineage(stored);
            migrationLineage = migrated.lineage;
            return createBriefV3Document({ projectId: request.projectId, projectVersion: request.projectVersion, brief: migrated.brief, createdAt: stored.createdAt, updatedAt: stored.updatedAt });
          })();
      const token = currentness(project, version, row, document);
      if (project.current_version !== request.projectVersion || project.row_version !== request.expectedRowVersion || request.projectId !== token.projectId || request.projectVersion !== token.projectVersion) throw new BriefApprovalError("BRIEF_APPROVAL_STALE", "The Project Brief currentness is stale.");
      if (request.expectedCurrentness && !sameCurrentness(request.expectedCurrentness, token)) throw new BriefApprovalError("BRIEF_APPROVAL_STALE", "The Project Brief currentness is stale.");
      if (request.briefChecksum !== token.briefChecksum && request.briefChecksum !== token.documentChecksum) throw new BriefApprovalError("BRIEF_CHECKSUM_MISMATCH", "The Project Brief checksum is stale.");
      if (!["CLARIFYING", "AWAITING_BRIEF_APPROVAL"].includes(project.workflow_state)) throw new BriefApprovalError("BRIEF_APPROVAL_WORKFLOW_INVALID", "The project is not in a Brief-approval lifecycle state.");
      if (document.approval?.approved) throw new BriefApprovalError("BRIEF_ALREADY_APPROVED", "The current Project Brief is already approved.");

      const clarificationRow = await tx.getDocument(input.projectId, input.projectVersion, "clarification-log");
      const clarificationDocument = clarificationRow ? mapRowToDocument(clarificationRow) : null;
      const readiness = evaluateBriefReadiness({
        brief: document.brief,
        clarificationSession: clarificationDocument?.documentType === "clarification-log" ? { questions: clarificationDocument.questions } : undefined,
      });
      if (!readiness.readyForApproval || readiness.approvalBlockers.length > 0) throw new BriefApprovalError("BRIEF_NOT_READY", "The current Project Brief is not ready for explicit approval.");

      const approvedAt = new Date().toISOString();
      const approvedDocument = BriefV3DocumentSchema.parse({
        ...document,
        updatedAt: approvedAt,
        approval: {
          approved: true,
          approvedAt,
          approvedBy: request.approvedBy,
          approvedCanonicalChecksum: token.briefChecksum,
          ...(request.approvalNote ? { approvalNote: request.approvalNote } : {}),
        },
      });
      transitionWorkflow(project.workflow_state, "AWAITING_PLANNING_GENERATION", { briefApproval: { approved: true, canonicalChecksum: token.briefChecksum } });
      const updatedProject = await tx.updateProjectState({ id: project.id, expectedState: project.workflow_state, expectedRowVersion: project.row_version, state: "AWAITING_PLANNING_GENERATION", updatedAt: approvedAt });
      const saved = await tx.saveDocumentCAS({ row: mapDocumentToRow(approvedDocument), expectedRowVersion: row.documentType === "brief-v3" ? row.rowVersion : null, expectedChecksum: row.documentType === "brief-v3" ? row.checksum : null });
      for (const lineage of migrationLineage) await tx.appendRequirementIdentityLineage({ ...lineage, createdAt: approvedAt });
      const decision = DecisionRecordSchema.parse({
        id: randomUUID(),
        timestamp: approvedAt,
        actorType: "user",
        actorIdentifier: request.approvedBy,
        category: "brief-approval",
        decision: "Project Brief approved by user.",
        rationale: "Explicit user approval accepted by the host-owned V3 readiness and currentness path.",
        affectedDocuments: ["brief-v3.json"],
        requirementChange: false,
        userApprovalRequired: false,
        userApprovalStatus: "not-required",
      });
      await tx.appendDecision(project.id, request.projectVersion, decision);
      await tx.appendWorkflowEvent(newWorkflowEvent(project.id, request.projectVersion, project.workflow_state, "AWAITING_PLANNING_GENERATION", request.approvedBy, "User approved the current CanonicalBriefV3; Planning generation is now eligible.", operationKey));
      const result: BriefApprovalResult = { projectId: project.id, projectVersion: request.projectVersion, projectState: "AWAITING_PLANNING_GENERATION", rowVersion: updatedProject.row_version, briefChecksum: token.briefChecksum, documentChecksum: saved.checksum, approved: true, projectionStatus: this.options.projection ? "SYNCED" : "UNAVAILABLE" };
      await tx.completeOperation({ operation, key: operationKey, payloadHash, result });
      return { result, document: approvedDocument, replay: false };
    });

    if (committed.document && this.options.projection) {
      try {
        await this.options.projection.writeVersionSnapshot(request.projectId, request.projectVersion, { "brief-v3.json": committed.document });
      } catch {
        throw new BriefApprovalError("BRIEF_APPROVAL_PROJECTION_FAILED", "The approved Brief was persisted, but its derived Project Memory projection failed.");
      }
    }
    return committed.result;
  }

  async readCurrentness(projectId: string, projectVersion: number): Promise<BriefApprovalCurrentness> {
    return this.options.database.transaction(async (tx) => {
      const project = await tx.getProject(projectId);
      const version = await tx.getVersion(projectId, projectVersion);
      const row = (await tx.getDocument(projectId, projectVersion, "brief-v3")) ?? (await tx.getDocument(projectId, projectVersion, "requirements"));
      if (!project || !version || !row) throw new BriefApprovalError("BRIEF_NOT_FOUND", "The current V3 Project Brief was not found.");
      const stored = mapRowToDocument(row);
      const document = stored.documentType === "brief-v3"
        ? requireCurrentIdentity(BriefV3DocumentSchema.parse(stored))
        : createBriefV3Document({ projectId, projectVersion, brief: migrateLegacyBriefToCanonicalBriefV3(stored), createdAt: stored.createdAt, updatedAt: stored.updatedAt });
      return currentness(project, version, row, document);
    });
  }
}
