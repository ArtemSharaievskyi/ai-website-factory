import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CanonicalBriefV3Schema,
  CanonicalRequirementSchema,
  RoutePolicySchema,
  type CanonicalBriefV3,
} from "@/domain/requirements/v3/schema";
import { canonicalBriefToPlannerBrief } from "./brief-context";
import { canonicalUnresolvedBlocksStage } from "@/domain/requirements/v3/unresolved";
import { evaluateBriefReadiness } from "@/domain/requirements/v3/readiness";
import {
  RequirementSpecificationSchema,
  type RequirementSpecification,
} from "@/domain/requirements/schema";
import {
  BriefV3DocumentSchema,
  type BriefV3Document,
} from "@/persistence/database/brief-revision-v3-contracts";
import {
  PlanningPackageSchema,
  PlannerAgentInputSchema,
  type PlannerAgentInput,
  type PlanningPackage,
} from "./contracts";
import {
  admitPlanningRefresh,
  analyzePlanningRequirementCoverage,
  normalizePlanningPackageForHost,
  planningRoutePolicyMatchesCanonicalBrief,
  PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES,
  validatePlanningRequirementCoverage,
} from "./refresh-admission";
import {
  derivePlanningReconciliationScope,
  type PlanningReconciliationCurrentness,
  type PlanningReconciliationScope,
} from "./reconciliation";
import {
  isClientOnlyFormBrief,
  isNoBackendBrief,
  validatePlanningAdmission,
  validatePlanningPackageAgainstBrief,
} from "./deterministic";
import {
  planningDocumentChecksum,
  planningSemanticChecksumForPolicy,
} from "./semantic-checksum";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY } from "./semantic-checksum";
import {
  computePlanningBriefDeltaFromHistory,
} from "./changeset";
import {
  mapRowToDocument,
  type DocumentRow,
} from "@/persistence/database/mapping";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  saveDocumentCASInTransaction,
} from "@/persistence/database/repositories";
import type {
  PersistenceDatabase,
  ProjectRow,
  ProjectVersionRow,
} from "@/persistence/database/types";
import type { PlannerMemoryPort } from "./ports";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";

export const PLANNING_RECOVERY_AUTHORITY = "PLANNING_RECOVERY" as const;
export const PLANNING_RECOVERY_MODE = "FULL_PLANNING_REBUILD" as const;
export const PLANNING_RECOVERY_POLICY_VERSION = "planning-recovery-v1" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RecoveryModeSchema = z.literal(PLANNING_RECOVERY_MODE);
const RecoveryAuthoritySchema = z.literal(PLANNING_RECOVERY_AUTHORITY);

const RecoveryCurrentnessSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  workflowState: z.literal("AWAITING_DESIGN_SELECTION"),
  briefRowVersion: z.number().int().positive(),
  briefSemanticChecksum: Sha256Schema,
  briefDocumentChecksum: Sha256Schema,
  planningRowVersion: z.number().int().positive(),
  planningSemanticChecksum: Sha256Schema,
  planningDocumentChecksum: Sha256Schema,
  planningSemanticChecksumPolicy: z.literal(CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
  planningApprovedBriefChecksum: Sha256Schema,
  planningAccepted: z.literal(false),
}).strict();
export type PlanningRecoveryCurrentness = z.infer<typeof RecoveryCurrentnessSchema>;

const PlanningRecoveryPlanPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  authority: RecoveryAuthoritySchema,
  mode: RecoveryModeSchema,
  policyVersion: z.literal(PLANNING_RECOVERY_POLICY_VERSION),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  versionId: z.string().uuid(),
  recoveryReason: z.literal("UNRECOVERABLE_CURRENT_PLANNING_STATE"),
  currentness: RecoveryCurrentnessSchema,
  briefChecksum: Sha256Schema,
  routePolicy: RoutePolicySchema,
  decisions: CanonicalBriefV3Schema.shape.decisions,
  planningOwnedRequirementIds: z.array(z.string().min(1)).max(512),
  reconciliationScopeChecksum: Sha256Schema,
  providerCapability: z.object({
    contractVersion: z.literal(1),
    outputMode: z.literal("FULL_PLANNING_PACKAGE"),
    canonicalBriefIsSoleSemanticAuthority: z.literal(true),
    hostOwnedFields: z.array(z.enum(["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds"])),
    forbiddenProviderActions: z.array(z.enum(["mutateCanonicalBrief", "mutateProject", "mutateWorkflow", "writePersistence", "approvePlanning", "inventRequirementIds", "inventBusinessFacts"])),
  }).strict(),
}).strict();

export const PlanningRecoveryPlanSchema = PlanningRecoveryPlanPayloadSchema.extend({
  planChecksum: Sha256Schema,
}).strict();
export type PlanningRecoveryPlan = z.infer<typeof PlanningRecoveryPlanSchema>;

const CurrentPlanningEvidenceSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  rowVersion: z.number().int().positive(),
  semanticChecksum: Sha256Schema,
  documentChecksum: Sha256Schema,
  semanticChecksumPolicyVersion: z.literal(CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
  accepted: z.literal(false),
  structuralSummary: z.object({
    routeCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    formCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    dependencyCount: z.number().int().nonnegative(),
    structuralChecksum: Sha256Schema,
  }).strict(),
  semanticAuthority: z.literal("CURRENT_CANONICAL_BRIEF_V3"),
}).strict();

export const PlanningRecoveryProviderInputSchema = z.object({
  authority: RecoveryAuthoritySchema,
  mode: RecoveryModeSchema,
  plan: PlanningRecoveryPlanSchema,
  canonicalBrief: CanonicalBriefV3Schema,
  planningOwnedRequirements: z.array(CanonicalRequirementSchema).max(512),
  plannerInput: PlannerAgentInputSchema,
  currentPlanningEvidence: CurrentPlanningEvidenceSchema,
  contextPolicy: z.object({
    maxBytes: z.number().int().positive(),
    lossless: z.literal(true),
    omittedSemanticFields: z.array(z.string()).length(0),
  }).strict(),
}).strict();
export type PlanningRecoveryProviderInput = z.infer<typeof PlanningRecoveryProviderInputSchema>;

export const PlanningRecoveryEvidenceSchema = z.object({
  id: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  recoveryPlanChecksum: Sha256Schema,
  briefRowVersion: z.number().int().positive(),
  briefSemanticChecksum: Sha256Schema,
  briefDocumentChecksum: Sha256Schema,
  priorPlanningRowVersion: z.number().int().positive(),
  priorPlanningSemanticChecksum: Sha256Schema,
  priorPlanningDocumentChecksum: Sha256Schema,
  priorPlanningPackage: PlanningPackageSchema,
  nextPlanningRowVersion: z.number().int().positive(),
  nextPlanningSemanticChecksum: Sha256Schema,
  nextPlanningDocumentChecksum: Sha256Schema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type PlanningRecoveryEvidence = z.infer<typeof PlanningRecoveryEvidenceSchema>;

export const PlanningRecoveryEligibilitySchema = z.object({
  eligible: z.boolean(),
  blockers: z.array(z.string()),
  reason: z.enum([
    "RECOVERY_REQUIRED",
    "HOST_RECOVERY_NOT_AUTHORIZED",
    "BRIEF_NOT_CURRENT_APPROVED",
    "PLANNING_NOT_CURRENT",
    "HISTORICAL_DELTA_AVAILABLE",
    "BOUNDED_RECONCILIATION_SUFFICIENT",
    "DOWNSTREAM_STATE_NOT_STALE",
    "CURRENTNESS_TOKEN_INVALID",
    "CANONICAL_UNRESOLVED",
    "PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE",
    "CONTEXT_BOUND_EXCEEDED",
  ]),
  planningOwnedRequirementCount: z.number().int().nonnegative(),
  currentCoverage: z.array(z.object({
    requirementId: z.string(),
    category: z.string(),
    reason: z.string(),
  }).strict()),
}).strict();
export type PlanningRecoveryEligibility = z.infer<typeof PlanningRecoveryEligibilitySchema>;

export type PlanningRecoveryPreparation = {
  eligibility: PlanningRecoveryEligibility;
  scope?: PlanningReconciliationScope;
  plan?: PlanningRecoveryPlan;
  providerInput?: PlanningRecoveryProviderInput;
};

export type PlanningRecoveryProvider = {
  planRecovery(input: PlanningRecoveryProviderInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<PlanningPackage>;
};

export type PlanningRecoveryResult = {
  status: "COMMITTED" | "REPLAYED";
  package: PlanningPackage;
  evidence: PlanningRecoveryEvidence;
};

export type PlanningRecoveryFaultPoint = "after-package-write" | "after-evidence-write" | "before-db-commit";
export type PlanningRecoveryFaultInjector = { hit(point: PlanningRecoveryFaultPoint): void | Promise<void> };

export class PlanningRecoveryError extends Error {
  constructor(readonly code: string, message = code, readonly details?: unknown) {
    super(Array.isArray(details) ? `${message} [${details.slice(0, 8).join(",")}]` : message);
    this.name = "PlanningRecoveryError";
  }
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
}

function planningRequirements(brief: CanonicalBriefV3) {
  return [
    ...brief.requirements,
    ...brief.decisions.form.interactionStates,
    ...brief.seo.locationTargeting,
  ].filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category));
}

function allCanonicalEntries(brief: CanonicalBriefV3) {
  return [
    ...brief.requirements,
    ...brief.decisions.form.interactionStates,
    ...brief.seo.locationTargeting,
  ];
}

function compatibilitySeed(project: ProjectRow, version: ProjectVersionRow, brief: BriefV3Document): RequirementSpecification {
  const approvedAt = brief.approval?.approvedAt ?? brief.updatedAt;
  const approvedBy = brief.approval?.approvedBy ?? "planning-recovery-host";
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1,
    documentType: "requirements",
    projectId: project.id,
    projectVersion: version.versionNumber,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
    projectSummary: brief.brief.summary,
    protectedFunctionalityRequired: brief.brief.scope.protectedFunctionality,
    imagesRequired: brief.brief.scope.images.required,
    businessGoals: [], targetAudiences: [], pages: [], userRoles: [], features: [], forms: [], contentRequirements: [],
    backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first",
    storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
    localization: brief.brief.localization,
    imageSourceDecision: "placeholders",
    suppliedBrandInformation: brief.brief.brand.suppliedInformation ? { status: "provided", value: brief.brief.brand.suppliedInformation } : { status: "missing" },
    suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: [], unresolvedItems: [],
    approval: { approved: true, approvedAt, approvedBy, approvedRequirementsChecksum: brief.briefChecksum },
    briefStatus: "approved", briefVersion: 1,
  });
}

function compatibilityBrief(project: ProjectRow, version: ProjectVersionRow, brief: BriefV3Document, legacy: RequirementSpecification | null): RequirementSpecification {
  return canonicalBriefToPlannerBrief(brief.brief, legacy ?? compatibilitySeed(project, version, brief), brief.approval);
}

function currentnessFor(input: {
  project: ProjectRow;
  version: ProjectVersionRow;
  briefRow: DocumentRow;
  brief: BriefV3Document;
  planningRow: DocumentRow;
  planning: PlanningPackage;
}): PlanningRecoveryCurrentness {
  return RecoveryCurrentnessSchema.parse({
    projectId: input.project.id,
    projectVersion: input.version.versionNumber,
    projectRowVersion: input.project.row_version,
    projectVersionRowVersion: input.version.rowVersion,
    workflowState: input.project.workflow_state,
    briefRowVersion: input.briefRow.rowVersion,
    briefSemanticChecksum: input.brief.briefChecksum,
    briefDocumentChecksum: input.briefRow.checksum,
    planningRowVersion: input.planningRow.rowVersion,
    planningSemanticChecksum: planningSemanticChecksumForPolicy(input.planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
    planningDocumentChecksum: planningDocumentChecksum(input.planning),
    planningSemanticChecksumPolicy: input.planning.semanticChecksumPolicyVersion,
    planningApprovedBriefChecksum: input.planning.approvedBriefChecksum,
    planningAccepted: input.planning.accepted,
  });
}

function reconciliationCurrentness(current: PlanningRecoveryCurrentness, brief: BriefV3Document, planning: PlanningPackage): PlanningReconciliationCurrentness {
  return {
    projectId: current.projectId,
    projectVersion: current.projectVersion,
    projectRowVersion: current.projectRowVersion,
    projectVersionRowVersion: current.projectVersionRowVersion,
    workflowState: current.workflowState,
    brief: {
      rowVersion: current.briefRowVersion,
      semanticChecksum: current.briefSemanticChecksum,
      documentChecksum: current.briefDocumentChecksum,
      approved: Boolean(brief.approval?.approved),
      approvedSemanticChecksum: brief.approval?.approvedCanonicalChecksum ?? null,
    },
    planning: {
      rowVersion: current.planningRowVersion,
      semanticChecksum: current.planningSemanticChecksum,
      documentChecksum: current.planningDocumentChecksum,
      semanticChecksumPolicy: CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY,
      approvedBriefChecksum: planning.approvedBriefChecksum,
      accepted: planning.accepted,
    },
    historicalDeltaAvailable: false,
  };
}

function canonicalDecisionBlockers(brief: CanonicalBriefV3, compatibility: RequirementSpecification, planning: PlanningPackage): string[] {
  const blockers = validatePlanningPackageAgainstBrief(compatibility, planning);
  if (!planningRoutePolicyMatchesCanonicalBrief(planning, brief)) blockers.push("RECOVERY_ROUTE_POLICY_MISMATCH");
  if (brief.decisions.auth.mode === "NONE" && (planning.authentication.required || planning.authentication.decision !== "none")) blockers.push("RECOVERY_AUTH_DECISION_CONFLICT");
  if (brief.decisions.database.mode === "NONE" && (planning.dataModel.entities.length > 0 || planning.supabase.postgres || planning.supabase.auth || planning.supabase.storage || planning.supabase.realtime || planning.supabase.edgeFunctions)) blockers.push("RECOVERY_DATABASE_DECISION_CONFLICT");
  if (brief.decisions.form.mode === "SIMULATED" && !isClientOnlyFormBrief(compatibility)) blockers.push("RECOVERY_FORM_COMPATIBILITY_INPUT_INVALID");
  if (isNoBackendBrief(compatibility) && (planning.architecture.backendPriority.length > 0 || planning.architecture.serverActions.length > 0 || planning.architecture.routeHandlers.length > 0)) blockers.push("RECOVERY_NO_BACKEND_DECISION_CONFLICT");
  return [...new Set(blockers)];
}

function unsupportedBusinessFacts(brief: CanonicalBriefV3, planning: PlanningPackage): string[] {
  const canonicalText = JSON.stringify(brief).toLocaleLowerCase("en");
  const excludedText = brief.requirements.filter((entry) => ["EXCLUSION", "PROHIBITED"].includes(entry.category)).map((entry) => entry.statement.toLocaleLowerCase("en")).join(" ");
  const candidateText = JSON.stringify(planning).toLocaleLowerCase("en");
  const markers = ["nationwide", "bundesweit", "insurance", "versicherung", "certified", "zertifiziert", "fixed price", "festpreis", "unlimited", "unbegrenzt", "guarantee", "garantie"];
  return markers.filter((marker) => candidateText.includes(marker) && (!canonicalText.includes(marker) || excludedText.includes(marker))).map((marker) => `RECOVERY_UNSUPPORTED_BUSINESS_FACT:${marker}`);
}

function referenceBlockers(brief: CanonicalBriefV3, planning: PlanningPackage): string[] {
  const allowed = new Set([...allCanonicalEntries(brief).map((entry) => entry.id), ...brief.pages.map((page) => page.id), ...brief.assets.map((asset) => asset.id)]);
  const blockers: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "requirementReferences" && Array.isArray(child)) for (const reference of child) if (typeof reference === "string" && /^(REQUIREMENT:|PAGE:|ASSET(?::|_))/i.test(reference) && !allowed.has(reference)) blockers.push(`RECOVERY_ORPHAN_REFERENCE:${reference}`);
      visit(child);
    }
  };
  visit(planning);
  return [...new Set(blockers)];
}

function recoveryPlan(input: {
  project: ProjectRow;
  version: ProjectVersionRow;
  brief: BriefV3Document;
  planning: PlanningPackage;
  planningRow: DocumentRow;
  briefRow: DocumentRow;
  scope: PlanningReconciliationScope;
}): PlanningRecoveryPlan {
  const currentness = currentnessFor({ project: input.project, version: input.version, briefRow: input.briefRow, brief: input.brief, planningRow: input.planningRow, planning: input.planning });
  const payload = PlanningRecoveryPlanPayloadSchema.parse({
    schemaVersion: 1,
    authority: PLANNING_RECOVERY_AUTHORITY,
    mode: PLANNING_RECOVERY_MODE,
    policyVersion: PLANNING_RECOVERY_POLICY_VERSION,
    projectId: input.project.id,
    projectVersion: input.version.versionNumber,
    versionId: input.version.id,
    recoveryReason: "UNRECOVERABLE_CURRENT_PLANNING_STATE",
    currentness,
    briefChecksum: input.brief.briefChecksum,
    routePolicy: input.brief.brief.decisions.routePolicy.mode,
    decisions: input.brief.brief.decisions,
    planningOwnedRequirementIds: planningRequirements(input.brief.brief).map((entry) => entry.id).sort(),
    reconciliationScopeChecksum: input.scope.scopeChecksum,
    providerCapability: {
      contractVersion: 1,
      outputMode: "FULL_PLANNING_PACKAGE",
      canonicalBriefIsSoleSemanticAuthority: true,
      hostOwnedFields: ["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds"],
      forbiddenProviderActions: ["mutateCanonicalBrief", "mutateProject", "mutateWorkflow", "writePersistence", "approvePlanning", "inventRequirementIds", "inventBusinessFacts"],
    },
  });
  return PlanningRecoveryPlanSchema.parse({ ...payload, planChecksum: checksumPersistedDocument(payload) });
}

function downstreamBlockers(rows: readonly DocumentRow[], planning: PlanningPackage): string[] {
  const blockers: string[] = [];
  for (const row of rows) {
    const value = mapRowToDocument(row) as Record<string, unknown>;
    if (row.documentType === "selected-design") blockers.push("RECOVERY_SELECTED_DESIGN_EXISTS");
    if (row.documentType === "architecture" && (value.acceptance as { accepted?: unknown } | undefined)?.accepted === true) blockers.push("RECOVERY_ARCHITECTURE_ACCEPTED");
    if (row.documentType === "architecture-review" && (value.acceptedPlanningChecksum === planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY)) && (value.result as { verdict?: unknown } | undefined)?.verdict === "APPROVED") blockers.push("RECOVERY_ARCHITECTURE_REVIEW_CURRENT");
    if (row.documentType === "phase-7c-contract-package" && ((value.status === "APPROVED") || (value.planningAcceptance as { status?: unknown } | undefined)?.status === "APPROVED")) blockers.push("RECOVERY_PHASE_7C_ACCEPTED");
  }
  return blockers;
}

function buildProviderInput(input: { plan: PlanningRecoveryPlan; brief: BriefV3Document; compatibility: RequirementSpecification; project: ProjectRow; version: ProjectVersionRow; planning: PlanningPackage; planningRow: DocumentRow; operationKey: string }): PlanningRecoveryProviderInput {
  const plannerInput: PlannerAgentInput = PlannerAgentInputSchema.parse({
    projectId: input.project.id,
    projectVersion: input.version.versionNumber,
    approvedBrief: input.compatibility,
    canonicalBrief: input.brief.brief,
    approvedBriefChecksum: input.brief.briefChecksum,
    originalPromptReference: `factory-project:${input.project.original_prompt_checksum}`,
    clarificationEvidenceReferences: [],
    currentWorkflowState: input.project.workflow_state,
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: `planning-recovery:${input.operationKey}`,
    expectedRowVersion: input.project.row_version,
  });
  const planningEvidence = CurrentPlanningEvidenceSchema.parse({
    projectId: input.project.id,
    projectVersion: input.version.versionNumber,
    rowVersion: input.planningRow.rowVersion,
    semanticChecksum: planningSemanticChecksumForPolicy(input.planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
    documentChecksum: planningDocumentChecksum(input.planning),
    semanticChecksumPolicyVersion: CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY,
    accepted: false,
    structuralSummary: {
      routeCount: input.planning.sitemap.routes.length,
      pageCount: input.planning.pages.pages.length,
      formCount: input.planning.forms.forms.length,
      assetCount: input.planning.assets.entries.length,
      dependencyCount: input.planning.dependencies.dependencies.length,
      structuralChecksum: checksumPersistedDocument({ routes: input.planning.sitemap.routes.map((route) => route.path), pages: input.planning.pages.pages.map((page) => page.id), forms: input.planning.forms.forms.map((form) => form.id), assets: input.planning.assets.entries.map((asset) => asset.id), dependencies: input.planning.dependencies.dependencies.map((dependency) => dependency.name) }),
    },
    semanticAuthority: "CURRENT_CANONICAL_BRIEF_V3",
  });
  const providerInput = PlanningRecoveryProviderInputSchema.parse({
    authority: PLANNING_RECOVERY_AUTHORITY,
    mode: PLANNING_RECOVERY_MODE,
    plan: input.plan,
    canonicalBrief: input.brief.brief,
    planningOwnedRequirements: planningRequirements(input.brief.brief),
    plannerInput,
    currentPlanningEvidence: planningEvidence,
    contextPolicy: { maxBytes: 512_000, lossless: true, omittedSemanticFields: [] },
  });
  if (Buffer.byteLength(JSON.stringify(providerInput), "utf8") > providerInput.contextPolicy.maxBytes) throw new PlanningRecoveryError("CONTEXT_BOUND_EXCEEDED");
  return providerInput;
}

export class PlanningRecoveryService {
  constructor(private readonly dependencies: {
    database: PersistenceDatabase;
    memory: PlannerMemoryPort;
    provider: PlanningRecoveryProvider;
    hostRecoveryEnabled?: boolean;
    now?: () => string;
    fault?: PlanningRecoveryFaultInjector;
  }) {}

  async prepare(input: { projectId: string; projectVersion: number; operationKey: string }): Promise<PlanningRecoveryPreparation> {
    const state = await this.dependencies.database.transaction(async (tx) => {
      const project = await tx.getProject(input.projectId);
      const version = await tx.getVersion(input.projectId, input.projectVersion);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      const legacyRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
      const downstreamTypes = ["architecture", "phase-7c-contract-package", "architecture-review", "selected-design"];
      const downstream = (await Promise.all(downstreamTypes.map((documentType) => tx.getDocument(input.projectId, input.projectVersion, documentType)))).filter((row): row is DocumentRow => Boolean(row));
      const history = await tx.listBriefRevisionHistory(input.projectId, input.projectVersion);
      return { project, version, briefRow, planningRow, legacyRow, downstream, history };
    });
    const fail = (reason: PlanningRecoveryEligibility["reason"], blockers: string[], count = 0, scope?: PlanningReconciliationScope): PlanningRecoveryPreparation => ({
      eligibility: PlanningRecoveryEligibilitySchema.parse({ eligible: false, blockers: [...new Set(blockers)], reason, planningOwnedRequirementCount: count, currentCoverage: [] }),
      ...(scope ? { scope } : {}),
    });
    if (!this.dependencies.hostRecoveryEnabled) return fail("HOST_RECOVERY_NOT_AUTHORIZED", ["RECOVERY_HOST_AUTHORIZATION_REQUIRED"]);
    if (!this.dependencies.provider.planRecovery) return fail("PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE", ["RECOVERY_PROVIDER_CAPABILITY_REQUIRED"]);
    if (!state.project || !state.version || !state.briefRow || !state.planningRow) return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_REQUIRED_DOCUMENT_MISSING"]);
    if (state.project.current_version !== input.projectVersion || state.project.workflow_state !== "AWAITING_DESIGN_SELECTION" || state.version.immutable) return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_PROJECT_CURRENTNESS_INVALID"]);
    let brief: BriefV3Document;
    let planning: PlanningPackage;
    let legacy: RequirementSpecification | null = null;
    try {
      const briefValue = mapRowToDocument(state.briefRow);
      const planningValue = mapRowToDocument(state.planningRow);
      brief = BriefV3DocumentSchema.parse(briefValue);
      planning = PlanningPackageSchema.parse(planningValue);
      if (state.legacyRow) {
        const legacyValue = mapRowToDocument(state.legacyRow);
        if (legacyValue.documentType === "requirements") legacy = RequirementSpecificationSchema.parse(legacyValue);
      }
    } catch (error) {
      return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_DOCUMENT_CONTRACT_INVALID", error instanceof Error ? error.message : "RECOVERY_DOCUMENT_CONTRACT_INVALID"]);
    }
    const count = planningRequirements(brief.brief).length;
    if (!brief.approval?.approved || brief.approval.approvedCanonicalChecksum !== brief.briefChecksum) return fail("BRIEF_NOT_CURRENT_APPROVED", ["RECOVERY_BRIEF_NOT_APPROVED"], count);
    if (planning.accepted || planning.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY) return fail("PLANNING_NOT_CURRENT", ["RECOVERY_PLANNING_CURRENTNESS_INVALID"], count);
    const readiness = evaluateBriefReadiness({ brief: brief.brief });
    if (!readiness.readyForApproval) return fail("CANONICAL_UNRESOLVED", readiness.approvalBlockers.map((blocker) => "target" in blocker ? `RECOVERY_MISSING_USER_DECISION:${blocker.target}` : `RECOVERY_BRIEF_READINESS:${blocker.code}`), count);
    if (brief.brief.unresolved.some((item) => canonicalUnresolvedBlocksStage(brief.brief, item, "PLANNING"))) return fail("CANONICAL_UNRESOLVED", ["RECOVERY_CANONICAL_UNRESOLVED"], count);
    const compatibility = compatibilityBrief(state.project, state.version, brief, legacy);
    const current = reconciliationCurrentness(currentnessFor({ project: state.project, version: state.version, briefRow: state.briefRow, brief, planningRow: state.planningRow, planning }), brief, planning);
    let historyAvailable = false;
    if (planning.approvedBriefChecksum !== brief.briefChecksum) {
      try {
        computePlanningBriefDeltaFromHistory({ baseBriefChecksum: planning.approvedBriefChecksum, targetBrief: brief.brief, history: state.history });
        historyAvailable = true;
      } catch { historyAvailable = false; }
    }
    current.historicalDeltaAvailable = historyAvailable;
    let scope: PlanningReconciliationScope;
    const coverage = analyzePlanningRequirementCoverage({ candidate: planning, canonicalBrief: brief.brief });
    try {
      scope = derivePlanningReconciliationScope({ currentApprovedBrief: brief.brief, currentPlanning: planning, currentness: current, coverageEvidence: coverage });
    } catch (error) {
      return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_RECONCILIATION_SCOPE_INVALID", error instanceof Error ? error.message : "RECOVERY_RECONCILIATION_SCOPE_INVALID"], count);
    }
    const coverageMissing = validatePlanningRequirementCoverage({ candidate: planning, canonicalBrief: brief.brief }).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category));
    if (historyAvailable || scope.currentnessStates.provenanceCertified || current.historicalDeltaAvailable) return fail("HISTORICAL_DELTA_AVAILABLE", ["RECOVERY_HISTORICAL_DELTA_PREFERRED"], count, scope);
    if (scope.admissibleForProviderCall && coverageMissing.length === 0) return fail("BOUNDED_RECONCILIATION_SUFFICIENT", ["RECOVERY_BOUNDED_RECONCILIATION_SUFFICIENT"], count, scope);
    const downstream = downstreamBlockers(state.downstream, planning);
    if (downstream.length) return fail("DOWNSTREAM_STATE_NOT_STALE", downstream, count, scope);
    let plan: PlanningRecoveryPlan;
    let providerInput: PlanningRecoveryProviderInput;
    try {
      plan = recoveryPlan({ project: state.project, version: state.version, brief, planning, planningRow: state.planningRow, briefRow: state.briefRow, scope });
      providerInput = buildProviderInput({ plan, brief, compatibility, project: state.project, version: state.version, planning, planningRow: state.planningRow, operationKey: input.operationKey });
    } catch (error) {
      if (error instanceof PlanningRecoveryError && error.code === "CONTEXT_BOUND_EXCEEDED") return fail("CONTEXT_BOUND_EXCEEDED", [error.code], count, scope);
      return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_PLAN_INVALID"], count, scope);
    }
    const eligibility = PlanningRecoveryEligibilitySchema.parse({ eligible: true, blockers: [], reason: "RECOVERY_REQUIRED", planningOwnedRequirementCount: count, currentCoverage: coverageMissing.map((entry) => ({ requirementId: entry.requirementId, category: entry.category, reason: entry.reason })) });
    return { eligibility, scope, plan, providerInput };
  }

  async recover(input: { projectId: string; projectVersion: number; operationKey: string; approvedSkills?: readonly ApprovedProceduralSkillContext[]; skillContextIdentity?: string }): Promise<PlanningRecoveryResult> {
    const existing = await this.dependencies.database.transaction((tx) => tx.getPlanningRecoveryEvidence(input.projectId, input.projectVersion, input.operationKey));
    if (existing) return this.replayIfCurrent(input, PlanningRecoveryEvidenceSchema.parse(existing));
    const preparation = await this.prepare(input);
    if (!preparation.eligibility.eligible || !preparation.plan || !preparation.providerInput) throw new PlanningRecoveryError(preparation.eligibility.reason, "Planning recovery is not eligible.", preparation.eligibility);
    if (!this.dependencies.provider.planRecovery) throw new PlanningRecoveryError("PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE");
    let candidate: PlanningPackage;
    try {
      candidate = PlanningPackageSchema.parse(await this.dependencies.provider.planRecovery(preparation.providerInput, input.approvedSkills, input.skillContextIdentity));
    } catch (error) {
      throw new PlanningRecoveryError("RECOVERY_PROVIDER_FAILED", "Planning recovery provider failed.", error);
    }
    return this.apply({ ...input, plan: preparation.plan, providerInput: preparation.providerInput, candidate });
  }

  async apply(input: { projectId: string; projectVersion: number; operationKey: string; plan: PlanningRecoveryPlan; providerInput?: PlanningRecoveryProviderInput; candidate: PlanningPackage }): Promise<PlanningRecoveryResult> {
    if (!this.dependencies.hostRecoveryEnabled) throw new PlanningRecoveryError("HOST_RECOVERY_NOT_AUTHORIZED");
    const plan = PlanningRecoveryPlanSchema.parse(input.plan);
    if (checksumPersistedDocument(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planChecksum"))) !== plan.planChecksum) throw new PlanningRecoveryError("RECOVERY_PLAN_CHECKSUM_INVALID");
    const state = await this.dependencies.database.transaction(async (tx) => {
      const project = await tx.getProject(input.projectId);
      const version = await tx.getVersion(input.projectId, input.projectVersion);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      if (!project || !version || !briefRow || !planningRow) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      if (project.row_version !== plan.currentness.projectRowVersion || project.current_version !== plan.projectVersion || project.workflow_state !== plan.currentness.workflowState || version.rowVersion !== plan.currentness.projectVersionRowVersion || briefRow.rowVersion !== plan.currentness.briefRowVersion || briefRow.checksum !== plan.currentness.briefDocumentChecksum || planningRow.rowVersion !== plan.currentness.planningRowVersion || planningRow.checksum !== plan.currentness.planningDocumentChecksum) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
      const legacyRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
      const legacy = legacyRow && mapRowToDocument(legacyRow).documentType === "requirements" ? RequirementSpecificationSchema.parse(mapRowToDocument(legacyRow)) : null;
      if (brief.briefChecksum !== plan.briefChecksum || planning.approvedBriefChecksum !== plan.currentness.planningApprovedBriefChecksum || planning.accepted) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      const compatibility = compatibilityBrief(project, version, brief, legacy);
      const rawCandidate = PlanningPackageSchema.parse(input.candidate);
      const providerFieldBlockers = [
        rawCandidate.projectId !== input.projectId && rawCandidate.projectId !== undefined ? "RECOVERY_PROVIDER_PROJECT_ID" : undefined,
        rawCandidate.projectVersion !== input.projectVersion && rawCandidate.projectVersion !== undefined ? "RECOVERY_PROVIDER_PROJECT_VERSION" : undefined,
        rawCandidate.approvedBriefChecksum !== brief.briefChecksum && rawCandidate.approvedBriefChecksum !== undefined ? "RECOVERY_PROVIDER_BRIEF_CHECKSUM" : undefined,
        rawCandidate.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY && rawCandidate.semanticChecksumPolicyVersion !== undefined ? "RECOVERY_PROVIDER_CHECKSUM_POLICY" : undefined,
        rawCandidate.accepted ? "RECOVERY_PROVIDER_ACCEPTED" : undefined,
        rawCandidate.acceptance.acceptedAt ? "RECOVERY_PROVIDER_ACCEPTANCE" : undefined,
      ].filter((value): value is string => Boolean(value));
      let admission;
      try {
        admission = admitPlanningRefresh({ candidate: rawCandidate, canonicalBrief: brief.brief, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: brief.briefChecksum, timestamp: this.dependencies.now?.() ?? new Date().toISOString() });
      } catch (error) {
        throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", [error instanceof Error ? error.message : "PLANNING_ADMISSION_FAILED"]);
      }
      const candidate = normalizePlanningPackageForHost({ candidate: admission.candidate, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: brief.briefChecksum, canonicalBrief: brief.brief, timestamp: this.dependencies.now?.() ?? new Date().toISOString() });
      const blockers = [...admission.blockers, ...validatePlanningAdmission(candidate).blockers, ...validatePlanningPackageAgainstBrief(compatibility, candidate), ...canonicalDecisionBlockers(brief.brief, compatibility, candidate), ...unsupportedBusinessFacts(brief.brief, candidate), ...referenceBlockers(brief.brief, candidate)];
      const coverage = validatePlanningRequirementCoverage({ candidate, canonicalBrief: brief.brief }).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category));
      if (coverage.length) blockers.push(`RECOVERY_COVERAGE_INCOMPLETE:${coverage.map((entry) => entry.requirementId).slice(0, 8).join(",")}`);
      blockers.push(...providerFieldBlockers);
      if (candidate.projectId !== plan.projectId || candidate.projectVersion !== plan.projectVersion || candidate.approvedBriefChecksum !== plan.briefChecksum || candidate.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY || candidate.accepted || candidate.acceptance.acceptedAt) blockers.push("RECOVERY_HOST_OWNED_FIELD_MUTATION");
      if (blockers.length) throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", [...new Set(blockers)]);
      const existingEvidence = await tx.getPlanningRecoveryEvidence(input.projectId, input.projectVersion, input.operationKey);
      if (existingEvidence) {
        if (existingEvidence.nextPlanningDocumentChecksum !== planningDocumentChecksum(candidate)) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
        return { status: "REPLAYED" as const, package: candidate, evidence: PlanningRecoveryEvidenceSchema.parse(existingEvidence) };
      }
      const now = this.dependencies.now?.() ?? new Date().toISOString();
      await saveDocumentCASInTransaction(tx, candidate, planningRow.rowVersion, planningRow.checksum);
      await this.dependencies.fault?.hit("after-package-write");
      const evidence = PlanningRecoveryEvidenceSchema.parse({ id: deterministicUuid(`${input.projectId}:${input.projectVersion}:${input.operationKey}`), operationKey: input.operationKey, projectId: input.projectId, projectVersion: input.projectVersion, recoveryPlanChecksum: plan.planChecksum, briefRowVersion: briefRow.rowVersion, briefSemanticChecksum: brief.briefChecksum, briefDocumentChecksum: briefRow.checksum, priorPlanningRowVersion: planningRow.rowVersion, priorPlanningSemanticChecksum: planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), priorPlanningDocumentChecksum: planningDocumentChecksum(planning), priorPlanningPackage: planning, nextPlanningRowVersion: planningRow.rowVersion + 1, nextPlanningSemanticChecksum: planningSemanticChecksumForPolicy(candidate, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), nextPlanningDocumentChecksum: planningDocumentChecksum(candidate), createdAt: now });
      const storedEvidence = await tx.appendPlanningRecoveryEvidence(evidence);
      await this.dependencies.fault?.hit("after-evidence-write");
      await this.dependencies.fault?.hit("before-db-commit");
      return { status: "COMMITTED" as const, package: candidate, evidence: PlanningRecoveryEvidenceSchema.parse(storedEvidence) };
    });
    if (state.status === "COMMITTED") {
      try {
        await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "planning-package.json": state.package, "architecture.json": state.package.architecture, "content-plan.json": state.package.content, "asset-manifest.json": state.package.assets });
      } catch (error) {
        throw new PlanningRecoveryError("RECOVERY_PROJECTION_FAILED", "Planning recovery committed, but the derived Project Memory projection failed.", error);
      }
    }
    return state;
  }

  private async replayIfCurrent(input: { projectId: string; projectVersion: number; operationKey: string }, evidence: PlanningRecoveryEvidence): Promise<PlanningRecoveryResult> {
    const current = await this.dependencies.database.transaction((tx) => tx.getDocument(input.projectId, input.projectVersion, "planning-package"));
    if (!current || current.checksum !== evidence.nextPlanningDocumentChecksum) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT", "The recovery operation key is bound to a different current Planning package.");
    const packageValue = PlanningPackageSchema.parse(mapRowToDocument(current));
    return { status: "REPLAYED", package: packageValue, evidence };
  }
}
