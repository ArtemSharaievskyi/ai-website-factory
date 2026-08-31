import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseSourceHead, type SourceCurrentnessPort, type SourceHead } from "@/domain/shared/source-head";
import { createGitSourceCurrentnessPort } from "@/runtime/source-head";
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
  PlanningAdmissionError,
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
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";
import {
  saveDocumentCASInTransaction,
} from "@/persistence/database/repositories";
import type {
  PersistenceDatabase,
  PersistenceTransaction,
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
  type PlanningOwnedRequirementManifest,
  PLANNING_RECOVERY_OUTPUT_POLICY,
  PlanningRecoveryOutputPolicySchema,
  createCanonicalPlanningRouteManifest,
  createPlanningOwnedRequirementManifest,
  createPlanningTargetCatalog,
  requirementManifestAsCanonicalRequirements,
  PlanningRecoverySemanticAccountingSchema,
  PlanningRecoveryLegacySemanticAccountingSchema,
  bindPlanningRecoverySemanticAccounting,
  validatePlanningRecoveryRequirementAccounting,
  type PlanningRecoveryRequirementAccountingIssue,
  type CanonicalPlanningRouteManifest,
  PlanningTargetCatalogSchema,
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
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/i),
  currentness: RecoveryCurrentnessSchema,
  briefChecksum: Sha256Schema,
  routePolicy: RoutePolicySchema,
  decisions: CanonicalBriefV3Schema.shape.decisions,
  planningOwnedRequirementIds: z.array(z.string().min(1)).max(512),
  canonicalRouteManifest: CanonicalPlanningRouteManifestSchema.optional(),
  planningRequirementManifest: PlanningOwnedRequirementManifestSchema.optional(),
  planningTargetCatalog: PlanningTargetCatalogSchema.optional(),
  reconciliationScopeChecksum: Sha256Schema,
  providerCapability: z.object({
    contractVersion: z.union([z.literal(1), z.literal(2)]),
    outputMode: z.literal("FULL_PLANNING_PACKAGE"),
    canonicalBriefIsSoleSemanticAuthority: z.literal(true),
    hostOwnedFields: z.array(z.enum(["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds", "sourceHead"])),
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
  planningTargetCatalog: PlanningTargetCatalogSchema,
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
  if (value.plan.planningTargetCatalog?.catalogChecksum !== value.planningTargetCatalog.catalogChecksum) context.addIssue({ code: "custom", path: ["planningTargetCatalog"], message: "Provider target catalog does not match the recovery plan." });
  if (value.canonicalRouteManifest.routePolicy !== value.plan.routePolicy) context.addIssue({ code: "custom", path: ["canonicalRouteManifest", "routePolicy"], message: "Provider route manifest policy does not match the recovery plan." });
  const manifestIds = value.planningRequirementManifest.requirements.map((entry) => entry.requirementId);
  const planIds = [...value.plan.planningOwnedRequirementIds].sort();
  if (JSON.stringify([...manifestIds].sort()) !== JSON.stringify(planIds)) context.addIssue({ code: "custom", path: ["planningRequirementManifest", "requirements"], message: "Provider requirement manifest identities do not match the recovery plan." });
  const inputIds = value.planningOwnedRequirements.map((entry) => entry.id);
  if (JSON.stringify([...inputIds].sort()) !== JSON.stringify([...manifestIds].sort())) context.addIssue({ code: "custom", path: ["planningOwnedRequirements"], message: "Provider requirement input does not match the host-owned manifest." });
});
export type PlanningRecoveryProviderInput = z.infer<typeof PlanningRecoveryProviderInputSchema>;

/** Durable provider result: the package and its explicit per-requirement semantic accounting travel together. */
export const PlanningRecoveryProviderResultSchema = z.object({
  planningPackage: PlanningPackageSchema,
  requirementAccounting: z.union([PlanningRecoverySemanticAccountingSchema, PlanningRecoveryLegacySemanticAccountingSchema]),
}).strict();
export type PlanningRecoveryProviderResult = z.infer<typeof PlanningRecoveryProviderResultSchema>;

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
    "SOURCE_CURRENTNESS_INVALID",
    "CANONICAL_UNRESOLVED",
    "PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE",
    "CONTEXT_BOUND_EXCEEDED",
    "PROVIDER_SCHEMA_INVALID",
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
  preflightPlanRecovery?(input: Pick<PlanningRecoveryProviderInput, "planningRequirementManifest">): void;
  planRecovery(input: PlanningRecoveryProviderInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string, hostTimestamp?: string): Promise<PlanningRecoveryProviderResult>;
};

export type PlanningRecoveryResult = {
  status: "COMMITTED" | "REPLAYED";
  package: PlanningPackage;
  evidence: PlanningRecoveryEvidence;
};

export type PlanningRecoveryFaultPoint = "before-run-creation" | "after-run-creation" | "after-claim" | "after-source-before-attempt" | "after-provider-call-started" | "before-provider-call" | "after-provider-return-before-result" | "after-provider-result" | "after-admission-started" | "after-admission-passed" | "after-persistence-started" | "after-package-write" | "after-evidence-write" | "before-db-commit" | "after-canonical-commit-before-run-terminal";
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

function admissionIssueDetails(issues: readonly PlanningRecoveryRequirementAccountingIssue[]) {
  return issues.map((issue) => issue.requirementId ? `${issue.code}:${issue.requirementId}` : issue.code);
}

export type RecoveryAdmissionDiagnosticInput = {
  blockers: readonly string[];
  candidate: PlanningPackage | null;
  routeManifest?: CanonicalPlanningRouteManifest;
  requirementManifest?: Pick<PlanningOwnedRequirementManifest, "requirements">;
  accountingValidation?: ReturnType<typeof validatePlanningRecoveryRequirementAccounting>;
  coverage?: readonly { requirementId: string; reason: string }[];
};

const compareDeterministic = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const SAFE_DIAGNOSTIC_FINDING = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,319}$/;
const UNSAFE_DIAGNOSTIC_FINDING = "UNSAFE_DIAGNOSTIC_FINDING";

export function createRecoveryAdmissionDiagnosticSummary(input: RecoveryAdmissionDiagnosticInput) {
  const sanitizedFindingCount = input.blockers.filter((finding) => typeof finding !== "string" || !SAFE_DIAGNOSTIC_FINDING.test(finding)).length;
  const findings = [...input.blockers].map((finding) => typeof finding === "string" && SAFE_DIAGNOSTIC_FINDING.test(finding) ? finding : UNSAFE_DIAGNOSTIC_FINDING);
  const sortedFindings = [...findings].sort(compareDeterministic);
  const findingCounts = new Map<string, number>();
  for (const finding of findings) {
    const code = finding.split(":", 1)[0]!;
    findingCounts.set(code, (findingCounts.get(code) ?? 0) + 1);
  }
  const candidateRoutes = input.candidate?.sitemap.routes.map((route) => route.path) ?? [];
  const expectedRoutes = input.routeManifest?.routes.filter((route) => route.required).map((route) => route.path) ?? [];
  const actualRouteSet = new Set(candidateRoutes);
  const expectedRouteSet = new Set(expectedRoutes);
  const missingCanonicalRoutes = [...expectedRouteSet].filter((path) => !actualRouteSet.has(path)).sort();
  const extraRoutes = [...new Set(candidateRoutes)].filter((path) => !expectedRouteSet.has(path)).sort();
  const coverageMissing = new Set((input.coverage ?? []).map((item) => item.requirementId));
  const missingRequirementIds = [...new Set([...(input.accountingValidation?.missingRequirementIds ?? []), ...coverageMissing])].sort();
  const semanticEvidenceFailureIds = [...new Set([
    ...(input.accountingValidation?.issues.filter((issue) => issue.code === "MISSING_SEMANTIC_EVIDENCE").map((issue) => issue.requirementId).filter((id): id is string => Boolean(id)) ?? []),
    ...(input.coverage ?? []).filter((item) => item.reason === "MISSING_SEMANTIC_EVIDENCE").map((item) => item.requirementId),
  ])].sort();
  const routeFindings = findings.filter((finding) => /ROUTE|PAGE|NAVIGATION|FORM_ROUTE|ARCHITECTURE_ROUTE/.test(finding));
  const navigationBindingFailures = routeFindings.filter((finding) => /NAVIGATION/.test(finding));
  const architectureRouteFailures = routeFindings.filter((finding) => /ARCHITECTURE_ROUTE/.test(finding));
  const formRouteFailures = routeFindings.filter((finding) => /FORM_ROUTE/.test(finding));
  const categoryCounts = { route: 0, coverage: 0, decision: 0, identity: 0, unsupportedFact: 0, schema: 0, other: 0 };
  for (const finding of findings) {
    if (/ROUTE|PAGE_MANIFEST|NAVIGATION/.test(finding)) categoryCounts.route++;
    else if (/COVERAGE|REQUIREMENT_ID_ACCOUNTING|SEMANTIC_EVIDENCE/.test(finding)) categoryCounts.coverage++;
    else if (/DECISION|FORM_|BACKEND/.test(finding)) categoryCounts.decision++;
    else if (/REFERENCE|IDENTITY|HOST_OWNED|LEGACY|ORPHAN|INVENTED|DUPLICATE/.test(finding)) categoryCounts.identity++;
    else if (/UNSUPPORTED/.test(finding)) categoryCounts.unsupportedFact++;
    else if (/SCHEMA|CANDIDATE_INVALID|PROVIDER_|ACCOUNTING/.test(finding)) categoryCounts.schema++;
    else categoryCounts.other++;
  }
  const totalFindingCount = sortedFindings.length;
  const returnedBlockers = Math.min(totalFindingCount, 64);
  return PlanningRecoveryDiagnosticSummarySchema.parse({
    totalFindingCount,
    findingCountsByCode: Object.fromEntries([...findingCounts.entries()].sort(([left], [right]) => compareDeterministic(left, right))),
    expectedRouteCount: expectedRoutes.length,
    actualRouteCount: candidateRoutes.length,
    missingCanonicalRoutes: missingCanonicalRoutes.slice(0, 64),
    extraRoutes: extraRoutes.slice(0, 64),
    invalidRouteBindings: routeFindings.slice(0, 64),
    expectedRequirementCount: input.requirementManifest?.requirements.length ?? input.accountingValidation?.expectedRequirementCount ?? 0,
    accountedRequirementCount: input.accountingValidation?.accountedRequirementCount ?? 0,
    missingRequirementCount: missingRequirementIds.length,
    missingRequirementIds: missingRequirementIds.slice(0, 64),
    semanticEvidenceFailureCount: semanticEvidenceFailureIds.length,
    semanticEvidenceFailureIds: semanticEvidenceFailureIds.slice(0, 64),
    legacyIdCount: input.accountingValidation?.legacyIdCount ?? 0,
    orphanIdCount: input.accountingValidation?.orphanIdCount ?? 0,
    duplicateIdCount: input.accountingValidation?.duplicateIdCount ?? 0,
    sanitizedFindingCount,
    detailsTruncated: totalFindingCount > 64,
    completeDiagnosticsChecksum: checksumPersistedDocument({ findings: sortedFindings }),
    navigationBindingFailures: navigationBindingFailures.slice(0, 64),
    architectureRouteFailures: architectureRouteFailures.slice(0, 64),
    formRouteFailures: formRouteFailures.slice(0, 64),
    totalBlockers: totalFindingCount,
    returnedBlockers,
    truncated: totalFindingCount > 64,
    blockerCategoryCounts: categoryCounts,
    blockers: sortedFindings.slice(0, 64),
  });
}

function admitRecoveryCandidate(input: { candidate: PlanningPackage; semanticAccounting: unknown; projectId: string; projectVersion: number; plan: PlanningRecoveryPlan; brief: BriefV3Document; planning: PlanningPackage; compatibility: RequirementSpecification; now: string }) {
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
    admission = admitPlanningRefresh({ candidate: rawCandidate, canonicalBrief: input.brief.brief, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.brief.briefChecksum, timestamp: input.now, validateRequirementCoverage: false });
  } catch (error) {
    const finding = error instanceof PlanningAdmissionError ? error.code : "PLANNING_ADMISSION_FAILED";
    throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", { diagnosticInput: { blockers: [finding], candidate: rawCandidate, routeManifest: input.plan.canonicalRouteManifest, requirementManifest: input.plan.planningRequirementManifest } });
  }
  const candidate = normalizePlanningPackageForHost({ candidate: admission.candidate, projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.brief.briefChecksum, canonicalBrief: input.brief.brief, timestamp: input.now });
  const accountingBinding = bindPlanningRecoverySemanticAccounting({ semanticAccounting: input.semanticAccounting, manifest: input.plan.planningRequirementManifest!, candidate, routeManifest: input.plan.canonicalRouteManifest, targetCatalog: input.plan.planningTargetCatalog });
  const requirementAccounting = accountingBinding.accounting;
  const accountingValidation = validatePlanningRecoveryRequirementAccounting({ accounting: requirementAccounting, manifest: input.plan.planningRequirementManifest!, candidate, routeManifest: input.plan.canonicalRouteManifest });
  accountingValidation.issues.push(...accountingBinding.validation.issues.filter((issue) => issue.code === "ACCOUNTING_CARDINALITY_MISMATCH" || issue.code === "INVALID_ACCOUNTING_ENTRY"));
  const accountingBlockers = admissionIssueDetails(accountingValidation.issues);
  const blockers = [
    ...admission.blockers,
    ...accountingBlockers,
    ...validatePlanningAdmission(candidate).blockers,
    ...validatePlanningPackageAgainstBrief(input.compatibility, candidate),
    ...canonicalDecisionBlockers(input.brief.brief, input.compatibility, candidate),
    ...unsupportedBusinessFacts(input.brief.brief, candidate),
    ...referenceBlockers(input.brief.brief, candidate),
    ...(input.plan.canonicalRouteManifest ? validatePlanningRecoveryRouteManifest({ candidate, manifest: input.plan.canonicalRouteManifest }) : []),
  ];
  const coverage = input.plan.planningRequirementManifest
    ? validatePlanningRecoveryRequirementCoverage({ candidate, manifest: input.plan.planningRequirementManifest, accounting: requirementAccounting })
    : validatePlanningRequirementCoverage({ candidate, canonicalBrief: input.brief.brief }).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category));
  blockers.push(...coverage.map((entry) => `RECOVERY_COVERAGE_INCOMPLETE:${entry.requirementId}:${entry.reason}`));
  blockers.push(...providerFieldBlockers);
  if (candidate.projectId !== input.plan.projectId || candidate.projectVersion !== input.plan.projectVersion || candidate.approvedBriefChecksum !== input.plan.briefChecksum || candidate.semanticChecksumPolicyVersion !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY || candidate.accepted || candidate.acceptance.acceptedAt) blockers.push("RECOVERY_HOST_OWNED_FIELD_MUTATION");
  if (blockers.length) throw new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Full Planning recovery candidate failed deterministic admission.", { diagnosticInput: { blockers, candidate, routeManifest: input.plan.canonicalRouteManifest, requirementManifest: input.plan.planningRequirementManifest, accountingValidation, coverage } });
  return { candidate, requirementAccounting };
}

function recoveryPlan(input: {
  project: ProjectRow;
  version: ProjectVersionRow;
  brief: BriefV3Document;
  planning: PlanningPackage;
  planningRow: DocumentRow;
  briefRow: DocumentRow;
  scope: PlanningReconciliationScope;
  sourceHead: SourceHead;
}): PlanningRecoveryPlan {
  const currentness = currentnessFor({ project: input.project, version: input.version, briefRow: input.briefRow, brief: input.brief, planningRow: input.planningRow, planning: input.planning });
  const canonicalRouteManifest = createCanonicalPlanningRouteManifest(input.brief.brief);
  const planningRequirementManifest = createPlanningOwnedRequirementManifest(input.brief.brief);
  const planningTargetCatalog = createPlanningTargetCatalog(canonicalRouteManifest);
  const payload = PlanningRecoveryPlanPayloadSchema.parse({
    schemaVersion: 1,
    authority: PLANNING_RECOVERY_AUTHORITY,
    mode: PLANNING_RECOVERY_MODE,
    policyVersion: PLANNING_RECOVERY_POLICY_VERSION,
    projectId: input.project.id,
    projectVersion: input.version.versionNumber,
    versionId: input.version.id,
    recoveryReason: "UNRECOVERABLE_CURRENT_PLANNING_STATE",
    sourceHead: input.sourceHead,
    currentness,
    briefChecksum: input.brief.briefChecksum,
    routePolicy: input.brief.brief.decisions.routePolicy.mode,
    decisions: input.brief.brief.decisions,
    planningOwnedRequirementIds: planningRequirementManifest.requirements.map((entry) => entry.requirementId).sort(),
    canonicalRouteManifest,
    planningRequirementManifest,
    planningTargetCatalog,
    reconciliationScopeChecksum: input.scope.scopeChecksum,
    providerCapability: {
      contractVersion: 2,
      outputMode: "FULL_PLANNING_PACKAGE",
      canonicalBriefIsSoleSemanticAuthority: true,
      hostOwnedFields: ["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds", "sourceHead"],
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
    expectedSourceHead: input.plan.sourceHead,
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
  const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const providerFailure = stage === "provider" ? ProviderFailureDiagnosticSchema.safeParse(errorRecord?.failureDiagnostic).data : undefined;
  const providerErrorCode = providerFailure?.errorCode ?? (typeof errorRecord?.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(errorRecord.code) ? errorRecord.code.slice(0, 160) : undefined);
  const diagnosticInput = stage === "admission" && error instanceof PlanningRecoveryError && error.details && typeof error.details === "object" && "diagnosticInput" in error.details
    ? (error.details as { diagnosticInput?: RecoveryAdmissionDiagnosticInput }).diagnosticInput
    : undefined;
  const summary = diagnosticInput ? createRecoveryAdmissionDiagnosticSummary(diagnosticInput) : null;
  const diagnosticMessage = providerFailure
    ? `Planning recovery provider failed safely: ${providerFailure.category}/${providerFailure.stage}/${providerFailure.errorCode ?? "UNKNOWN"}.`
    : `Planning recovery ${stage} failed safely.`;
  const providerErrorClass = providerFailure?.sdkErrorClass ?? (error instanceof Error && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(error.constructor.name) ? error.constructor.name.slice(0, 160) : code);
  return {
    diagnosticStage: stage,
    diagnosticCode: providerErrorCode ?? code,
    diagnosticMessage,
    diagnosticSummary: providerFailure ?? summary,
    providerRequestId: providerFailure?.requestId ?? null,
    providerModel: providerFailure?.model ?? null,
    providerErrorClass: stage === "provider" ? providerErrorClass : null,
    providerErrorCode: stage === "provider" ? providerErrorCode ?? code : null,
  } as const;
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

function assertSourceCurrentness(expected: string, actual: Awaited<ReturnType<SourceCurrentnessPort["read"]>>) {
  let expectedHead: SourceHead;
  let actualHead: SourceHead;
  try { expectedHead = parseSourceHead(expected); } catch { throw new PlanningRecoveryError("SOURCE_HEAD_INVALID"); }
  try { actualHead = parseSourceHead(actual.head); } catch { throw new PlanningRecoveryError("SOURCE_HEAD_INVALID"); }
  if (!actual.trackedWorktreeClean) throw new PlanningRecoveryError("SOURCE_WORKTREE_DIRTY");
  if (actualHead !== expectedHead) throw new PlanningRecoveryError("SOURCE_HEAD_MISMATCH");
}

function assertRecoveryRunSourceBinding(run: PlanningRecoveryRunRow, plan: PlanningRecoveryPlan) {
  if (!run.expectedSourceHead) throw new PlanningRecoveryError("SOURCE_HEAD_REQUIRED_FOR_NEW_RUN");
  let runHead: SourceHead;
  try { runHead = parseSourceHead(run.expectedSourceHead); } catch { throw new PlanningRecoveryError("SOURCE_HEAD_INVALID"); }
  if (runHead !== plan.sourceHead) throw new PlanningRecoveryError("SOURCE_HEAD_BINDING_MISMATCH");
}

function parseRecoveryPlan(run: PlanningRecoveryRunRow) {
  const plan = PlanningRecoveryPlanSchema.parse(run.recoveryPlan);
  const withoutChecksum = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planChecksum"));
  if (checksumPersistedDocument(withoutChecksum) !== plan.planChecksum || run.recoveryPlanChecksum !== plan.planChecksum) throw new PlanningRecoveryError("RECOVERY_PLAN_CHECKSUM_INVALID");
  return plan;
}

function parseDurableCandidate(run: PlanningRecoveryRunRow) {
  if (!run.providerResult || !run.providerResultChecksum) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_MISSING");
  const parsed = PlanningRecoveryProviderResultSchema.safeParse(run.providerResult);
  if (!parsed.success) {
    if (PlanningPackageSchema.safeParse(run.providerResult).success) throw new PlanningRecoveryError("RECOVERY_LEGACY_PROVIDER_RESULT_UNRESUMABLE", "A pre-hardening recovery result has no semantic accounting envelope.");
    if (run.providerResult && typeof run.providerResult === "object" && !Array.isArray(run.providerResult) && "planningPackage" in run.providerResult && PlanningPackageSchema.safeParse(run.providerResult.planningPackage).success) throw new PlanningRecoveryError("RECOVERY_LEGACY_PROVIDER_RESULT_UNRESUMABLE", "A pre-positional recovery result allowed provider-authored requirement identities.");
    throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_INVALID");
  }
  const result = parsed.data;
  if (checksumPersistedDocument(result) !== run.providerResultChecksum) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_CHECKSUM_INVALID");
  return result;
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
    planningTargetCatalog: input.plan.planningTargetCatalog ?? createPlanningTargetCatalog(input.plan.canonicalRouteManifest),
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
  private readonly source: SourceCurrentnessPort;

  constructor(private readonly dependencies: {
    database: PersistenceDatabase;
    memory: PlannerMemoryPort;
    provider: PlanningRecoveryProvider;
    source?: SourceCurrentnessPort;
    hostRecoveryEnabled?: boolean;
    now?: () => string;
    fault?: PlanningRecoveryFaultInjector;
  }) {
    this.source = dependencies.source ?? createGitSourceCurrentnessPort();
  }

  private now() { return this.dependencies.now?.() ?? new Date().toISOString(); }
  private leaseExpiresAt(now: string) { return new Date(Date.parse(now) + PLANNING_RECOVERY_RUN_LEASE_MS).toISOString(); }

  private preflightRecoveryProvider(plan: PlanningRecoveryPlan) {
    const preflight = this.dependencies.provider.preflightPlanRecovery;
    if (!preflight) return;
    if (!plan.planningRequirementManifest) throw new PlanningRecoveryError("RECOVERY_PLAN_INVALID");
    try {
      preflight({ planningRequirementManifest: plan.planningRequirementManifest });
    } catch (error) {
      if (error instanceof PlanningRecoveryError && error.code === "RECOVERY_PLAN_INVALID") throw error;
      throw new PlanningRecoveryError("PROVIDER_SCHEMA_INVALID");
    }
  }

  private async currentSource(expected: string) {
    let actual: Awaited<ReturnType<SourceCurrentnessPort["read"]>>;
    try { actual = await this.source.read(); }
    catch { throw new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED"); }
    try { assertSourceCurrentness(expected, actual); }
    catch (error) { throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED"); }
    return actual;
  }

  private async certifiedSourceHead() {
    let actual: Awaited<ReturnType<SourceCurrentnessPort["read"]>>;
    try { actual = await this.source.read(); }
    catch { throw new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED"); }
    if (!actual.trackedWorktreeClean) throw new PlanningRecoveryError("SOURCE_WORKTREE_DIRTY");
    try { return parseSourceHead(actual.head); }
    catch { throw new PlanningRecoveryError("SOURCE_HEAD_INVALID"); }
  }

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

  private async assertProviderInvocationReady(run: PlanningRecoveryRunRow, plan: PlanningRecoveryPlan, owner: string) {
    await this.dependencies.database.transaction(async (tx) => {
      const current = await tx.getPlanningRecoveryRun(plan.projectId, plan.projectVersion, run.operationKey);
      if (!current || current.state !== "PROVIDER_CALL_STARTED" || current.leaseOwner !== owner || !isLeaseActive(current, this.now()) || current.providerAttemptCount !== 1) throw new PlanningRecoveryError("RECOVERY_RUN_LEASE_STALE");
      assertRecoveryRunSourceBinding(current, plan);
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
    let sourceHead: SourceHead;
    try {
      sourceHead = await this.certifiedSourceHead();
    } catch (error) {
      return fail("SOURCE_CURRENTNESS_INVALID", [error instanceof PlanningRecoveryError ? error.code : "SOURCE_CURRENTNESS_FAILED"], count, scope);
    }
    let plan: PlanningRecoveryPlan;
    let providerInput: PlanningRecoveryProviderInput;
    try {
      plan = recoveryPlan({ project: state.project, version: state.version, brief, planning, planningRow: state.planningRow, briefRow: state.briefRow, scope, sourceHead });
      providerInput = buildProviderInput({ plan, brief, compatibility, project: state.project, version: state.version, planning, planningRow: state.planningRow, operationKey: input.operationKey });
    } catch (error) {
      if (error instanceof PlanningRecoveryError && error.code === "CONTEXT_BOUND_EXCEEDED") return fail("CONTEXT_BOUND_EXCEEDED", [error.code], count, scope);
      return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_PLAN_INVALID"], count, scope);
    }
    try {
      this.preflightRecoveryProvider(plan);
    } catch (error) {
      if (error instanceof PlanningRecoveryError && error.code === "PROVIDER_SCHEMA_INVALID") return fail("PROVIDER_SCHEMA_INVALID", ["RECOVERY_PROVIDER_SCHEMA_PREFLIGHT_FAILED"], count, scope);
      return fail("CURRENTNESS_TOKEN_INVALID", ["RECOVERY_PLAN_INVALID"], count, scope);
    }
    const eligibility = PlanningRecoveryEligibilitySchema.parse({ eligible: true, blockers: [], reason: "RECOVERY_REQUIRED", planningOwnedRequirementCount: count, currentCoverage: coverageMissing.map((entry) => ({ requirementId: entry.requirementId, category: entry.category, reason: entry.reason })) });
    return { eligibility, scope, plan, providerInput, execution };
  }

  async recover(input: { projectId: string; projectVersion: number; operationKey: string; approvedSkills?: readonly ApprovedProceduralSkillContext[]; skillContextIdentity?: string }): Promise<PlanningRecoveryResult> {
    let run = await this.dependencies.database.transaction((tx) => tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey));
    let preparation: PlanningRecoveryPreparation | undefined;
    let providerInput: PlanningRecoveryProviderInput | undefined;
    if (run?.state === "COMMITTED" || run?.state === "COMMITTED_RECONCILED") {
      const plan = PlanningRecoveryPlanSchema.safeParse(run.recoveryPlan);
      if (run.expectedSourceHead && !plan.success) throw new PlanningRecoveryError("RECOVERY_PLAN_INVALID");
      if (plan.success && run.expectedSourceHead) { assertRecoveryRunSourceBinding(run, plan.data); await this.currentSource(plan.data.sourceHead); }
      return this.replayRun(run);
    }
    if (run && isPlanningRecoveryRunTerminal(run.state)) throw new PlanningRecoveryError("TERMINAL_FAILURE_REPLAY", "Planning recovery has a durable terminal outcome.", { state: run.state, providerAttemptCount: run.providerAttemptCount });
    if (run && !run.expectedSourceHead) {
      const error = new PlanningRecoveryError("SOURCE_HEAD_REQUIRED_FOR_NEW_RUN");
      await this.markRunTerminal(run, "CURRENTNESS_FAILED", undefined, error, "currentness");
      throw error;
    }
    if (!run || run.state === "CREATED") {
      preparation = await this.prepare(input);
      if (!preparation.eligibility.eligible || !preparation.plan || !preparation.providerInput) throw new PlanningRecoveryError(preparation.eligibility.reason, "Planning recovery is not eligible.", preparation.eligibility);
      providerInput = preparation.providerInput;
      try { await this.currentSource(preparation.plan.sourceHead); }
      catch (error) { throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED"); }
      const expectedRun = recoveryRunFromPreparation({ plan: preparation.plan, operationKey: input.operationKey, now: this.now() });
      await this.dependencies.fault?.hit("before-run-creation");
      run = await this.dependencies.database.transaction((tx) => tx.createPlanningRecoveryRun(expectedRun));
      await this.dependencies.fault?.hit("after-run-creation");
    }
    if (!run) throw new PlanningRecoveryError("RECOVERY_RUN_NOT_FOUND");
    const plan = parseRecoveryPlan(run);
    assertRecoveryRunSourceBinding(run, plan);
    if (preparation?.plan && preparation.plan.planChecksum !== plan.planChecksum) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
    this.preflightRecoveryProvider(plan);
    if (!isLeaseActive(run, this.now())) {
      try { await this.currentSource(plan.sourceHead); }
      catch (error) {
        const sourceError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", undefined, sourceError, "currentness");
        throw sourceError;
      }
    }
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
    let providerStarted = false;
    const claimedForProvider = claim.outcome === "CLAIMED" || (claim.outcome === "RESUMED" && run.state === "CLAIMED");
    if (claimedForProvider) {
      await this.dependencies.fault?.hit("after-claim");
      let current: Awaited<ReturnType<PlanningRecoveryService["readCanonicalState"]>>;
      try {
        await this.currentSource(plan.sourceHead);
        current = await this.readCanonicalState(plan);
        providerInput ??= buildProviderInput({ plan, brief: current.brief, compatibility: current.compatibility, project: current.project, version: current.version, planning: current.planning, planningRow: current.planningRow, operationKey: input.operationKey });
      } catch (error) {
        const currentnessError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", owner, currentnessError, "currentness");
        throw currentnessError;
      }
      await this.dependencies.fault?.hit("after-source-before-attempt");
      let started: Awaited<ReturnType<PersistenceTransaction["startPlanningRecoveryProviderAttempt"]>>;
      try {
        started = await this.dependencies.database.transaction((tx) => tx.startPlanningRecoveryProviderAttempt({ runId: run!.runId, operationKey: input.operationKey, owner, now: this.now(), leaseExpiresAt: run!.leaseExpiresAt!, expectedSourceHead: plan.sourceHead, recoveryPlanChecksum: plan.planChecksum, currentness: plan.currentness }));
      } catch (error) {
        const currentnessError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", owner, currentnessError, "currentness");
        throw currentnessError;
      }
      run = started.row;
      providerStarted = true;
      await this.dependencies.fault?.hit("after-provider-call-started");
      try {
        await this.assertProviderInvocationReady(run, plan, owner);
        await this.currentSource(plan.sourceHead);
      } catch (error) {
        const currentnessError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", owner, currentnessError, "currentness");
        throw currentnessError;
      }
      await this.dependencies.fault?.hit("before-provider-call");
    }
    let candidate: PlanningPackage;
    let requirementAccounting: PlanningRecoveryProviderResult["requirementAccounting"];
    if (providerStarted) {
      if (!providerInput) throw new PlanningRecoveryError("RECOVERY_PROVIDER_INPUT_MISSING");
      let returned: unknown;
      try {
        if (!this.dependencies.provider.planRecovery) throw new PlanningRecoveryError("PROVIDER_RECOVERY_CAPABILITY_UNAVAILABLE");
        returned = await this.dependencies.provider.planRecovery(providerInput, input.approvedSkills, input.skillContextIdentity, this.now());
      } catch (error) {
        await this.markRunTerminal(run, "PROVIDER_FAILED", owner, error, "provider");
        throw new PlanningRecoveryError("RECOVERY_PROVIDER_FAILED", "Planning recovery provider failed.");
      }
      await this.dependencies.fault?.hit("after-provider-return-before-result");
      let providerResult: PlanningRecoveryProviderResult;
      try {
        providerResult = PlanningRecoveryProviderResultSchema.parse(returned);
        if (Buffer.byteLength(JSON.stringify(providerResult), "utf8") > PLANNING_RECOVERY_RUN_RESULT_MAX_BYTES) throw new PlanningRecoveryError("RECOVERY_PROVIDER_RESULT_TOO_LARGE");
      } catch (error) {
        await this.markRunTerminal(run, "PROVIDER_SEMANTIC_FAILED", owner, error, "provider");
        throw new PlanningRecoveryError("RECOVERY_PROVIDER_SEMANTIC_FAILED", "Planning recovery provider returned an invalid typed candidate.");
      }
      candidate = providerResult.planningPackage;
      requirementAccounting = providerResult.requirementAccounting;
      run = await this.persistRun({ run, from: "PROVIDER_CALL_STARTED", to: "PROVIDER_RETURNED", owner, patch: { providerResultChecksum: checksumPersistedDocument(providerResult), providerResult, diagnosticStage: null, diagnosticCode: null, diagnosticMessage: null, providerErrorClass: null, providerErrorCode: null } });
      await this.dependencies.fault?.hit("after-provider-result");
    } else {
      try {
        const providerResult = parseDurableCandidate(run);
        candidate = providerResult.planningPackage;
        requirementAccounting = providerResult.requirementAccounting;
      } catch (error) {
        const terminalState = run.state === "PROVIDER_RETURNED" || run.state === "ADMISSION_STARTED" ? "ADMISSION_FAILED" : run.state === "ADMISSION_PASSED" || run.state === "PERSISTENCE_STARTED" ? "PERSISTENCE_FAILED" : undefined;
        if (terminalState) await this.markRunTerminal(run, terminalState, owner, error, terminalState === "ADMISSION_FAILED" ? "admission" : "persistence");
        throw error;
      }
    }
    if (run.state === "PROVIDER_RETURNED") {
      try { await this.currentSource(plan.sourceHead); }
      catch (error) {
        const sourceError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", owner, sourceError, "currentness");
        throw sourceError;
      }
      run = await this.persistRun({ run, from: "PROVIDER_RETURNED", to: "ADMISSION_STARTED", owner });
      await this.dependencies.fault?.hit("after-admission-started");
    }
    if (run.state === "ADMISSION_STARTED") {
      try {
        await this.currentSource(plan.sourceHead);
        const current = await this.readCanonicalState(plan);
        candidate = admitRecoveryCandidate({ candidate, semanticAccounting: requirementAccounting, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief: current.brief, planning: current.planning, compatibility: current.compatibility, now: this.now() }).candidate;
      } catch (error) {
        const target = error instanceof PlanningRecoveryError && error.code === "RECOVERY_CURRENTNESS_STALE" ? "CURRENTNESS_FAILED" : "ADMISSION_FAILED";
        await this.markRunTerminal(run, target, owner, error, target === "CURRENTNESS_FAILED" ? "currentness" : "admission");
        throw error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("RECOVERY_CANDIDATE_INVALID", "Planning recovery candidate failed deterministic admission.");
      }
      run = await this.persistRun({ run, from: "ADMISSION_STARTED", to: "ADMISSION_PASSED", owner });
      await this.dependencies.fault?.hit("after-admission-passed");
    } else if (run.state === "ADMISSION_PASSED" || run.state === "PERSISTENCE_STARTED") {
      try {
        const providerResult = parseDurableCandidate(run);
        candidate = providerResult.planningPackage;
        requirementAccounting = providerResult.requirementAccounting;
      } catch (error) {
        await this.markRunTerminal(run, "PERSISTENCE_FAILED", owner, error, "persistence");
        throw error;
      }
    }
    if (run.state === "ADMISSION_PASSED") {
      try { await this.currentSource(plan.sourceHead); }
      catch (error) {
        const sourceError = error instanceof PlanningRecoveryError ? error : new PlanningRecoveryError("SOURCE_CURRENTNESS_FAILED");
        await this.markRunTerminal(run, "CURRENTNESS_FAILED", owner, sourceError, "currentness");
        throw sourceError;
      }
      run = await this.persistRun({ run, from: "ADMISSION_PASSED", to: "PERSISTENCE_STARTED", owner });
      await this.dependencies.fault?.hit("after-persistence-started");
    }
    if (run.state !== "PERSISTENCE_STARTED") throw new PlanningRecoveryError("RECOVERY_RUN_STATE_INVALID");
    let committed: { run: PlanningRecoveryRunRow; package: PlanningPackage; evidence: PlanningRecoveryEvidence };
    try {
      committed = await this.dependencies.database.transaction(async (tx) => {
        const currentRun = await tx.getPlanningRecoveryRun(input.projectId, input.projectVersion, input.operationKey);
        if (!currentRun || currentRun.state !== "PERSISTENCE_STARTED" || currentRun.leaseOwner !== owner || !isLeaseActive(currentRun, this.now())) throw new PlanningRecoveryError("RECOVERY_RUN_LEASE_STALE");
        assertRecoveryRunSourceBinding(currentRun, plan);
        await this.currentSource(plan.sourceHead);
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
        candidate = admitRecoveryCandidate({ candidate, semanticAccounting: requirementAccounting, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief, planning, compatibility, now: this.now() }).candidate;
        const existingEvidence = await tx.getPlanningRecoveryEvidence(input.projectId, input.projectVersion, input.operationKey);
        if (existingEvidence) {
          if (existingEvidence.nextPlanningDocumentChecksum !== planningDocumentChecksum(candidate)) throw new PlanningRecoveryError("IDEMPOTENCY_CONFLICT");
          const existingPackage = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
          return { run: currentRun, package: existingPackage, evidence: PlanningRecoveryEvidenceSchema.parse(existingEvidence) };
        }
        await saveDocumentCASInTransaction(tx, candidate, planningRow.rowVersion, planningRow.checksum);
        await this.dependencies.fault?.hit("after-package-write");
        const evidence = PlanningRecoveryEvidenceSchema.parse({ id: deterministicUuid(`${input.projectId}:${input.projectVersion}:${input.operationKey}`), operationKey: input.operationKey, projectId: input.projectId, projectVersion: input.projectVersion, recoveryPlanChecksum: plan.planChecksum, briefRowVersion: briefRow.rowVersion, briefSemanticChecksum: brief.briefChecksum, briefDocumentChecksum: briefRow.checksum, priorPlanningRowVersion: planningRow.rowVersion, priorPlanningSemanticChecksum: planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), priorPlanningDocumentChecksum: planningDocumentChecksum(planning), priorPlanningPackage: planning, nextPlanningRowVersion: planningRow.rowVersion + 1, nextPlanningSemanticChecksum: planningSemanticChecksumForPolicy(candidate, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), nextPlanningDocumentChecksum: planningDocumentChecksum(candidate), createdAt: this.now() });
        await tx.appendPlanningRecoveryEvidence(evidence);
        await this.dependencies.fault?.hit("after-evidence-write");
        await this.dependencies.fault?.hit("before-db-commit");
        const finalRun = await tx.transitionPlanningRecoveryRun({ runId: currentRun.runId, operationKey: currentRun.operationKey, from: "PERSISTENCE_STARTED", to: "COMMITTED", owner, now: this.now(), patch: { committedEvidenceId: evidence.id, projectMemoryStatus: "PENDING" } });
        return { run: finalRun, package: candidate, evidence };
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

  async apply(input: { projectId: string; projectVersion: number; operationKey: string; plan: PlanningRecoveryPlan; providerInput?: PlanningRecoveryProviderInput; candidate: PlanningPackage; requirementAccounting: PlanningRecoveryProviderResult["requirementAccounting"] }): Promise<PlanningRecoveryResult> {
    if (!this.dependencies.hostRecoveryEnabled) throw new PlanningRecoveryError("HOST_RECOVERY_NOT_AUTHORIZED");
    const plan = PlanningRecoveryPlanSchema.parse(input.plan);
    if (checksumPersistedDocument(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planChecksum"))) !== plan.planChecksum) throw new PlanningRecoveryError("RECOVERY_PLAN_CHECKSUM_INVALID");
    await this.currentSource(plan.sourceHead);
    const state = await this.dependencies.database.transaction(async (tx) => {
      const project = await tx.getProject(input.projectId);
      const version = await tx.getVersion(input.projectId, input.projectVersion);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      if (!project || !version || !briefRow || !planningRow) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      await this.currentSource(plan.sourceHead);
      if (project.row_version !== plan.currentness.projectRowVersion || project.current_version !== plan.projectVersion || project.workflow_state !== plan.currentness.workflowState || version.rowVersion !== plan.currentness.projectVersionRowVersion || briefRow.rowVersion !== plan.currentness.briefRowVersion || briefRow.checksum !== plan.currentness.briefDocumentChecksum || planningRow.rowVersion !== plan.currentness.planningRowVersion || planningRow.checksum !== plan.currentness.planningDocumentChecksum) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
      const legacyRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
      const legacy = legacyRow && mapRowToDocument(legacyRow).documentType === "requirements" ? RequirementSpecificationSchema.parse(mapRowToDocument(legacyRow)) : null;
      if (brief.briefChecksum !== plan.briefChecksum || planning.approvedBriefChecksum !== plan.currentness.planningApprovedBriefChecksum || planning.accepted) throw new PlanningRecoveryError("RECOVERY_CURRENTNESS_STALE");
      try {
        const candidate = admitRecoveryCandidate({ candidate: input.candidate, semanticAccounting: input.requirementAccounting, projectId: input.projectId, projectVersion: input.projectVersion, plan, brief, planning, compatibility: compatibilityBrief(project, version, brief, legacy), now: this.now() }).candidate;
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
