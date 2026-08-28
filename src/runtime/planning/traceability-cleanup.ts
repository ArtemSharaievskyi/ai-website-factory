import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PlanningPackageSchema, type PlanningPackage } from "@/agents/planner/contracts";
import { planningDocumentChecksum, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { appendDecisionInTransaction, saveDocumentCASInTransaction } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import type { PersistenceDatabase, PersistenceTransaction, ProjectRow, ProjectVersionRow } from "@/persistence/database/types";
import { PersistenceError } from "@/persistence/database/errors";
import { DecisionRecordSchema, type DecisionRecord } from "@/domain/workflow/decision";

export const PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION = "HOST_OWNED_PLANNING_TRACEABILITY_CLEANUP_V1" as const;
export const PLANNING_TRACEABILITY_CLEANUP_OPERATION = "planning-traceability-cleanup-v1" as const;
export const ORPHAN_PLANNING_REFERENCE_IDS = [
  "REQUIREMENT:legacy-v1-decisions-auth",
  "REQUIREMENT:legacy-v1-decisions-database",
] as const;

const expectedCounts = {
  "REQUIREMENT:legacy-v1-decisions-auth": 2,
  "REQUIREMENT:legacy-v1-decisions-database": 5,
} as const;
const targetIds = new Set<string>(ORPHAN_PLANNING_REFERENCE_IDS);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const CleanupInputSchema = z.object({
  authorization: z.literal(PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  expectedWorkflowState: z.literal("AWAITING_DESIGN_SELECTION"),
}).strict();
type CleanupInput = z.infer<typeof CleanupInputSchema>;

const CleanupPlanSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  expectedWorkflowState: z.literal("AWAITING_DESIGN_SELECTION"),
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  planningRowVersion: z.number().int().positive(),
  canonicalBriefChecksum: Sha256Schema,
  previousPlanningDocumentChecksum: Sha256Schema,
  previousPlanningSemanticChecksum: Sha256Schema,
  nextPlanningSemanticChecksum: Sha256Schema,
  removedReferenceCount: z.number().int().positive(),
  removedReferenceCounts: z.object({
    "REQUIREMENT:legacy-v1-decisions-auth": z.literal(2),
    "REQUIREMENT:legacy-v1-decisions-database": z.literal(5),
  }).strict(),
  removedReferencePaths: z.array(z.string().min(1)).length(7),
}).strict();
export type PlanningTraceabilityCleanupPlan = z.infer<typeof CleanupPlanSchema>;

const CommittedResultSchema = z.object({
  operationKey: z.string().min(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  changed: z.literal(true),
  removedReferenceCount: z.literal(7),
  removedReferenceCounts: CleanupPlanSchema.shape.removedReferenceCounts,
  removedReferencePaths: z.array(z.string().min(1)).length(7),
  previousPlanningDocumentChecksum: Sha256Schema,
  nextPlanningDocumentChecksum: Sha256Schema,
  previousPlanningSemanticChecksum: Sha256Schema,
  nextPlanningSemanticChecksum: Sha256Schema,
  previousPlanningRowVersion: z.number().int().positive(),
  nextPlanningRowVersion: z.number().int().positive(),
  decisionId: z.string().uuid(),
}).strict();
type CommittedResult = z.infer<typeof CommittedResultSchema>;

export type PlanningTraceabilityCleanupResult = CommittedResult & {
  outcome: "COMMITTED" | "COMMITTED_REPLAY";
  projectionStatus: "SYNCED" | "UNAVAILABLE";
};

type ReferenceOccurrence = { id: string; path: string };

export class PlanningTraceabilityCleanupError extends Error {
  constructor(
    public readonly code:
      | "PLANNING_CLEANUP_NOT_FOUND"
      | "PLANNING_CLEANUP_UNAUTHORIZED_STATE"
      | "PLANNING_CLEANUP_CANONICAL_DECISION_MISMATCH"
      | "PLANNING_CLEANUP_SCOPE_MISMATCH"
      | "PLANNING_CLEANUP_STALE"
      | "PLANNING_CLEANUP_IN_PROGRESS"
      | "PLANNING_CLEANUP_PROJECTION_FAILED",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`${code}: ${message}`);
    this.name = "PlanningTraceabilityCleanupError";
  }
}

function childPath(parent: string, key: string | number) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

function collectOccurrences(value: unknown, path = ""): { occurrences: ReferenceOccurrence[]; unexpected: ReferenceOccurrence[] } {
  if (Array.isArray(value)) {
    return value.reduce<{ occurrences: ReferenceOccurrence[]; unexpected: ReferenceOccurrence[] }>((result, item, index) => {
      const child = collectOccurrences(item, childPath(path, index));
      result.occurrences.push(...child.occurrences);
      result.unexpected.push(...child.unexpected);
      return result;
    }, { occurrences: [], unexpected: [] });
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" && targetIds.has(value)
      ? { occurrences: [], unexpected: [{ id: value, path }] }
      : { occurrences: [], unexpected: [] };
  }

  const result = { occurrences: [], unexpected: [] } as { occurrences: ReferenceOccurrence[]; unexpected: ReferenceOccurrence[] };
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const pathForChild = childPath(path, key);
    if (key === "requirementReferences" && Array.isArray(child)) {
      child.forEach((item, index) => {
        if (typeof item === "string" && targetIds.has(item)) result.occurrences.push({ id: item, path: childPath(pathForChild, index) });
        else if (item && typeof item === "object") {
          const nested = collectOccurrences(item, childPath(pathForChild, index));
          result.occurrences.push(...nested.occurrences);
          result.unexpected.push(...nested.unexpected);
        }
      });
      continue;
    }
    const nested = collectOccurrences(child, pathForChild);
    result.occurrences.push(...nested.occurrences);
    result.unexpected.push(...nested.unexpected);
  }
  return result;
}

function removeTargetReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeTargetReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === "requirementReferences" && Array.isArray(child)
      ? child.filter((item) => !(typeof item === "string" && targetIds.has(item)))
      : removeTargetReferences(child),
  ]));
}

function stripTargetReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTargetReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === "requirementReferences" && Array.isArray(child)
      ? child.filter((item) => !(typeof item === "string" && targetIds.has(item))).map(stripTargetReferences)
      : stripTargetReferences(child),
  ]));
}

function assertCanonicalScope(brief: ReturnType<typeof BriefV3DocumentSchema.parse>, planning: PlanningPackage) {
  if (brief.brief.requirements.some((entry) => targetIds.has(entry.id))) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "An authorized orphan reference is present in the canonical Brief requirements.");
  }
  if (brief.brief.decisions.auth.mode !== "NONE" || brief.brief.decisions.database.mode !== "NONE") {
    throw new PlanningTraceabilityCleanupError(
      "PLANNING_CLEANUP_CANONICAL_DECISION_MISMATCH",
      "Canonical Brief auth and database decisions are not both NONE.",
    );
  }
  if (!brief.approval?.approved || brief.approval.approvedCanonicalChecksum !== brief.briefChecksum) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_CANONICAL_DECISION_MISMATCH", "The current CanonicalBriefV3 is not approved against its own checksum.");
  }
  if (planning.approvedBriefChecksum !== brief.briefChecksum) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "Planning is not bound to the approved CanonicalBriefV3 checksum.");
  }
  if (planning.accepted || planning.acceptance.acceptedAt || planning.acceptance.acceptedBy || planning.acceptance.checksum || planning.architecture.acceptance.accepted) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The current Planning package has acceptance state and cannot be cleaned in this bounded mode.");
  }
}

function makePlan(input: CleanupInput, project: ProjectRow, version: ProjectVersionRow, briefDocument: ReturnType<typeof BriefV3DocumentSchema.parse>, planning: PlanningPackage, planningRowChecksum: string, planningRowVersion: number): { plan: PlanningTraceabilityCleanupPlan; next: PlanningPackage } {
  if (project.id !== input.projectId || project.current_version !== input.projectVersion || project.workflow_state !== input.expectedWorkflowState) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_UNAUTHORIZED_STATE", "The project is not in the authorized current Planning state.");
  }
  if (version.projectId !== input.projectId || version.versionNumber !== input.projectVersion || version.immutable) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_UNAUTHORIZED_STATE", "The current project version is not mutable in the authorized Planning state.");
  }
  if (briefDocument.projectId !== input.projectId || briefDocument.projectVersion !== input.projectVersion || planning.projectId !== input.projectId || planning.projectVersion !== input.projectVersion) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The canonical Brief and Planning package are not bound to the authorized project version.");
  }
  if (planningRowChecksum !== planningDocumentChecksum(planning)) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "A persisted canonical document checksum does not match its typed document.");
  }
  assertCanonicalScope(briefDocument, planning);

  const found = collectOccurrences(planning);
  if (found.unexpected.length > 0) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "An orphan reference appears outside a requirementReferences array.");
  const counts = Object.fromEntries(ORPHAN_PLANNING_REFERENCE_IDS.map((id) => [id, found.occurrences.filter((entry) => entry.id === id).length])) as Record<typeof ORPHAN_PLANNING_REFERENCE_IDS[number], number>;
  for (const id of ORPHAN_PLANNING_REFERENCE_IDS) {
    if (counts[id] !== expectedCounts[id]) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", `The authorized occurrence count for ${id} does not match the current Planning package.`);
  }

  const next = PlanningPackageSchema.parse(removeTargetReferences(planning));
  if (checksumPersistedDocument(stripTargetReferences(planning)) !== checksumPersistedDocument(stripTargetReferences(next))) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The proposed cleanup changes fields other than the exact orphan references.");
  }
  if (collectOccurrences(next).occurrences.length > 0 || collectOccurrences(next).unexpected.length > 0) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The proposed cleanup did not retire every authorized orphan reference.");
  }
  if (next.authentication.decision !== "none" || next.databaseRecommendation?.selectedMode !== "NONE" || next.accepted || next.architecture.acceptance.accepted || next.approvedBriefChecksum !== planning.approvedBriefChecksum) {
    throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The cleanup changed an authoritative Planning decision or acceptance field.");
  }

  const previousSemanticChecksum = planningSemanticChecksum(planning);
  const nextSemanticChecksum = planningSemanticChecksum(next);
  if (previousSemanticChecksum === nextSemanticChecksum) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The authorized orphan-reference cleanup did not produce a semantic Planning delta.");
  const plan = CleanupPlanSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    expectedWorkflowState: input.expectedWorkflowState,
    projectRowVersion: project.row_version,
    projectVersionRowVersion: version.rowVersion,
    planningRowVersion,
    canonicalBriefChecksum: briefDocument.briefChecksum,
    previousPlanningDocumentChecksum: planningDocumentChecksum(planning),
    previousPlanningSemanticChecksum: previousSemanticChecksum,
    nextPlanningSemanticChecksum: nextSemanticChecksum,
    removedReferenceCount: found.occurrences.length,
    removedReferenceCounts: counts,
    removedReferencePaths: found.occurrences.map((entry) => entry.path),
  });
  return { plan, next };
}

function inputPayload(input: CleanupInput) {
  return {
    authorization: input.authorization,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    expectedWorkflowState: input.expectedWorkflowState,
    targetReferenceIds: ORPHAN_PLANNING_REFERENCE_IDS,
  };
}

function operationKey(input: CleanupInput) {
  return `${PLANNING_TRACEABILITY_CLEANUP_OPERATION}:${input.projectId}:${input.projectVersion}`;
}

function auditDecision(input: CleanupInput, operation: string, now: string, result: Omit<CommittedResult, "decisionId"> & { decisionId?: string }): DecisionRecord {
  return DecisionRecordSchema.parse({
    id: result.decisionId ?? randomUUID(),
    timestamp: now,
    actorType: "system",
    actorIdentifier: PLANNING_TRACEABILITY_CLEANUP_OPERATION,
    category: "planning-traceability-cleanup",
    decision: "Retired the authorized orphan legacy references from current Planning.",
    rationale: [
      `operation=${operation}`,
      `projectVersion=${input.projectVersion}`,
      `removedReferenceCount=${result.removedReferenceCount}`,
      `removedReferenceIds=${ORPHAN_PLANNING_REFERENCE_IDS.join(",")}`,
      `removedReferencePaths=${result.removedReferencePaths.join(",")}`,
      `previousPlanningDocumentChecksum=${result.previousPlanningDocumentChecksum}`,
      `nextPlanningDocumentChecksum=${result.nextPlanningDocumentChecksum}`,
      `previousPlanningSemanticChecksum=${result.previousPlanningSemanticChecksum}`,
      `nextPlanningSemanticChecksum=${result.nextPlanningSemanticChecksum}`,
      "canonicalAuthMode=NONE",
      "canonicalDatabaseMode=NONE",
    ].join("; "),
    affectedDocuments: ["planning-package.json"],
    requirementChange: false,
    userApprovalRequired: false,
    userApprovalStatus: "not-required",
  });
}

export function preparePlanningTraceabilityCleanup(input: {
  projectId: string;
  projectVersion: number;
  expectedWorkflowState: "AWAITING_DESIGN_SELECTION";
  projectRowVersion: number;
  projectVersionRowVersion: number;
  planningRowVersion: number;
  canonicalBriefChecksum: string;
  planningRowChecksum: string;
  briefDocument: unknown;
  planningPackage: unknown;
}) {
  const request = CleanupInputSchema.parse({
    authorization: PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    expectedWorkflowState: input.expectedWorkflowState,
  });
  const brief = BriefV3DocumentSchema.parse(input.briefDocument);
  const planning = PlanningPackageSchema.parse(input.planningPackage);
  if (brief.briefChecksum !== input.canonicalBriefChecksum) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The supplied canonical Brief checksum is stale.");
  const project = { id: request.projectId, current_version: request.projectVersion, workflow_state: request.expectedWorkflowState, row_version: input.projectRowVersion } as ProjectRow;
  const version = { projectId: request.projectId, versionNumber: request.projectVersion, state: request.expectedWorkflowState, rowVersion: input.projectVersionRowVersion } as ProjectVersionRow;
  return makePlan(request, project, version, brief, planning, input.planningRowChecksum, input.planningRowVersion);
}

export class PlanningTraceabilityCleanupService {
  constructor(private readonly options: { database: PersistenceDatabase; projection?: ProjectMemorySyncPort; clock?: () => string }) {}

  async prepare(input: Omit<CleanupInput, "authorization"> & { authorization?: typeof PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION }) {
    const request = CleanupInputSchema.parse({ ...input, authorization: PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION });
    return this.options.database.transaction((tx) => this.readPlan(tx, request));
  }

  async execute(input: Omit<CleanupInput, "authorization"> & { authorization?: typeof PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION; expectedPlan?: PlanningTraceabilityCleanupPlan }): Promise<PlanningTraceabilityCleanupResult> {
    const { expectedPlan: suppliedExpectedPlan, ...requestInput } = input;
    const request = CleanupInputSchema.parse({ ...requestInput, authorization: PLANNING_TRACEABILITY_CLEANUP_AUTHORIZATION });
    const expectedPlan = suppliedExpectedPlan ? CleanupPlanSchema.parse(suppliedExpectedPlan) : undefined;
    const operation = operationKey(request);
    const payloadHash = checksumPersistedDocument(inputPayload(request));
    const committed = await this.options.database.transaction(async (tx) => {
      const reservation = await tx.reserveOperation({ operation: PLANNING_TRACEABILITY_CLEANUP_OPERATION, key: operation, payloadHash });
      if (reservation.status === "IN_PROGRESS") throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_IN_PROGRESS", "The authorized Planning cleanup is already in progress.");
      if (reservation.status === "SUCCEEDED") {
        const result = CommittedResultSchema.parse(reservation.result);
        const planningRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
        const decision = (await tx.listDecisions(request.projectId, request.projectVersion)).find((candidate) => candidate.id === result.decisionId);
        if (!planningRow || !decision) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The committed Planning cleanup evidence is incomplete.");
        return { result, document: PlanningPackageSchema.parse(mapRowToDocument(planningRow)), decision, replay: true as const };
      }

      const current = await this.readCurrent(tx, request);
      const prepared = makePlan(request, current.project, current.version, current.brief, current.planning, current.planningRow.checksum, current.planningRow.rowVersion);
      if (expectedPlan && checksumPersistedDocument(expectedPlan) !== checksumPersistedDocument(prepared.plan)) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_STALE", "The authorized Planning cleanup PREPARE result is stale.");
      const now = this.options.clock?.() ?? new Date().toISOString();
      const next = PlanningPackageSchema.parse({ ...prepared.next, createdAt: current.planning.createdAt, updatedAt: now });
      await saveDocumentCASInTransaction(tx, next, current.planningRow.rowVersion, current.planningRow.checksum);
      const savedRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
      if (!savedRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The cleaned Planning package was not returned by persistence.");
      const nextPlanning = PlanningPackageSchema.parse(mapRowToDocument(savedRow));
      const resultWithoutDecision = {
        operationKey: operation,
        projectId: request.projectId,
        projectVersion: request.projectVersion,
        changed: true as const,
        removedReferenceCount: prepared.plan.removedReferenceCount as 7,
        removedReferenceCounts: prepared.plan.removedReferenceCounts,
        removedReferencePaths: prepared.plan.removedReferencePaths,
        previousPlanningDocumentChecksum: prepared.plan.previousPlanningDocumentChecksum,
        nextPlanningDocumentChecksum: savedRow.checksum,
        previousPlanningSemanticChecksum: prepared.plan.previousPlanningSemanticChecksum,
        nextPlanningSemanticChecksum: planningSemanticChecksum(nextPlanning),
        previousPlanningRowVersion: current.planningRow.rowVersion,
        nextPlanningRowVersion: savedRow.rowVersion,
      };
      const decision = auditDecision(request, operation, now, resultWithoutDecision);
      const result = CommittedResultSchema.parse({ ...resultWithoutDecision, decisionId: decision.id });
      await appendDecisionInTransaction(tx, request.projectId, request.projectVersion, decision);
      await tx.completeOperation({ operation: PLANNING_TRACEABILITY_CLEANUP_OPERATION, key: operation, payloadHash, result });
      return { result, document: nextPlanning, decision, replay: false as const };
    });

    if (this.options.projection) {
      try {
        await this.options.projection.writeVersionSnapshot(request.projectId, request.projectVersion, { "planning-package.json": committed.document });
        await this.options.projection.appendDecision(request.projectId, request.projectVersion, committed.decision);
      } catch (error) {
        throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_PROJECTION_FAILED", "Planning cleanup committed canonically, but Project Memory reconciliation failed.", error);
      }
    }
    return { ...committed.result, outcome: committed.replay ? "COMMITTED_REPLAY" : "COMMITTED", projectionStatus: this.options.projection ? "SYNCED" : "UNAVAILABLE" };
  }

  private async readPlan(tx: PersistenceTransaction, request: CleanupInput) {
    const current = await this.readCurrent(tx, request);
    return makePlan(request, current.project, current.version, current.brief, current.planning, current.planningRow.checksum, current.planningRow.rowVersion).plan;
  }

  private async readCurrent(tx: PersistenceTransaction, request: CleanupInput) {
    const project = await tx.getProject(request.projectId);
    const version = await tx.getVersion(request.projectId, request.projectVersion);
    const briefRow = await tx.getDocument(request.projectId, request.projectVersion, "brief-v3");
    const planningRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
    if (!project || !version || !briefRow || !planningRow) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_NOT_FOUND", "The authorized current Planning state is incomplete.");
    const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
    const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
    if (briefRow.checksum !== checksumPersistedDocument(brief) || version.requirementsChecksum !== brief.briefChecksum) throw new PlanningTraceabilityCleanupError("PLANNING_CLEANUP_SCOPE_MISMATCH", "The current Brief persistence binding is inconsistent.");
    return { project, version, brief, planning, planningRow, briefRow };
  }
}
