import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { mapDocumentToRow, mapRowToDocument, type DocumentRow } from "@/persistence/database/mapping";
import type { PersistenceDatabase, PersistenceTransaction, ProjectRow, ProjectVersionRow, RequirementIdentityMigrationRow } from "@/persistence/database/types";
import { PersistenceError } from "@/persistence/database/errors";
import { PlanningPackageSchema, type PlanningPackage } from "@/agents/planner/contracts";
import { planningDocumentChecksum, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import {
  assertCurrentV3RequirementNamespace,
  canonicalRequirementEntries,
  createRequirementIdentityLineage,
  isLegacyRequirementId,
  isV3RequirementId,
  mapCanonicalBriefRequirementIds,
  mapRequirementIdentitiesDeep,
  RequirementIdentityLineageSchema,
  REQUIREMENT_IDENTITY_POLICY_VERSION,
  type RequirementIdentityLineage,
} from "@/domain/requirements/v3/identity";
import { stableSerialize } from "@/domain/requirements/v3/serialization";
import { transitionWorkflow } from "@/domain/workflow/engine";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const MigrationPlanSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  migrationPolicyVersion: z.literal(REQUIREMENT_IDENTITY_POLICY_VERSION),
  previousBriefChecksum: Sha256Schema,
  nextBriefChecksum: Sha256Schema,
  previousPlanningDocumentChecksum: Sha256Schema.nullable(),
  nextPlanningDocumentChecksum: Sha256Schema.nullable(),
  previousPlanningSemanticChecksum: Sha256Schema.nullable(),
  nextPlanningSemanticChecksum: Sha256Schema.nullable(),
  lineage: z.array(RequirementIdentityLineageSchema),
  counts: z.object({
    legacyBriefRequirementIds: z.number().int().nonnegative(),
    legacyPlanningReferences: z.number().int().nonnegative(),
    deterministicMappings: z.number().int().nonnegative(),
    ambiguousMappings: z.number().int().nonnegative(),
    unmappedMappings: z.number().int().nonnegative(),
    collisionMappings: z.number().int().nonnegative(),
    invalidMappings: z.number().int().nonnegative(),
  }).strict(),
  ambiguousRequirementIds: z.array(z.string()).max(1000),
  unmappedRequirementIds: z.array(z.string()).max(1000),
  collisionRequirementIds: z.array(z.string()).max(1000),
  invalidRequirementIds: z.array(z.string()).max(1000),
  downstreamArtifactsInvalidated: z.array(z.string()),
  briefApprovalInvalidated: z.boolean(),
  planningAcceptanceInvalidated: z.boolean(),
  safeToApply: z.boolean(),
  planChecksum: Sha256Schema,
}).strict();
export type RequirementIdentityMigrationPlan = z.infer<typeof MigrationPlanSchema>;

export type RequirementIdentityMigrationPrepareInput = {
  projectId: string;
  projectVersion: number;
  brief: CanonicalBriefV3;
  planningPackage?: PlanningPackage | null;
  /** Candidate records are host-authored evidence; providers cannot supply this input. */
  lineageCandidates: readonly RequirementIdentityLineage[];
  downstreamArtifactsInvalidated?: readonly string[];
  briefApprovalInvalidated?: boolean;
  planningAcceptanceInvalidated?: boolean;
};

export type RequirementIdentityMigrationPrepareResult = {
  plan: RequirementIdentityMigrationPlan;
  nextBrief: CanonicalBriefV3;
  nextPlanningPackage: PlanningPackage | null;
};

const exact = (values: readonly string[]) => [...new Set(values)].sort();

function planningRequirementReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(planningRequirementReferences);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => key === "requirementReferences" ? (Array.isArray(child) ? child.filter((item): item is string => typeof item === "string") : []) : planningRequirementReferences(child));
}

function planChecksum(value: Omit<RequirementIdentityMigrationPlan, "planChecksum">): string {
  return createHash("sha256").update(stableSerialize(value), "utf8").digest("hex");
}

function checkedCandidates(input: RequirementIdentityMigrationPrepareInput): RequirementIdentityLineage[] {
  return input.lineageCandidates.map((candidate) => RequirementIdentityLineageSchema.parse(candidate));
}

/** Pure, fail-closed PREPARE boundary. It does not persist or mutate canonical state. */
export function prepareRequirementIdentityMigration(input: RequirementIdentityMigrationPrepareInput): RequirementIdentityMigrationPrepareResult {
  const brief = CanonicalBriefV3Schema.parse(input.brief);
  const planning = input.planningPackage == null ? null : PlanningPackageSchema.parse(input.planningPackage);
  const candidates = checkedCandidates(input);
  const briefLegacyIds = exact(canonicalRequirementEntries(brief).filter((entry) => isLegacyRequirementId(entry.id)).map((entry) => entry.id));
  const briefRequirementIds = new Set(canonicalRequirementEntries(brief).map((entry) => entry.id));
  const currentV3Ids = new Set(canonicalRequirementEntries(brief).filter((entry) => isV3RequirementId(entry.id)).map((entry) => entry.id));
  const planningLegacyIds = exact(planning ? planningRequirementReferences(planning).filter(isLegacyRequirementId) : []);
  const expectedSources = new Set([...briefLegacyIds, ...planningLegacyIds]);
  const ambiguous = new Set<string>();
  const unmapped = new Set<string>();
  const collisions = new Set<string>();
  const invalid = new Set<string>();
  const bySource = new Map<string, RequirementIdentityLineage[]>();
  for (const candidate of candidates) {
    if (candidate.projectId !== input.projectId || candidate.projectVersion !== input.projectVersion) {
      invalid.add(candidate.fromRequirementId);
      continue;
    }
    if (!isLegacyRequirementId(candidate.fromRequirementId) || !isV3RequirementId(candidate.toRequirementId) || candidate.toRequirementId !== createRequirementIdentityLineage({ projectId: input.projectId, projectVersion: input.projectVersion, fromRequirementId: candidate.fromRequirementId, canonicalSemanticIdentity: candidate.canonicalSemanticIdentity }).toRequirementId) {
      invalid.add(candidate.fromRequirementId);
      continue;
    }
    if (!bySource.has(candidate.fromRequirementId)) bySource.set(candidate.fromRequirementId, []);
    bySource.get(candidate.fromRequirementId)!.push(candidate);
  }
  for (const source of expectedSources) {
    if (!briefRequirementIds.has(source)) {
      invalid.add(source);
      continue;
    }
    const sourceCandidates = bySource.get(source) ?? [];
    if (sourceCandidates.length === 0) unmapped.add(source);
    else if (sourceCandidates.length !== 1) ambiguous.add(source);
  }
  for (const source of bySource.keys()) if (!expectedSources.has(source)) invalid.add(source);
  const targetSources = new Map<string, string>();
  const mappings = new Map<string, string>();
  const lineage: RequirementIdentityLineage[] = [];
  for (const source of expectedSources) {
    const candidate = bySource.get(source)?.[0];
    if (!candidate || ambiguous.has(source) || invalid.has(source)) continue;
    if (currentV3Ids.has(candidate.toRequirementId)) {
      collisions.add(source);
      continue;
    }
    const priorSource = targetSources.get(candidate.toRequirementId);
    if (priorSource && priorSource !== source) {
      collisions.add(source);
      collisions.add(priorSource);
      continue;
    }
    targetSources.set(candidate.toRequirementId, source);
    mappings.set(source, candidate.toRequirementId);
    lineage.push(candidate);
  }
  const counts = {
    legacyBriefRequirementIds: briefLegacyIds.length,
    legacyPlanningReferences: planningLegacyIds.length,
    deterministicMappings: lineage.length,
    ambiguousMappings: ambiguous.size,
    unmappedMappings: unmapped.size,
    collisionMappings: collisions.size,
    invalidMappings: invalid.size,
  };
  const safeToApply = counts.ambiguousMappings === 0 && counts.unmappedMappings === 0 && counts.collisionMappings === 0 && counts.invalidMappings === 0 && counts.deterministicMappings === expectedSources.size && counts.legacyBriefRequirementIds > 0;
  const mappedBrief = mapCanonicalBriefRequirementIds(brief, mappings);
  const nextBrief = safeToApply ? assertCurrentV3RequirementNamespace(mappedBrief) : mappedBrief;
  const nextBriefChecksum = canonicalBriefChecksum(nextBrief);
  const nextPlanningPackage = planning
    ? PlanningPackageSchema.parse({
        ...mapRequirementIdentitiesDeep(planning, mappings),
        approvedBriefChecksum: nextBriefChecksum,
        accepted: false,
        acceptance: {},
        architecture: { ...mapRequirementIdentitiesDeep(planning.architecture, mappings), acceptance: { accepted: false } },
      })
    : null;
  const unsignedPlan = {
    schemaVersion: 1 as const,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    migrationPolicyVersion: REQUIREMENT_IDENTITY_POLICY_VERSION,
    previousBriefChecksum: canonicalBriefChecksum(brief),
    nextBriefChecksum,
    previousPlanningDocumentChecksum: planning ? planningDocumentChecksum(planning) : null,
    nextPlanningDocumentChecksum: nextPlanningPackage ? planningDocumentChecksum(nextPlanningPackage) : null,
    previousPlanningSemanticChecksum: planning ? planningSemanticChecksum(planning) : null,
    nextPlanningSemanticChecksum: nextPlanningPackage ? planningSemanticChecksum(nextPlanningPackage) : null,
    lineage: [...lineage].sort((left, right) => left.fromRequirementId.localeCompare(right.fromRequirementId)),
    counts,
    ambiguousRequirementIds: exact([...ambiguous]),
    unmappedRequirementIds: exact([...unmapped]),
    collisionRequirementIds: exact([...collisions]),
    invalidRequirementIds: exact([...invalid]),
    downstreamArtifactsInvalidated: exact(input.downstreamArtifactsInvalidated ?? []),
    briefApprovalInvalidated: input.briefApprovalInvalidated ?? false,
    planningAcceptanceInvalidated: input.planningAcceptanceInvalidated ?? Boolean(planning),
    safeToApply,
  };
  const plan = MigrationPlanSchema.parse({ ...unsignedPlan, planChecksum: planChecksum(unsignedPlan) });
  return { plan, nextBrief, nextPlanningPackage };
}

export type RequirementIdentityMigrationApplyResult = {
  outcome: "APPLIED" | "COMMITTED_REPLAY";
  migration: RequirementIdentityMigrationRow;
  brief: DocumentRow;
  planning: DocumentRow | null;
  project: ProjectRow;
  version: ProjectVersionRow;
};

export class RequirementIdentityMigrationError extends Error {
  constructor(readonly code: "IDENTITY_MIGRATION_UNSAFE" | "IDENTITY_MIGRATION_STALE" | "IDENTITY_MIGRATION_WORKFLOW_INVALID", message: string) {
    super(message);
    this.name = "RequirementIdentityMigrationError";
  }
}

function currentBriefFromRows(briefRow: DocumentRow): CanonicalBriefV3 {
  const stored = mapRowToDocument(briefRow);
  if (stored.documentType === "brief-v3") return BriefV3DocumentSchema.parse(stored).brief;
  throw new RequirementIdentityMigrationError("IDENTITY_MIGRATION_WORKFLOW_INVALID", "A current CanonicalBriefV3 document is required before identity migration.");
}

function migrationId(plan: RequirementIdentityMigrationPlan): string {
  return `requirement-identity-migration:${plan.projectId}:${plan.projectVersion}:${plan.planChecksum}`;
}

export class RequirementIdentityMigrationService {
  constructor(private readonly database: PersistenceDatabase) {}

  async prepare(input: Omit<RequirementIdentityMigrationPrepareInput, "brief" | "planningPackage" | "lineageCandidates"> & { lineageCandidates?: readonly RequirementIdentityLineage[] }): Promise<RequirementIdentityMigrationPrepareResult> {
    return this.database.transaction(async (tx) => {
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      if (!briefRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The current CanonicalBriefV3 document was not found.");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      const brief = currentBriefFromRows(briefRow);
      const briefDocument = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = planningRow ? mapRowToDocument(planningRow) : null;
      const planningPackage = planning?.documentType === "planning-package" ? planning : null;
      return prepareRequirementIdentityMigration({ ...input, brief, planningPackage, lineageCandidates: input.lineageCandidates ?? [], briefApprovalInvalidated: Boolean(briefDocument.approval?.approved), planningAcceptanceInvalidated: Boolean(planningPackage?.accepted || planningPackage?.architecture.acceptance.accepted) });
    });
  }

  async apply(input: { plan: RequirementIdentityMigrationPlan; expectedBriefRowVersion: number; expectedPlanningRowVersion?: number; expectedProjectRowVersion: number; expectedProjectVersionRowVersion: number; actor?: string; now?: string }): Promise<RequirementIdentityMigrationApplyResult> {
    const plan = MigrationPlanSchema.parse(input.plan);
    return this.database.transaction(async (tx) => this.applyInTransaction(tx, input, plan));
  }

  private async applyInTransaction(tx: PersistenceTransaction, input: { plan: RequirementIdentityMigrationPlan; expectedBriefRowVersion: number; expectedPlanningRowVersion?: number; expectedProjectRowVersion: number; expectedProjectVersionRowVersion: number; actor?: string; now?: string }, plan: RequirementIdentityMigrationPlan): Promise<RequirementIdentityMigrationApplyResult> {
    const id = migrationId(plan);
    const replay = await tx.getRequirementIdentityMigration(plan.projectId, plan.projectVersion, id);
    const project = await tx.getProject(plan.projectId);
    const version = await tx.getVersion(plan.projectId, plan.projectVersion);
    const briefRow = await tx.getDocument(plan.projectId, plan.projectVersion, "brief-v3");
    const planningRow = await tx.getDocument(plan.projectId, plan.projectVersion, "planning-package");
    if (!project || !version || !briefRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The current identity migration state was not found.");
    if (replay) return { outcome: "COMMITTED_REPLAY", migration: replay, brief: briefRow, planning: planningRow, project, version };
    if (project.current_version !== plan.projectVersion || project.row_version !== input.expectedProjectRowVersion || version.rowVersion !== input.expectedProjectVersionRowVersion || version.requirementsChecksum !== plan.previousBriefChecksum || briefRow.rowVersion !== input.expectedBriefRowVersion || (planningRow && planningRow.rowVersion !== input.expectedPlanningRowVersion) || (!planningRow && input.expectedPlanningRowVersion !== undefined)) throw new RequirementIdentityMigrationError("IDENTITY_MIGRATION_STALE", "The identity migration currentness token is stale.");
    const brief = currentBriefFromRows(briefRow);
    const planning = planningRow ? mapRowToDocument(planningRow) : null;
    const briefDocument = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
    const planningPackage = planning?.documentType === "planning-package" ? planning : null;
    const actualBriefApprovalInvalidated = Boolean(briefDocument.approval?.approved);
    const actualPlanningAcceptanceInvalidated = Boolean(planningPackage?.accepted || planningPackage?.architecture.acceptance.accepted);
    if (actualBriefApprovalInvalidated !== plan.briefApprovalInvalidated || actualPlanningAcceptanceInvalidated !== plan.planningAcceptanceInvalidated) throw new RequirementIdentityMigrationError("IDENTITY_MIGRATION_STALE", "Approval or acceptance currentness changed after PREPARE.");
    const prepared = prepareRequirementIdentityMigration({ projectId: plan.projectId, projectVersion: plan.projectVersion, brief, planningPackage, lineageCandidates: plan.lineage, downstreamArtifactsInvalidated: plan.downstreamArtifactsInvalidated, briefApprovalInvalidated: actualBriefApprovalInvalidated, planningAcceptanceInvalidated: actualPlanningAcceptanceInvalidated });
    if (prepared.plan.planChecksum !== plan.planChecksum || prepared.plan.previousBriefChecksum !== plan.previousBriefChecksum || prepared.plan.previousPlanningSemanticChecksum !== plan.previousPlanningSemanticChecksum) throw new RequirementIdentityMigrationError("IDENTITY_MIGRATION_STALE", "The prepared identity migration no longer matches current canonical state.");
    if (!plan.safeToApply) throw new RequirementIdentityMigrationError("IDENTITY_MIGRATION_UNSAFE", "The identity migration contains ambiguous, unmapped, invalid, or colliding lineage.");
    const now = input.now ?? new Date().toISOString();
    const nextBriefDocument = createBriefV3Document({ projectId: plan.projectId, projectVersion: plan.projectVersion, brief: prepared.nextBrief, createdAt: briefRow.createdAt, updatedAt: now });
    const nextBriefRow = await tx.saveDocumentCAS({ row: mapDocumentToRow(nextBriefDocument), expectedRowVersion: briefRow.rowVersion, expectedChecksum: briefRow.checksum });
    const nextPlanningRow = prepared.nextPlanningPackage && planningRow
      ? await tx.saveDocumentCAS({ row: mapDocumentToRow({ ...prepared.nextPlanningPackage, createdAt: planningRow.createdAt, updatedAt: now }), expectedRowVersion: planningRow.rowVersion, expectedChecksum: planningRow.checksum })
      : null;
    const updatedVersion = await tx.updateVersionArtifactChecksums({ projectId: plan.projectId, version: plan.projectVersion, expectedRowVersion: version.rowVersion, requirementsChecksum: plan.nextBriefChecksum, selectedDesignChecksum: null, architectureChecksum: null, updatedAt: now });
    let updatedProject = project;
    if (project.workflow_state === "AWAITING_DESIGN_SELECTION") {
      transitionWorkflow(project.workflow_state, "AWAITING_BRIEF_APPROVAL");
      updatedProject = await tx.updateProjectState({ id: project.id, expectedState: project.workflow_state, expectedRowVersion: project.row_version, state: "AWAITING_BRIEF_APPROVAL", updatedAt: now });
      await tx.appendWorkflowEvent({ id: randomUUID(), projectId: project.id, projectVersion: plan.projectVersion, fromState: project.workflow_state, toState: "AWAITING_BRIEF_APPROVAL", actor: input.actor ?? "requirement-identity-migration", reason: "Canonical requirement identities changed; downstream approvals require explicit re-approval.", createdAt: now, idempotencyKey: id });
    }
    const createdAt = now;
    const migration: RequirementIdentityMigrationRow = { migrationId: id, projectId: plan.projectId, projectVersion: plan.projectVersion, planChecksum: plan.planChecksum, previousBriefChecksum: plan.previousBriefChecksum, nextBriefChecksum: plan.nextBriefChecksum, previousPlanningSemanticChecksum: plan.previousPlanningSemanticChecksum, nextPlanningSemanticChecksum: plan.nextPlanningSemanticChecksum, migrationPolicyVersion: REQUIREMENT_IDENTITY_POLICY_VERSION, createdAt };
    for (const lineage of plan.lineage) await tx.appendRequirementIdentityLineage({ ...lineage, createdAt });
    await tx.appendRequirementIdentityMigration(migration);
    return { outcome: "APPLIED", migration, brief: nextBriefRow, planning: nextPlanningRow, project: updatedProject, version: updatedVersion };
  }
}

export { MigrationPlanSchema as RequirementIdentityMigrationPlanSchema };
