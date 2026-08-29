import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  planningDocumentChecksum,
  planningSemanticChecksum,
  planningSemanticChecksumForPolicy,
} from "@/agents/planner/deterministic";
import { PlanningPackageSchema, type PlanningPackage } from "@/agents/planner/contracts";
import {
  PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT,
  PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY,
} from "@/agents/planner/checksum-policy";
import { canonicalRequirementEntries, isLegacyRequirementId, isV3RequirementId } from "@/domain/requirements/v3/identity";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { DecisionRecordSchema, type DecisionRecord } from "@/domain/workflow/decision";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapDocumentToRow, mapRowToDocument, type DocumentRow } from "@/persistence/database/mapping";
import { appendDecisionInTransaction } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { PersistenceError } from "@/persistence/database/errors";
import type { PersistenceDatabase, ProjectRow, ProjectVersionRow } from "@/persistence/database/types";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";

export const PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_OPERATION = "planning-semantic-checksum-recertification-v1" as const;
export const PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_ACTOR = "host-owned-planning-semantic-checksum-recertification" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RecertificationInputSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  expectedProjectWorkflowState: z.literal("AWAITING_DESIGN_SELECTION"),
  expectedProjectRowVersion: z.number().int().positive(),
  expectedProjectVersionRowVersion: z.number().int().positive(),
  expectedBriefRowVersion: z.number().int().positive(),
  expectedPlanningRowVersion: z.number().int().positive(),
  expectedBriefChecksum: Sha256Schema,
  expectedBriefDocumentChecksum: Sha256Schema,
  expectedPlanningDocumentChecksum: Sha256Schema,
  expectedPlanningLegacySemanticChecksum: Sha256Schema,
  targetPlanningSemanticChecksum: Sha256Schema,
  expectedSelectedDesignChecksum: Sha256Schema.nullable(),
  expectedArchitectureChecksum: Sha256Schema.nullable(),
  now: z.string().datetime({ offset: true }).optional(),
}).strict();

export type PlanningSemanticChecksumRecertificationInput = z.infer<typeof RecertificationInputSchema>;

const RecertificationResultSchema = z.object({
  operationKey: z.string().min(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  previousPlanningDocumentChecksum: Sha256Schema,
  nextPlanningDocumentChecksum: Sha256Schema,
  previousPlanningLegacySemanticChecksum: Sha256Schema,
  preparedTargetPlanningSemanticChecksum: Sha256Schema,
  actualCommittedPlanningSemanticChecksum: Sha256Schema,
  previousPlanningRowVersion: z.number().int().positive(),
  nextPlanningRowVersion: z.number().int().positive(),
  decisionId: z.string().uuid(),
}).strict();

export type PlanningSemanticChecksumRecertificationResult = z.infer<typeof RecertificationResultSchema> & {
  outcome: "COMMITTED" | "COMMITTED_REPLAY";
  projectionStatus: "SYNCED" | "UNAVAILABLE";
};

export class PlanningSemanticChecksumRecertificationError extends Error {
  constructor(readonly code: "PLANNING_CHECKSUM_RECERTIFICATION_STALE" | "PLANNING_CHECKSUM_RECERTIFICATION_INVALID" | "PLANNING_CHECKSUM_RECERTIFICATION_IN_PROGRESS" | "PLANNING_CHECKSUM_RECERTIFICATION_READBACK_MISMATCH" | "PLANNING_CHECKSUM_RECERTIFICATION_PROJECTION_FAILED", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlanningSemanticChecksumRecertificationError";
  }
}

function planningRequirementReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(planningRequirementReferences);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => key === "requirementReferences"
    ? (Array.isArray(child) ? child.filter((item): item is string => typeof item === "string") : [])
    : planningRequirementReferences(child));
}

function operationKey(input: PlanningSemanticChecksumRecertificationInput) {
  return `${PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_OPERATION}:${input.projectId}:${input.projectVersion}:${input.expectedPlanningDocumentChecksum}:${input.targetPlanningSemanticChecksum}`;
}

function payload(input: PlanningSemanticChecksumRecertificationInput) {
  const stableInput = { ...input };
  delete stableInput.now;
  return stableInput;
}

function currentnessError(message: string): PlanningSemanticChecksumRecertificationError {
  return new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_STALE", message);
}

function invalidError(message: string): PlanningSemanticChecksumRecertificationError {
  return new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_INVALID", message);
}

function assertCurrentness(input: PlanningSemanticChecksumRecertificationInput, project: ProjectRow, version: ProjectVersionRow, briefRow: DocumentRow, planningRow: DocumentRow, brief: z.infer<typeof BriefV3DocumentSchema>, planning: PlanningPackage) {
  if (project.current_version !== input.projectVersion || project.workflow_state !== input.expectedProjectWorkflowState || project.row_version !== input.expectedProjectRowVersion)
    throw currentnessError("The project currentness token is stale.");
  if (version.rowVersion !== input.expectedProjectVersionRowVersion || version.requirementsChecksum !== input.expectedBriefChecksum || version.selectedDesignChecksum !== input.expectedSelectedDesignChecksum || version.architectureChecksum !== input.expectedArchitectureChecksum)
    throw currentnessError("The Project Version currentness token is stale.");
  if (briefRow.rowVersion !== input.expectedBriefRowVersion || briefRow.checksum !== input.expectedBriefDocumentChecksum || brief.briefChecksum !== input.expectedBriefChecksum || canonicalBriefChecksum(brief.brief) !== input.expectedBriefChecksum || !brief.approval?.approved || brief.approval.approvedCanonicalChecksum !== input.expectedBriefChecksum)
    throw currentnessError("The approved Brief currentness token is stale.");
  if (planningRow.rowVersion !== input.expectedPlanningRowVersion || planningRow.checksum !== input.expectedPlanningDocumentChecksum)
    throw currentnessError("The Planning document currentness token is stale.");
  if (planning.semanticChecksumPolicyVersion === PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT)
    throw invalidError("The Planning package already uses the current semantic checksum policy.");
  if (planningSemanticChecksumForPolicy(planning, PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY) !== input.expectedPlanningLegacySemanticChecksum)
    throw currentnessError("The historical Planning semantic checksum is stale.");
  if (planningSemanticChecksumForPolicy(planning, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT) !== input.targetPlanningSemanticChecksum)
    throw invalidError("The current Planning content does not match the prepared corrected semantic target.");
  if (planning.accepted || planning.architecture.acceptance.accepted)
    throw invalidError("Planning acceptance cannot be changed by checksum recertification.");
  const briefIds = new Set(canonicalRequirementEntries(brief.brief).map((entry) => entry.id));
  const references = planningRequirementReferences(planning);
  if (references.some(isLegacyRequirementId)) throw invalidError("The Planning package contains a legacy requirement reference.");
  if (references.some((reference) => isV3RequirementId(reference) && !briefIds.has(reference))) throw invalidError("The Planning package contains an unresolved V3 requirement reference.");
}

function auditDecision(input: PlanningSemanticChecksumRecertificationInput, result: Omit<z.infer<typeof RecertificationResultSchema>, "decisionId"> & { decisionId: string }, timestamp: string): DecisionRecord {
  return DecisionRecordSchema.parse({
    id: result.decisionId,
    timestamp,
    actorType: "system",
    actorIdentifier: PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_ACTOR,
    category: "planning-semantic-checksum-recertification",
    decision: "Re-certified current Planning semantic checksum under the host-owned semantic-only policy.",
    rationale: [
      `operation=${result.operationKey}`,
      `projectVersion=${input.projectVersion}`,
      `previousPlanningDocumentChecksum=${result.previousPlanningDocumentChecksum}`,
      `nextPlanningDocumentChecksum=${result.nextPlanningDocumentChecksum}`,
      `previousPlanningLegacySemanticChecksum=${result.previousPlanningLegacySemanticChecksum}`,
      `preparedTargetPlanningSemanticChecksum=${result.preparedTargetPlanningSemanticChecksum}`,
      `actualCommittedPlanningSemanticChecksum=${result.actualCommittedPlanningSemanticChecksum}`,
      `fromPolicy=${PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY}`,
      `toPolicy=${PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT}`,
      "planningAcceptancePreserved=false",
      "downstreamPromotion=false",
    ].join("; "),
    affectedDocuments: ["planning-package.json"],
    requirementChange: false,
    userApprovalRequired: false,
    userApprovalStatus: "not-required",
  });
}

export class PlanningSemanticChecksumRecertificationService {
  constructor(private readonly options: { database: PersistenceDatabase; projection?: ProjectMemorySyncPort; clock?: () => string }) {}

  async recertify(rawInput: PlanningSemanticChecksumRecertificationInput): Promise<PlanningSemanticChecksumRecertificationResult> {
    const input = RecertificationInputSchema.parse(rawInput);
    const key = operationKey(input);
    const payloadHash = checksumPersistedDocument(payload(input));
    const committed = await this.options.database.transaction(async (tx) => {
      const reservation = await tx.reserveOperation({ operation: PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_OPERATION, key, payloadHash });
      if (reservation.status === "IN_PROGRESS") throw new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_IN_PROGRESS", "The Planning checksum recertification is already in progress.");
      if (reservation.status === "SUCCEEDED") {
        const result = RecertificationResultSchema.parse(reservation.result);
        const row = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
        const decision = (await tx.listDecisions(input.projectId, input.projectVersion)).find((candidate) => candidate.id === result.decisionId);
        if (!row || !decision || row.rowVersion !== result.nextPlanningRowVersion || row.checksum !== result.nextPlanningDocumentChecksum)
          throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The committed Planning checksum recertification evidence is incomplete.");
        return { result, document: PlanningPackageSchema.parse(mapRowToDocument(row)), decision, replay: true as const };
      }

      const project = await tx.getProject(input.projectId);
      const version = await tx.getVersion(input.projectId, input.projectVersion);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      if (!project || !version || !briefRow || !planningRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The current Planning recertification state is incomplete.");
      const briefDocument = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
      assertCurrentness(input, project, version, briefRow, planningRow, briefDocument, planning);
      const now = input.now ?? new Date().toISOString();
      const nextPlanning = PlanningPackageSchema.parse({
        ...planning,
        semanticChecksumPolicyVersion: PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT,
        accepted: false,
        acceptance: {},
        architecture: { ...planning.architecture, acceptance: { accepted: false } },
        updatedAt: now,
      });
      const savedRow = await tx.saveDocumentCAS({ row: mapDocumentToRow(nextPlanning), expectedRowVersion: planningRow.rowVersion, expectedChecksum: planningRow.checksum });
      const readbackRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      if (!readbackRow) throw new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_READBACK_MISMATCH", "The recertified Planning package was not returned by persistence.");
      const readback = PlanningPackageSchema.parse(mapRowToDocument(readbackRow));
      const actualDocumentChecksum = planningDocumentChecksum(readback);
      const actualSemanticChecksum = planningSemanticChecksum(readback);
      if (readbackRow.rowVersion !== planningRow.rowVersion + 1 || readbackRow.checksum !== actualDocumentChecksum || actualSemanticChecksum !== input.targetPlanningSemanticChecksum || readback.semanticChecksumPolicyVersion !== PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT || readback.accepted || readback.architecture.acceptance.accepted)
        throw new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_READBACK_MISMATCH", "The committed Planning package does not match the corrected semantic target.");
      if (planningSemanticChecksumForPolicy(readback, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT) !== planningSemanticChecksumForPolicy(nextPlanning, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT))
        throw new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_READBACK_MISMATCH", "The committed Planning semantic projection differs from the prepared target.");
      const resultWithoutDecision = {
        operationKey: key,
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        previousPlanningDocumentChecksum: planningRow.checksum,
        nextPlanningDocumentChecksum: savedRow.checksum,
        previousPlanningLegacySemanticChecksum: input.expectedPlanningLegacySemanticChecksum,
        preparedTargetPlanningSemanticChecksum: input.targetPlanningSemanticChecksum,
        actualCommittedPlanningSemanticChecksum: actualSemanticChecksum,
        previousPlanningRowVersion: planningRow.rowVersion,
        nextPlanningRowVersion: readbackRow.rowVersion,
      };
      const decision = auditDecision(input, { ...resultWithoutDecision, decisionId: randomUUID() }, now);
      const result = RecertificationResultSchema.parse({ ...resultWithoutDecision, decisionId: decision.id });
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
      await tx.completeOperation({ operation: PLANNING_SEMANTIC_CHECKSUM_RECERTIFICATION_OPERATION, key, payloadHash, result });
      return { result, document: readback, decision, replay: false as const };
    });

    if (this.options.projection) {
      try {
        await this.options.projection.writeVersionSnapshot(input.projectId, input.projectVersion, { "planning-package.json": committed.document });
        await this.options.projection.appendDecision(input.projectId, input.projectVersion, committed.decision);
      } catch (error) {
        throw new PlanningSemanticChecksumRecertificationError("PLANNING_CHECKSUM_RECERTIFICATION_PROJECTION_FAILED", "Planning checksum recertification committed canonically, but Project Memory reconciliation failed.", { cause: error });
      }
    }
    return { ...committed.result, outcome: committed.replay ? "COMMITTED_REPLAY" : "COMMITTED", projectionStatus: this.options.projection ? "SYNCED" : "UNAVAILABLE" };
  }
}
