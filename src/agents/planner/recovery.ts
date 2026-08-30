import { createHash, randomUUID } from "node:crypto";
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
  validatePlanningRecoveryRequirementCoverage,
  validatePlanningRecoveryRouteManifest,
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
import {
  PlanningRecoveryRunSchema,
  PlanningRecoveryDiagnosticSummarySchema,
  isLeaseActive,
  isPlanningRecoveryRunTerminal,
  PLANNING_RECOVERY_RUN_LEASE_MS,
  PLANNING_RECOVERY_RUN_RESULT_MAX_BYTES,
  type PlanningRecoveryRunRow,
  type PlanningRecoveryRunTransition,
} from "./recovery-runs";
import {
  CanonicalPlanningRouteManifestSchema,
  PlanningOwnedRequirementManifestSchema,
  PLANNING_RECOVERY_OUTPUT_POLICY,
  PlanningRecoveryOutputPolicySchema,
  createCanonicalPlanningRouteManifest,
  createPlanningOwnedRequirementManifest,
  requirementManifestAsCanonicalRequirements,
} from "./recovery-manifests";

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
  canonicalRouteManifest: CanonicalPlanningRouteManifestSchema.optional(),
  planningRequirementManifest: PlanningOwnedRequirementManifestSchema.optional(),
  reconciliationScopeChecksum: Sha256Schema,
  providerCapability: z.object({
    contractVersion: z.union([z.literal(1), z.literal(2)]),
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
  canonicalRouteManifest: CanonicalPlanningRouteManifestSchema,
  planningRequirementManifest: PlanningOwnedRequirementManifestSchema,
  planningOwnedRequirements: z.array(CanonicalRequirementSchema).max(512),
  plannerInput: PlannerAgentInputSchema,
  currentPlanningEvidence: CurrentPlanningEvidenceSchema,
  contextPolicy: z.object({
    maxBytes: z.number().int().positive(),
    lossless: z.literal(true),
    omittedSemanticFields: z.array(z.string()).length(0),
  }).strict(),
  outputPolicy: PlanningRecoveryOutputPolicySchema,
}).strict().superRefine((value, context) => {
  if (value.plan.canonicalRouteManifest?.manifestChecksum !== value.canonicalRouteManifest.manifestChecksum) context.addIssue({ code: "custom", path: ["canonicalRouteManifest"], message: "Provider route manifest does not match the recovery plan." });
  if (value.plan.planningRequirementManifest?.manifestChecksum !== value.planningRequirementManifest.manifestChecksum) context.addIssue({ code: "custom", path: ["planningRequirementManifest"], message: "Provider requirement manifest does not match the recovery plan." });
  if (value.canonicalRouteManifest.routePolicy !== value.plan.routePolicy) context.addIssue({ code: "custom", path: ["canonicalRouteManifest", "routePolicy"], message: "Provider route manifest policy does not match the recovery plan." });
  const manifestIds = value.planningRequirementManifest.requirements.map((entry) => entry.requirementId);
  const planIds = [...value.plan.planningOwnedRequirementIds].sort();
  if (JSON.stringify([...manifestIds].sort()) !== JSON.stringify(planIds)) context.addIssue({ code: "custom", path: ["planningRequirementManifest", "requirements"], message: "Provider requirement manifest identities do not match the recovery plan." });
  const inputIds = value.planningOwnedRequirements.map((entry) => entry.id);
  if (JSON.stringify([...inputIds].sort()) !== JSON.stringify([...manifestIds].sort())) context.addIssue({ code: "custom", path: ["planningOwnedRequirements"], message: "Provider requirement input does not match the host-owned manifest." });
});
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
  execution?: {
    durableExecutionReady: boolean;
    existingRunState: PlanningRecoveryRunRow["state"] | null;
    providerAttemptCount: number;
    conflict: boolean;
  };
};

export type PlanningRecoveryProvider = {
  planRecovery(input: PlanningRecoveryProviderInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<PlanningPackage>;
};

export type PlanningRecoveryResult = {
  status: "COMMITTED" | "REPLAYED";
  package: PlanningPackage;
  evidence: PlanningRecoveryEvidence;
};

export type PlanningRecoveryFaultPoint = "before-run-creation" | "after-run-creation" | "after-provider-call-started" | "after-provider-return-before-result" | "after-provider-result" | "after-admission-started" | "after-admission-passed" | "after-persistence-started" | "after-package-write" | "after-evidence-write" | "before-db-commit" | "after-canonical-commit-before-run-terminal";
export type PlanningRecoveryFaultInjector = { hit(point: PlanningRecoveryFaultPoint): void | Promise<void> };

export class PlanningRecoveryError extends Error {
  constructor(readonly code: string, message = code, readonly details?: unknown) {
    super(Array.isArray(details) ? `${message} [${details.slice(0, 8).join(",")}${details.length > 8 ? ",..." : ""}]` : message);
    this.name = "PlanningRecoveryError";
  }
}

/** Synthetic process-detach signal used by crash-recovery tests; it is never a provider or persistence failure. */
export class PlanningRecoveryCrash extends Error {
  constructor(readonly point: PlanningRecoveryFaultPoint) {
    super(`Planning recovery process detached at ${point}.`);
    this.name = "PlanningRecoveryCrash";
  }
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
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

function admitRecoveryCandidate(input: { candidate: PlanningPackage; projectId: string; projectVersion: number; plan: PlanningRecoveryPlan; brief: BriefV3Document; planning: PlanningPackage; compatibility: RequirementSpecification; now: string }) {
  const rawCandidate = PlanningPackageSchema.parse(input.candidate);
  const providerFieldBlockers = [
    rawCandidate.projectId !== input.projectId && rawCandidate.projectId !== undefined ? "RECOVERY_PROVIDER_PROJECT_ID" : undefined,
    rawCandidate.projectVersion !== input.projectVersion && rawCandidate.projectVersion !== undefined ? "RECOVERY_PROVIDER_PROJECT_VERSION" : undefined,
    rawCandidate.approvedBriefChecksum !== input.brief.briefChecksum && rawCandidate.approvedBriefChecksum !== undefined ? "RECOVERY_PROVIDER_BRIEF_CHECKSUM" : undefined,
    rawCandidate.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY && rawCandidate.semanticChecksumPolicyVersion !== undefined ? "RECOVERY_PROVIDER_CHECKSUM_POLICY" : undefined,
    rawCandidate.accepted ? "RECOVERY_PROVIDER_ACCEPTED" : undefined,
    rawCandidate.acceptance.acceptedAt ? "RECOVERY_PROVIDER_ACCEPTANCE" : undefined,
  ].filter((value): value is string => Boolean(value));
  let admission;
  try {
    admission = admitPlanningRefresh({ candidate: rawCandidate, canonicalBrief: input.brief.brief, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.brief.briefChecksum, timestamp: input.now });
  } catch (error) {
    throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", [error instanceof Error ? error.message : "PLANNING_ADMISSION_FAILED"]);
  }
  const candidate = normalizePlanningPackageForHost({ candidate: admission.candidate, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.brief.briefChecksum, canonicalBrief: input.brief.brief, timestamp: input.now });
  const blockers = [
    ...admission.blockers,
    ...validatePlanningAdmission(candidate).blockers,
    ...validatePlanningPackageAgainstBrief(input.compatibility, candidate),
    ...canonicalDecisionBlockers(input.brief.brief, input.compatibility, candidate),
    ...unsupportedBusinessFacts(input.brief.brief, candidate),
    ...referenceBlockers(input.brief.brief, candidate),
    ...(input.plan.canonicalRouteManifest ? validatePlanningRecoveryRouteManifest({ candidate, manifest: input.plan.canonicalRouteManifest }) : []),
  ];
  const coverage = input.plan.planningRequirementManifest
    ? validatePlanningRecoveryRequirementCoverage({ candidate, manifest: input.plan.planningRequirementManifest })
    : validatePlanningRequirementCoverage({ candidate, canonicalBrief: input.brief.brief }).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category));
  blockers.push(...coverage.map((entry) => `RECOVERY_COVERAGE_INCOMPLETE:${entry.requirementId}:${entry.reason}`));
  blockers.push(...providerFieldBlockers);
  if (candidate.projectId !== input.plan.projectId || candidate.projectVersion !== input.plan.projectVersion || candidate.approvedBriefChecksum !== input.plan.briefChecksum || candidate.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY || candidate.accepted || candidate.acceptance.acceptedAt) blockers.push("RECOVERY_HOST_OWNED_FIELD_MUTATION");
  if (blockers.length) throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", [...new Set(blockers)]);
  return candidate;
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
  const canonicalRouteManifest = createCanonicalPlanningRouteManifest(input.brief.brief);
  const planningRequirementManifest = createPlanningOwnedRequirementManifest(input.brief.brief);
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
    planningOwnedRequirementIds: planningRequirementManifest.requirements.map((entry) => entry.requirementId).sort(),
    canonicalRouteManifest,
    planningRequirementManifest,
    reconciliationScopeChecksum: input.scope.scopeChecksum,
    providerCapability: {
      contractVersion: 2,
      outputMode: "FULL_PLANNING_PACKAGE",
      canonicalBriefIsSoleSemanticAuthority: true,
      hostOwnedFields: ["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds"],
      forbiddenProviderActions: ["mutateCanonicalBrief", "mutateProject", "mutateWorkflow", "writePersistence", "approvePlanning", "inventRequirementIds", "inventBusinessFacts"],
    },
  });
  return PlanningRecoveryPlanSchema.parse({ ...payload, planChecksum: checksumPersistedDocument(payload) });
}

function recoveryRunFromPreparation(input: { plan: PlanningRecoveryPlan; operationKey: string; now: string }): PlanningRecoveryRunRow {
  const current = input.plan.currentness;
  return PlanningRecoveryRunSchema.parse({
    runId: deterministicUuid(`${input.plan.projectId}:${input.plan.projectVersion}:${input.operationKey}`),
    operationKey: input.operationKey,
    projectId: input.plan.projectId,
    projectVersion: input.plan.projectVersion,
    versionId: input.plan.versionId,
    expectedSourceHead: null,
    recoveryPlanChecksum: input.plan.planChecksum,
    recoveryPlan: input.plan,
    projectRowVersion: current.projectRowVersion,
    projectVersionRowVersion: current.projectVersionRowVersion,
    briefRowVersion: current.briefRowVersion,
    briefSemanticChecksum: current.briefSemanticChecksum,
    briefDocumentChecksum: current.briefDocumentChecksum,
    planningRowVersion: current.planningRowVersion,
    planningSemanticChecksum: current.planningSemanticChecksum,
    planningDocumentChecksum: current.planningDocumentChecksum,
    providerBudget: 1,
    providerAttemptCount: 0,
    state: "CREATED",
    providerResultChecksum: null,
    providerResult: null,
    providerRequestId: null,
    providerModel: null,
    providerErrorClass: null,
    providerErrorCode: null,
    diagnosticStage: null,
    diagnosticCode: null,
    diagnosticMessage: null,
    diagnosticSummary: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    terminalOutcome: null,
    committedEvidenceId: null,
    projectMemoryStatus: "PENDING",
    projectMemoryFailureCode: null,
    projectMemoryFailureMessage: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function safeRunDiagnostic(error: unknown, stage: string) {
  const raw = error instanceof PlanningRecoveryError ? error.code : error instanceof Error ? error.constructor.name : "UnknownError";
  const code = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(raw) ? raw.slice(0, 160) : "RECOVERY_STAGE_FAILED";
  const summary = stage === "admission" && error instanceof PlanningRecoveryError && Array.isArray(error.details)
    ? diagnosticSummary(error.details)
    : null;
  return { diagnosticStage: stage, diagnosticCode: code, diagnosticMessage: `Planning recovery ${stage} failed safely.`, diagnosticSummary: summary, providerErrorClass: stage === "provider" ? code : null, providerErrorCode: stage === "provider" ? code : null } as const;
}

function diagnosticSummary(details: readonly unknown[]) {
  const blockers = details.filter((detail): detail is string => typeof detail === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(detail));
  if (!blockers.length) return null;
  const categoryCounts = { route: 0, coverage: 0, decision: 0, identity: 0, unsupportedFact: 0, schema: 0, other: 0 };
  for (const blocker of blockers) {
    if (/ROUTE|PAGE_MANIFEST|NAVIGATION/.test(blocker)) categoryCounts.route++;
    else if (/COVERAGE/.test(blocker)) categoryCounts.coverage++;
    else if (/DECISION|FORM_|BACKEND/.test(blocker)) categoryCounts.decision++;
    else if (/REFERENCE|IDENTITY|HOST_OWNED/.test(blocker)) categoryCounts.identity++;
    else if (/UNSUPPORTED/.test(blocker)) categoryCounts.unsupportedFact++;
    else if (/SCHEMA|CANDIDATE_INVALID|PROVIDER_/.test(blocker)) categoryCounts.schema++;
    else categoryCounts.other++;
  }
  return PlanningRecoveryDiagnosticSummarySchema.parse({ totalBlockers: blockers.length, returnedBlockers: Math.min(blockers.length, 64), truncated: blockers.length > 64, blockerCategoryCounts: categoryCounts, blockers: blockers.slice(0, 64) });
}

function recoveryProjectionDocuments(candidate: PlanningPackage) {
  return { "planning-package.json": candidate, "architecture.json": candidate.architecture, "content-plan.json": candidate.content, "asset-manifest.json": candidate.assets };
}

function recoveryProjectionChecksums(candidate: PlanningPackage) {
  return Object.fromEntries(Object.entries(recoveryProjectionDocuments(candidate)).map(([name, value]) => [name, checksumPersistedDocument(value)]));
}

function assertRecoveryCurrentness(input: { project: ProjectRow; version: ProjectVersionRow; briefRow: DocumentRow; brief: BriefV3Document; planningRow: DocumentRow; planning: PlanningPackage; plan: PlanningRecoveryPlan }) {
  const current = input.plan.currentness;
  if (input.project.row_version !== current.projectRowVersion || input.project.current_version !== input.plan.projectVersion || input.project.workflow_state !== current.workflowState || input.version.rowVersion !== current.projectVersionRowVersion || input.briefRow.rowVersion !== current.briefRowVersion || input.briefRow.checksum !== current.briefDocumentChecksum || input.planningRow.rowVersion !== current.planningRowVersion || input.planningRow.checksum !== current.planningDocumentChecksum || input.brief.briefChecksum !== input.plan.briefChecksum || input.planning.approvedBriefChecksum !== current.planningApprovedBriefChecksum || input.planning.accepted) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
}

function parseRecoveryPlan(run: PlanningRecoveryRunRow) {
  const plan = PlanningRecoveryPlanSchema.parse(run.recoveryPlan);
  const withoutChecksum = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planChecksum"));
  if (checksumPersistedDocument(withoutChecksum) !== plan.planChecksum || run.recoveryPlanChecksum !== plan.planChecksum) throw new PlanningRecoveryError("RECOVERY_PLAN_CHECKSUM_INVALID");
  return plan;
}

function parseDurableCandidate(run: PlanningRecoveryRunRow) {
  if (!run.providerResult || !run.providerResultChecksum) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_MISSING");
  const candidate = PlanningPackageSchema.parse(run.providerResult);
  if (checksumPersistedDocument(candidate) !== run.providerResultChecksum) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_CHECKSUM_INVALID");
  return candidate;
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
  if (!input.plan.canonicalRouteManifest || !input.plan.planningRequirementManifest) throw new PlanningRecoveryError("RECOVERY_PLAN_INVALID");
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
    canonicalRouteManifest: input.plan.canonicalRouteManifest,
    planningRequirementManifest: input.plan.planningRequirementManifest,
    planningOwnedRequirements: requirementManifestAsCanonicalRequirements(input.plan.planningRequirementManifest),
    plannerInput,
    currentPlanningEvidence: planningEvidence,
    contextPolicy: { maxBytes: 512_000, lossless: true, omittedSemanticFields: [] },
    outputPolicy: PLANNING_RECOVERY_OUTPUT_POLICY,
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

  private now() { return this.dependencies.now?.() ?? new Date().toISOString(); }
  private leaseExpiresAt(now: string) { return new Date(Date.parse(now) + PLANNING_RECOVERY_RUN_LEASE_MS).toISOString(); }

  private async markRunTerminal(run: PlanningRecoveryRunRow, to: PlanningRecoveryRunRow["state"], owner: string | undefined, error: unknown, stage: string) {
    const diagnostic = safeRunDiagnostic(error, stage);
    try {
      return await this.dependencies.database.transaction((tx) => tx.transitionPlanningRecoveryRun({ runId: run.runId, operationKey: run.operationKey, from: run.state, to, now: this.now(), ...(owner ? { owner } : {}), patch: diagnostic }));
    } catch {
      return null;
    }
  }

  private async readCanonicalState(plan: PlanningRecoveryPlan) {
    return this.dependencies.database.transaction(async (tx) => {
      const project = await tx.getProject(plan.projectId);
      const version = await tx.getVersion(plan.projectId, plan.projectVersion);
      const briefRow = await tx.getDocument(plan.projectId, plan.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(plan.projectId, plan.projectVersion, "planning-package");
      if (!project || !version || !briefRow || !planningRow) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
      assertRecoveryCurrentness({ project, version, briefRow, brief, planningRow, planning, plan });
      const legacyRow = await tx.getDocument(plan.projectId, plan.projectVersion, "requirements");
      const legacy = legacyRow && mapRowToDocument(legacyRow).documentType === "requirements" ? RequirementSpecificationSchema.parse(mapRowToDocument(legacyRow)) : null;
      return { project, version, briefRow, brief, planningRow, planning, compatibility: compatibilityBrief(project, version, brief, legacy) };
    });
  }

  private async persistRun(input: { run: PlanningRecoveryRunRow; from: PlanningRecoveryRunRow["state"]; to: PlanningRecoveryRunRow["state"]; owner?: string; patch?: PlanningRecoveryRunTransition["patch"] }) {
    return this.dependencies.database.transaction((tx) => tx.transitionPlanningRecoveryRun({ runId: input.run.runId, operationKey: input.run.operationKey, from: input.from, to: input.to, now: this.now(), ...(input.owner ? { owner: input.owner } : {}), ...(input.patch ? { patch: input.patch } : {}) }));
  }

  private async projection(run: PlanningRecoveryRunRow, candidate: PlanningPackage): Promise<void> {
    const documents = recoveryProjectionDocuments(candidate);
    const expected = recoveryProjectionChecksums(candidate);
    let alreadySynchronized = false;
    try {
      const actual = await this.dependencies.memory.checksums(run.projectId, run.projectVersion);
      alreadySynchronized = Object.keys(expected).length === Object.keys(actual).length && Object.entries(expected).every(([name, checksum]) => actual[name] === checksum);
    } catch {
      alreadySynchronized = false;
    }
    try {
      if (!alreadySynchronized) await this.dependencies.memory.writeSnapshot(run.projectId, run.projectVersion, documents);
      await this.dependencies.database.transaction((tx) => tx.updatePlanningRecoveryRunProjection({ runId: run.runId, operationKey: run.operationKey, now: this.now(), status: "SYNCED" }));
    } catch (error) {
      const diagnostic = safeRunDiagnostic(error, "project-memory");
      await this.dependencies.database.transaction((tx) => tx.updatePlanningRecoveryRunProjection({ runId: run.runId, operationKey: run.operationKey, now: this.now(), status: "FAILED", failureCode: diagnostic.diagnosticCode, failureMessage: diagnostic.diagnosticMessage })).catch(() => undefined);
      throw new PlanningRecoveryError("RECOVERY_PROJECTION_FAILED", "Planning recovery committed, but Project Memory reconciliation is pending.", { committed: true, diagnostic: diagnostic.diagnosticCode });
    }
  }

  private async replayRun(run: PlanningRecoveryRunRow): Promise<PlanningRecoveryResult> {
    if (run.projectMemoryStatus === "FAILED") throw new PlanningRecoveryError("RECOVERY_PROJECTION_FAILED", "Project Memory synchronization failed for this committed recovery; no automatic retry is permitted.", { committed: true, diagnostic: run.projectMemoryFailureCode });
    const state = await this.dependencies.database.transaction(async (tx) => {
      const evidence = await tx.getPlanningRecoveryEvidence(run.projectId, run.projectVersion, run.operationKey);
      const current = await tx.getDocument(run.projectId, run.projectVersion, "planning-package");
      if (!evidence || !current || evidence.id !== run.committedEvidenceId || evidence.recoveryPlanChecksum !== run.recoveryPlanChecksum || current.checksum !== evidence.nextPlanningDocumentChecksum) throw new PlanningRecoveryError("RECOVERY_COMMIT_RECONCILIATION_REQUIRED");
      return { evidence: PlanningRecoveryEvidenceSchema.parse(evidence), package: PlanningPackageSchema.parse(mapRowToDocument(current)) };
    });
    await this.projection(run, state.package);
    return { status: "REPLAYED", package: state.package, evidence: state.evidence };
  }

  private async reconcileCommitted(run: PlanningRecoveryRunRow, owner: string) {
    if (run.state !== "PERSISTENCE_STARTED") return null;
    const state = await this.dependencies.database.transaction(async (tx) => {
      const evidence = await tx.getPlanningRecoveryEvidence(run.projectId, run.projectVersion, run.operationKey);
      const current = await tx.getDocument(run.projectId, run.projectVersion, "planning-package");
      return evidence && current && evidence.recoveryPlanChecksum === run.recoveryPlanChecksum && current.checksum === evidence.nextPlanningDocumentChecksum ? { evidence: PlanningRecoveryEvidenceSchema.parse(evidence), package: PlanningPackageSchema.parse(mapRowToDocument(current)) } : null;
    });
    if (!state) return null;
    const reconciled = await this.persistRun({ run, from: "PERSISTENCE_STARTED", to: "COMMITTED_RECONCILED", owner, patch: { committedEvidenceId: state.evidence.id, projectMemoryStatus: "PENDING" } });
    await this.projection(reconciled, state.package);
    return { status: "REPLAYED" as const, package: state.package, evidence: state.evidence };
  }

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
      const recoveryRun = await tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey);
      return { project, version, briefRow, planningRow, legacyRow, downstream, history, recoveryRun };
    });
    const execution = {
      durableExecutionReady: !state.recoveryRun || state.recoveryRun.state === "CREATED",
      existingRunState: state.recoveryRun?.state ?? null,
      providerAttemptCount: state.recoveryRun?.providerAttemptCount ?? 0,
      conflict: Boolean(state.recoveryRun && !isPlanningRecoveryRunTerminal(state.recoveryRun.state)),
    };
    const fail = (reason: PlanningRecoveryEligibility["reason"], blockers: string[], count = 0, scope?: PlanningReconciliationScope): PlanningRecoveryPreparation => ({
      eligibility: PlanningRecoveryEligibilitySchema.parse({ eligible: false, blockers: [...new Set(blockers)], reason, planningOwnedRequirementCount: count, currentCoverage: [] }),
      ...(scope ? { scope } : {}),
      execution,
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
    const count = createPlanningOwnedRequirementManifest(brief.brief).requirements.length;
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
    return { eligibility, scope, plan, providerInput, execution };
  }

  async recover(input: { projectId: string; projectVersion: number; operationKey: string; approvedSkills?: readonly ApprovedProceduralSkillContext[]; skillContextIdentity?: string }): Promise<PlanningRecoveryResult> {
    let run = await this.dependencies.database.transaction((tx) => tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey));
    let preparation: PlanningRecoveryPreparation | undefined;
    let providerInput: PlanningRecoveryProviderInput | undefined;
    if (run?.state === "COMMITTED" || run?.state === "COMMITTED_RECONCILED") return this.replayRun(run);
    if (run && isPlanningRecoveryRunTerminal(run.state)) throw new PlanningRecoveryError("TERMINAL_FAILURE_REPLAY", "Planning recovery has a durable terminal outcome.", { state: run.state, providerAttemptCount: run.providerAttemptCount });
    if (!run || run.state === "CREATED") {
      preparation = await this.prepare(input);
      if (!preparation.eligibility.eligible || !preparation.plan || !preparation.providerInput) throw new PlanningRecoveryError(preparation.eligibility.reason, "Planning recovery is not eligible.", preparation.eligibility);
      providerInput = preparation.providerInput;
      const expectedRun = recoveryRunFromPreparation({ plan: preparation.plan, operationKey: input.operationKey, now: this.now() });
      await this.dependencies.fault?.hit("before-run-creation");
      run = await this.dependencies.database.transaction((tx) => tx.createPlanningRecoveryRun(expectedRun));
      await this.dependencies.fault?.hit("after-run-creation");
    }
    if (!run) throw new PlanningRecoveryError("RECOVERY_RUN_NOT_FOUND");
    const plan = parseRecoveryPlan(run);
    if (preparation?.plan && preparation.plan.planChecksum !== plan.planChecksum) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
    const owner = randomUUID();
    const claim = await this.dependencies.database.transaction((tx) => tx.claimPlanningRecoveryRun({ runId: run!.runId, operationKey: input.operationKey, owner, now: this.now(), leaseExpiresAt: this.leaseExpiresAt(this.now()) }));
    if (claim.outcome === "RUN_ALREADY_ACTIVE") throw new PlanningRecoveryError("RUN_ALREADY_ACTIVE", "Planning recovery is already owned by another active execution.", { state: claim.row.state });
    if (claim.outcome === "PROVIDER_ATTEMPT_ALREADY_CONSUMED") throw new PlanningRecoveryError("PROVIDER_ATTEMPT_ALREADY_CONSUMED", "The durable provider budget is already consumed; no provider retry is permitted.", { state: claim.row.state });
    if (claim.outcome === "COMMITTED_REPLAY") return this.replayRun(claim.row);
    if (claim.outcome === "TERMINAL_FAILURE_REPLAY") throw new PlanningRecoveryError("TERMINAL_FAILURE_REPLAY", "Planning recovery has a durable terminal outcome.", { state: claim.row.state, providerAttemptCount: claim.row.providerAttemptCount });
    run = claim.row;
    if (run.state === "PERSISTENCE_STARTED") {
      const reconciled = await this.reconcileCommitted(run, owner);
      if (reconciled) return reconciled;
    }
    let candidate: PlanningPackage;
    if (claim.outcome === "PROVIDER_STARTED") {
      if (!providerInput) throw new PlanningRecoveryError("RECOVERY_PROVIDER_INPUT_MISSING");
      await this.dependencies.fault?.hit("after-provider-call-started");
      let returned: unknown;
      try {
        if (!this.dependencies.provider.planRecovery) throw new PlanningRecoveryError("PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE");
        returned = await this.dependencies.provider.planRecovery(providerInput, input.approvedSkills, input.skillContextIdentity);
      } catch (error) {
        await this.markRunTerminal(run, "PROVIDER_FAILED", owner, error, "provider");
        throw new PlanningRecoveryError("RECOVERY_PROVIDER_FAILED", "Planning recovery provider failed.");
      }
      await this.dependencies.fault?.hit("after-provider-return-before-result");
      try {
        candidate = PlanningPackageSchema.parse(returned);
        if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > PLANNING_RECOVERY_RUN_RESULT_MAX_BYTES) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_TOO_LARGE");
      } catch (error) {
        await this.markRunTerminal(run, "PROVIDER_SEMANTIC_FAILED", owner, error, "provider");
        throw new PlanningRecoveryError("RECOVERY_PROVIDER_SEMANTIC_FAILED", "Planning recovery provider returned an invalid typed candidate.");
      }
      run = await this.persistRun({ run, from: "PROVIDER_CALL_STARTED", to: "PROVIDER_RETURNED", owner, patch: { providerResultChecksum: checksumPersistedDocument(candidate), providerResult: candidate, diagnosticStage: null, diagnosticCode: null, diagnosticMessage: null, providerErrorClass: null, providerErrorCode: null } });
      await this.dependencies.fault?.hit("after-provider-result");
    } else {
      candidate = parseDurableCandidate(run);
    }
    if (run.state === "PROVIDER_RETURNED") {
      run = await this.persistRun({ run, from: "PROVIDER_RETURNED", to: "ADMISSION_STARTED", owner });
      await this.dependencies.fault?.hit("after-admission-started");
    }
    if (run.state === "ADMISSION_STARTED") {
      try {
        const current = await this.readCanonicalState(plan);
        candidate = admitRecoveryCandidate({ candidate, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief: current.brief, planning: current.planning, compatibility: current.compatibility, now: this.now() });
      } catch (error) {
        const target = error instanceof PlanningRecoveryError && error.code === "RECOVERY_CURRENTNESS_STALE" ? "CURRENTNESS_FAILED" : "ADMISSION_FAILED";
        await this.markRunTerminal(run, target, owner, error, target === "CURRENTNESS_FAILED" ? "currentness" : "admission");
        throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Planning recovery candidate failed deterministic admission.");
      }
      run = await this.persistRun({ run, from: "ADMISSION_STARTED", to: "ADMISSION_PASSED", owner, patch: { providerResultChecksum: checksumPersistedDocument(candidate), providerResult: candidate } });
      await this.dependencies.fault?.hit("after-admission-passed");
    } else if (run.state === "ADMISSION_PASSED" || run.state === "PERSISTENCE_STARTED") {
      candidate = parseDurableCandidate(run);
    }
    if (run.state === "ADMISSION_PASSED") {
      run = await this.persistRun({ run, from: "ADMISSION_PASSED", to: "PERSISTENCE_STARTED", owner });
      await this.dependencies.fault?.hit("after-persistence-started");
    }
    if (run.state !== "PERSISTENCE_STARTED") throw new PlanningRecoveryError("RECOVERY_RUN_STATE_INVALID");
    let committed: { run: PlanningRecoveryRunRow; package: PlanningPackage; evidence: PlanningRecoveryEvidence };
    try {
      committed = await this.dependencies.database.transaction(async (tx) => {
        const currentRun = await tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey);
        if (!currentRun || currentRun.state !== "PERSISTENCE_STARTED" || currentRun.leaseOwner !== owner || !isLeaseActive(currentRun, this.now())) throw new PlanningRecoveryError("RECOVERY_RUN_LEASE_STALE");
        const project = await tx.getProject(input.projectId);
        const version = await tx.getVersion(input.projectId, input.projectVersion);
        const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
        const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
        if (!project || !version || !briefRow || !planningRow) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
        const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
        const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
        assertRecoveryCurrentness({ project, version, briefRow, brief, planningRow, planning, plan });
        const legacyRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
        const legacy = legacyRow && mapRowToDocument(legacyRow).documentType === "requirements" ? RequirementSpecificationSchema.parse(mapRowToDocument(legacyRow)) : null;
        const compatibility = compatibilityBrief(project, version, brief, legacy);
        const admitted = admitRecoveryCandidate({ candidate, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief, planning, compatibility, now: this.now() });
        const existingEvidence = await tx.getPlanningRecoveryEvidence(input.projectId, input.projectVersion, input.operationKey);
        if (existingEvidence) {
          if (existingEvidence.nextPlanningDocumentChecksum !== planningDocumentChecksum(admitted)) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
          const existingPackage = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
          return { run: currentRun, package: existingPackage, evidence: PlanningRecoveryEvidenceSchema.parse(existingEvidence) };
        }
        await saveDocumentCASInTransaction(tx, admitted, planningRow.rowVersion, planningRow.checksum);
        await this.dependencies.fault?.hit("after-package-write");
        const evidence = PlanningRecoveryEvidenceSchema.parse({ id: deterministicUuid(`${input.projectId}:${input.projectVersion}:${input.operationKey}`), operationKey: input.operationKey, projectId: input.projectId, projectVersion: input.projectVersion, recoveryPlanChecksum: plan.planChecksum, briefRowVersion: briefRow.rowVersion, briefSemanticChecksum: brief.briefChecksum, briefDocumentChecksum: briefRow.checksum, priorPlanningRowVersion: planningRow.rowVersion, priorPlanningSemanticChecksum: planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), priorPlanningDocumentChecksum: planningDocumentChecksum(planning), priorPlanningPackage: planning, nextPlanningRowVersion: planningRow.rowVersion + 1, nextPlanningSemanticChecksum: planningSemanticChecksumForPolicy(admitted, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), nextPlanningDocumentChecksum: planningDocumentChecksum(admitted), createdAt: this.now() });
        await tx.appendPlanningRecoveryEvidence(evidence);
        await this.dependencies.fault?.hit("after-evidence-write");
        await this.dependencies.fault?.hit("before-db-commit");
        const finalRun = await tx.transitionPlanningRecoveryRun({ runId: currentRun.runId, operationKey: currentRun.operationKey, from: "PERSISTENCE_STARTED", to: "COMMITTED", owner, now: this.now(), patch: { committedEvidenceId: evidence.id, providerResultChecksum: checksumPersistedDocument(admitted), providerResult: admitted, projectMemoryStatus: "PENDING" } });
        return { run: finalRun, package: admitted, evidence };
      });
    } catch (error) {
      if (error instanceof PlanningRecoveryCrash) throw error;
      const code = typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
      if (code === "PERSISTENCE_COMMIT_AMBIGUOUS") throw new PlanningRecoveryError("RECOVERY_COMMIT_OUTCOME_INDETERMINATE", "The database commit acknowledgement was ambiguous; reconcile the durable run before any retry.");
      const current = await this.dependencies.database.transaction((tx) => tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey));
      if (current && current.state === "PERSISTENCE_STARTED") await this.markRunTerminal(current, error instanceof PlanningRecoveryError && error.code === "RECOVERY_CURRENTNESS_STALE" ? "CURRENTNESS_FAILED" : "PERSISTENCE_FAILED", owner, error, error instanceof PlanningRecoveryError && error.code === "RECOVERY_CURRENTNESS_STALE" ? "currentness" : "persistence");
      throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_PERSISTENCE_FAILED", "Planning recovery persistence failed.");
    }
    await this.dependencies.fault?.hit("after-canonical-commit-before-run-terminal");
    await this.projection(committed.run, committed.package);
    return { status: "COMMITTED", package: committed.package, evidence: committed.evidence };
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
      try {
        const candidate = admitRecoveryCandidate({ candidate: input.candidate, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief, planning, compatibility: compatibilityBrief(project, version, brief, legacy), now: this.now() });
        const existingEvidence = await tx.getPlanningRecoveryEvidence(input.projectId, input.projectVersion, input.operationKey);
        if (existingEvidence) {
          if (existingEvidence.nextPlanningDocumentChecksum !== planningDocumentChecksum(candidate)) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
          return { status: "REPLAYED" as const, package: candidate, evidence: PlanningRecoveryEvidenceSchema.parse(existingEvidence) };
        }
        const now = this.now();
        await saveDocumentCASInTransaction(tx, candidate, planningRow.rowVersion, planningRow.checksum);
        await this.dependencies.fault?.hit("after-package-write");
        const evidence = PlanningRecoveryEvidenceSchema.parse({ id: deterministicUuid(`${input.projectId}:${input.projectVersion}:${input.operationKey}`), operationKey: input.operationKey, projectId: input.projectId, projectVersion: input.projectVersion, recoveryPlanChecksum: plan.planChecksum, briefRowVersion: briefRow.rowVersion, briefSemanticChecksum: brief.briefChecksum, briefDocumentChecksum: briefRow.checksum, priorPlanningRowVersion: planningRow.rowVersion, priorPlanningSemanticChecksum: planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), priorPlanningDocumentChecksum: planningDocumentChecksum(planning), priorPlanningPackage: planning, nextPlanningRowVersion: planningRow.rowVersion + 1, nextPlanningSemanticChecksum: planningSemanticChecksumForPolicy(candidate, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), nextPlanningDocumentChecksum: planningDocumentChecksum(candidate), createdAt: now });
        const storedEvidence = await tx.appendPlanningRecoveryEvidence(evidence);
        await this.dependencies.fault?.hit("after-evidence-write");
        await this.dependencies.fault?.hit("before-db-commit");
        return { status: "COMMITTED" as const, package: candidate, evidence: PlanningRecoveryEvidenceSchema.parse(storedEvidence) };
      } catch (error) {
        throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", [error instanceof Error ? error.message : "PLANNING_ADMISSION_FAILED"]);
      }
    });
    if (state.status === "COMMITTED") await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, recoveryProjectionDocuments(state.package));
    return state;
  }
}
