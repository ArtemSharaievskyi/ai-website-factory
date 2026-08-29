import { z } from "zod";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import {
  canonicalRequirementEntries,
  isLegacyRequirementId,
  isV3RequirementId,
} from "@/domain/requirements/v3/identity";
import {
  CanonicalBriefV3Schema,
  CanonicalRequirementSchema,
  RequirementCategorySchema,
  type CanonicalBriefV3,
  type RequirementCategory,
} from "@/domain/requirements/v3/schema";
import { WorkflowStateSchema } from "@/domain/project/schema";
import { UuidSchema, NonEmptyStringSchema, ProjectVersionSchema } from "@/domain/shared/schemas";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  analyzePlanningRequirementCoverage,
  PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES,
  type PlanningCoverageEvidence,
  type PlanningRefreshDomain,
} from "./refresh-admission";
import {
  PlanningChangeOperationSchema,
  type PlanningChangeOperation,
} from "./changeset";
import {
  PlanningPackageSchema,
  type PlanningPackage,
} from "./contracts";
import {
  planningDocumentChecksum,
  planningSemanticChecksumForPolicy,
  planningSemanticProjectionForPolicy,
} from "./deterministic";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY } from "./semantic-checksum";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const PLANNING_RECONCILIATION_PROVENANCE_MODE = "CURRENT_STATE_RECONCILIATION" as const;

export const PlanningReconciliationProvenanceModeSchema = z.literal(PLANNING_RECONCILIATION_PROVENANCE_MODE);
export type PlanningReconciliationProvenanceMode = z.infer<typeof PlanningReconciliationProvenanceModeSchema>;

export const PlanningReconciliationFindingReasonSchema = z.enum([
  "MISSING_REFERENCE",
  "REFERENCE_WITHOUT_SEMANTIC_EVIDENCE",
  "SEMANTIC_EVIDENCE_WITHOUT_REFERENCE",
  "PARTIAL_SEMANTIC_COVERAGE",
  "VALIDATOR_FALSE_POSITIVE",
  "HISTORICAL_NOT_CURRENT",
  "AMBIGUOUS",
]);
export type PlanningReconciliationFindingReason = z.infer<typeof PlanningReconciliationFindingReasonSchema>;

export const PlanningReconciliationFindingClassificationSchema = z.enum([
  "DETERMINISTIC_REPAIRABLE",
  "SEMANTIC_SYNTHESIS_REQUIRED",
  "NOT_REPAIRABLE_WITHOUT_USER_DECISION",
  "VALIDATOR_DEFECT",
  "NON_PLANNING_OWNED",
]);
export type PlanningReconciliationFindingClassification = z.infer<typeof PlanningReconciliationFindingClassificationSchema>;

export const PlanningRequirementOwnershipSchema = z.enum(["PLANNING_OWNED", "NON_PLANNING_OWNED"]);
export type PlanningRequirementOwnership = z.infer<typeof PlanningRequirementOwnershipSchema>;

/** The explicit, shared ownership policy for current-state Planning coverage. */
export function planningRequirementOwnership(category: RequirementCategory): PlanningRequirementOwnership {
  return PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(category) ? "NON_PLANNING_OWNED" : "PLANNING_OWNED";
}

export const PlanningReconciliationOperationKindSchema = z.enum([
  "set-product-scope-field",
  "set-architecture-field",
  "upsert-route",
  "upsert-page",
  "upsert-form",
]);
export type PlanningReconciliationOperationKind = z.infer<typeof PlanningReconciliationOperationKindSchema>;

export const PlanningReconciliationForbiddenOperationSchema = z.enum([
  "remove-route",
  "remove-page",
  "remove-form",
  "replace-planning-package",
  "set-lifecycle-state",
  "set-currentness",
  "set-identity",
  "set-checksum-policy",
]);
export type PlanningReconciliationForbiddenOperation = z.infer<typeof PlanningReconciliationForbiddenOperationSchema>;

export const PlanningReconciliationPathFamilySchema = z.string().regex(/^planning\.[A-Za-z][A-Za-z0-9.[\]_]*$/);
export type PlanningReconciliationPathFamily = z.infer<typeof PlanningReconciliationPathFamilySchema>;

const CoreContractSchema = z.object({
  protectedBrief: z.boolean(),
  authNone: z.boolean(),
  databaseNone: z.boolean(),
  analyticsNone: z.boolean(),
  singlePage: z.boolean(),
  simulatedForm: z.boolean(),
  noTransmission: z.boolean(),
  noPersistence: z.boolean(),
  noServerProcessing: z.boolean(),
  noExternalProvider: z.boolean(),
  requiredPrivacyConsent: z.boolean(),
  noBackend: z.boolean(),
  clientOnlyForms: z.boolean(),
}).strict();
export type PlanningReconciliationCoreContract = z.infer<typeof CoreContractSchema>;

const CurrentnessTokenSchema = z.object({
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  workflowState: WorkflowStateSchema,
  brief: z.object({
    rowVersion: z.number().int().positive(),
    semanticChecksum: Sha256Schema,
    documentChecksum: Sha256Schema,
    approved: z.boolean(),
    approvedSemanticChecksum: Sha256Schema.nullable(),
  }).strict(),
  planning: z.object({
    rowVersion: z.number().int().positive(),
    semanticChecksum: Sha256Schema,
    documentChecksum: Sha256Schema,
    semanticChecksumPolicy: z.literal(CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
    approvedBriefChecksum: Sha256Schema,
    accepted: z.boolean(),
  }).strict(),
  historicalDeltaAvailable: z.boolean(),
}).strict();
export type PlanningReconciliationCurrentness = z.infer<typeof CurrentnessTokenSchema>;

const CurrentnessStatesSchema = z.object({
  boundToBrief: z.boolean(),
  checksumValid: z.boolean(),
  provenanceCertified: z.boolean(),
  coverageCertified: z.boolean(),
  accepted: z.boolean(),
}).strict();
export type PlanningReconciliationCurrentnessStates = z.infer<typeof CurrentnessStatesSchema>;

const FindingSchema = z.object({
  requirementId: NonEmptyStringSchema,
  category: RequirementCategorySchema,
  statement: NonEmptyStringSchema,
  ownership: PlanningRequirementOwnershipSchema,
  reason: PlanningReconciliationFindingReasonSchema,
  classification: PlanningReconciliationFindingClassificationSchema,
  semanticEvidenceScore: z.number().min(0).max(1),
  permittedDomains: z.array(z.string().min(1)).max(32),
  permittedPathFamilies: z.array(PlanningReconciliationPathFamilySchema).max(64),
  permittedOperationKinds: z.array(PlanningReconciliationOperationKindSchema).max(16),
}).strict();
export type PlanningReconciliationFinding = z.infer<typeof FindingSchema>;

const ScopePayloadSchema = z.object({
  scopeVersion: z.literal(1),
  provenanceMode: PlanningReconciliationProvenanceModeSchema,
  currentness: CurrentnessTokenSchema,
  currentnessStates: CurrentnessStatesSchema,
  coreContract: CoreContractSchema,
  coverageEvidence: z.array(z.object({
    requirementId: NonEmptyStringSchema,
    category: RequirementCategorySchema,
    statement: NonEmptyStringSchema,
    referencePresent: z.boolean(),
    semanticEvidence: z.enum(["FULL", "PARTIAL", "NONE"]),
    semanticEvidenceScore: z.number().min(0).max(1),
    ambiguity: z.enum(["NONE", "AMBIGUOUS"]),
    validatorFinding: z.enum(["MISSING_REFERENCE", "MISSING_SEMANTIC_EVIDENCE"]).optional(),
  }).strict()),
  unresolvedRequirementIds: z.array(NonEmptyStringSchema),
  findings: z.array(FindingSchema),
  authorizedRequirementIds: z.array(NonEmptyStringSchema),
  authorizedDomains: z.array(z.string().min(1)),
  authorizedPathFamilies: z.array(PlanningReconciliationPathFamilySchema),
  permittedOperationKinds: z.array(PlanningReconciliationOperationKindSchema),
  forbiddenOperationKinds: z.array(PlanningReconciliationForbiddenOperationSchema),
  deletionAllowed: z.literal(false),
  blockers: z.array(z.string().min(1)),
  admissibleForProviderCall: z.boolean(),
}).strict();

export const PlanningReconciliationScopeSchema = ScopePayloadSchema.extend({ scopeChecksum: Sha256Schema }).strict();
export type PlanningReconciliationScope = z.infer<typeof PlanningReconciliationScopeSchema>;

export const PlanningReconciliationProviderProposalSchema = z.object({
  contractVersion: z.literal(1),
  changes: z.array(PlanningChangeOperationSchema).max(16),
}).strict();
export type PlanningReconciliationProviderProposal = z.infer<typeof PlanningReconciliationProviderProposalSchema>;

export const PlanningReconciliationProviderEnvelopeSchema = z.object({
  contractVersion: z.literal(1),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  scopeChecksum: Sha256Schema,
  approvedBriefChecksum: Sha256Schema,
  requirements: z.array(CanonicalRequirementSchema).max(128),
  planningContext: z.record(z.string(), z.unknown()),
  authorizedRequirementIds: z.array(NonEmptyStringSchema),
  authorizedDomains: z.array(z.string().min(1)),
  authorizedPathFamilies: z.array(PlanningReconciliationPathFamilySchema),
  permittedOperationKinds: z.array(PlanningReconciliationOperationKindSchema),
  forbiddenOperationKinds: z.array(PlanningReconciliationForbiddenOperationSchema),
  immutableConstraints: z.array(NonEmptyStringSchema),
}).strict();
export type PlanningReconciliationProviderEnvelope = z.infer<typeof PlanningReconciliationProviderEnvelopeSchema>;

export type PlanningReconciliationAdmission = {
  candidate: PlanningPackage;
  proposal: PlanningReconciliationProviderProposal;
  changedPaths: string[];
  blockers: string[];
  postApplyCoverage: PlanningCoverageEvidence[];
};

export class PlanningReconciliationError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "PlanningReconciliationError";
  }
}

const allForbiddenOperations: PlanningReconciliationForbiddenOperation[] = [
  "remove-route",
  "remove-page",
  "remove-form",
  "replace-planning-package",
  "set-lifecycle-state",
  "set-currentness",
  "set-identity",
  "set-checksum-policy",
];

const policy = (
  permittedDomains: readonly PlanningRefreshDomain[],
  permittedPathFamilies: readonly PlanningReconciliationPathFamily[],
  permittedOperationKinds: readonly PlanningReconciliationOperationKind[],
) => ({ permittedDomains, permittedPathFamilies, permittedOperationKinds });

const RECONCILIATION_POLICY: Record<RequirementCategory, ReturnType<typeof policy>> = {
  BUSINESS_GOAL: policy(["product-scope"], ["planning.productScope.primaryOutcomes[]", "planning.productScope.secondaryOutcomes[]", "planning.traceability[]"], ["set-product-scope-field"]),
  AUDIENCE: policy(["product-scope", "pages"], ["planning.productScope.userRoles[]", "planning.pages.pages[].targetAudience", "planning.traceability[]"], ["set-product-scope-field", "upsert-page"]),
  USER_ROLE: policy(["product-scope", "flows", "pages"], ["planning.productScope.userRoles[]", "planning.pages.pages[].targetAudience", "planning.traceability[]"], ["set-product-scope-field", "upsert-page"]),
  FEATURE: policy(["product-scope", "pages"], ["planning.productScope.inScopeCapabilities[]", "planning.productScope.majorWorkflows[]", "planning.pages.pages[].functionalComponents[]", "planning.traceability[]"], ["set-product-scope-field", "upsert-page"]),
  FORM: policy(["product-scope", "forms", "pages"], ["planning.productScope.majorWorkflows[]", "planning.forms.forms[]", "planning.pages.pages[].forms[]", "planning.traceability[]"], ["set-product-scope-field", "upsert-form", "upsert-page"]),
  FORM_INTERACTION: policy(["forms"], ["planning.forms.forms[]", "planning.traceability[]"], ["upsert-form"]),
  CONTENT: policy(["product-scope", "pages"], ["planning.productScope.inScopeCapabilities[]", "planning.pages.pages[].contentBlocks[]", "planning.traceability[]"], ["set-product-scope-field", "upsert-page"]),
  BACKEND: policy(["product-scope", "architecture"], ["planning.productScope.constraints[]", "planning.architecture.componentBoundaries[]", "planning.architecture.testStrategy[]", "planning.traceability[]"], ["set-product-scope-field", "set-architecture-field"]),
  DATABASE: policy(["product-scope", "architecture"], ["planning.productScope.constraints[]", "planning.architecture.componentBoundaries[]", "planning.architecture.testStrategy[]", "planning.traceability[]"], ["set-product-scope-field", "set-architecture-field"]),
  SEO: policy(["routes", "pages"], ["planning.sitemap.routes[].seoRelevant", "planning.pages.pages[].seoMetadata[]", "planning.traceability[]"], ["upsert-route", "upsert-page"]),
  TECHNICAL: policy(["architecture"], ["planning.architecture.componentBoundaries[]", "planning.architecture.testStrategy[]", "planning.architecture.securityControls[]", "planning.traceability[]"], ["set-architecture-field"]),
  EXCLUSION: policy(["product-scope", "architecture", "security"], ["planning.productScope.outOfScopeCapabilities[]", "planning.architecture.rejectedInfrastructure[]", "planning.traceability[]"], ["set-product-scope-field", "set-architecture-field"]),
  ACCEPTANCE: policy(["product-scope", "pages", "forms"], ["planning.productScope.acceptanceMapping[]", "planning.pages.pages[].acceptanceCriteria[]", "planning.forms.forms[].businessValidation[]", "planning.traceability[]"], ["set-product-scope-field", "upsert-page", "upsert-form"]),
  CONTACT_FACT: policy(["forms"], ["planning.forms.forms[]", "planning.traceability[]"], ["upsert-form"]),
  LEGAL_FACT: policy([], [], []),
  BRAND_FACT: policy([], [], []),
  LOGO_METADATA: policy([], [], []),
  IMAGE_NOTE: policy([], [], []),
  RECOMMENDATION: policy([], [], []),
  BRAND_VISUAL: policy([], [], []),
  UX_RESPONSIVE: policy(["pages", "architecture"], ["planning.pages.pages[].functionalComponents[]", "planning.architecture.componentBoundaries[]", "planning.architecture.testStrategy[]", "planning.traceability[]"], ["upsert-page", "set-architecture-field"]),
  LEGAL_CONSTRAINT: policy(["pages", "forms", "content", "security"], ["planning.pages.pages[].contentBlocks[]", "planning.pages.pages[].acceptanceCriteria[]", "planning.forms.forms[].consentRequirements[]", "planning.traceability[]"], ["upsert-page", "upsert-form"]),
  PROHIBITED: policy(["product-scope", "architecture", "security"], ["planning.productScope.outOfScopeCapabilities[]", "planning.architecture.rejectedInfrastructure[]", "planning.traceability[]"], ["set-product-scope-field", "set-architecture-field"]),
  DEFERRED_INTEGRATION: policy(["backend", "architecture", "dependencies"], ["planning.architecture.rejectedInfrastructure[]", "planning.architecture.componentBoundaries[]", "planning.traceability[]"], ["set-architecture-field"]),
  DECISION: policy(["architecture"], ["planning.architecture.componentBoundaries[]", "planning.traceability[]"], ["set-architecture-field"]),
  ADMINISTRATION: policy([], [], []),
  OTHER: policy(["product-scope"], ["planning.productScope.inScopeCapabilities[]", "planning.traceability[]"], ["set-product-scope-field"]),
};

function stableScopeChecksum(value: z.input<typeof ScopePayloadSchema>): string {
  return checksumPersistedDocument(value);
}

function requirementReferenceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(requirementReferenceValues);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => key === "requirementReferences"
    ? Array.isArray(child) ? child.filter((item): item is string => typeof item === "string") : []
    : requirementReferenceValues(child));
}

function planningRequirementIds(planning: PlanningPackage): string[] {
  return [...new Set(requirementReferenceValues(planning).filter((reference) => isV3RequirementId(reference) || isLegacyRequirementId(reference) || reference.startsWith("REQUIREMENT:")))];
}

function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

function comparableSemanticValue(value: PlanningPackage): unknown {
  return JSON.parse(JSON.stringify(planningSemanticProjectionForPolicy(value, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY))) as unknown;
}

function diffSemanticPaths(before: unknown, after: unknown, path = "planning"): string[] {
  if (Object.is(before, after) || checksumPersistedDocument(before) === checksumPersistedDocument(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const paths: string[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) paths.push(...diffSemanticPaths(before[index], after[index], `${path}[${index}]`));
    return paths.length ? paths : [path];
  }
  if (before && typeof before === "object" && after && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const paths: string[] = [];
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const key of keys) paths.push(...diffSemanticPaths((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}.${key}`));
    return paths.length ? paths : [path];
  }
  return [path];
}

function pathAllowed(path: string, families: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return families.some((family) => normalized === family || normalized.startsWith(`${family}.`));
}

function semanticIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "name", "path", "slug", "key", "area"]) {
    if (typeof record[key] === "string") return `${key}:${record[key]}`;
  }
  return undefined;
}

/** Reconciliation may add or update semantics, but it has no deletion authority. */
function assertNoSemanticDeletion(before: unknown, after: unknown, path = "planning"): void {
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || after.length < before.length) throw new PlanningReconciliationError(`RECONCILIATION_SEMANTIC_DELETION_FORBIDDEN:${path}`);
    const beforePrimitives = before.every((entry) => entry === null || typeof entry !== "object");
    if (beforePrimitives) {
      const remaining = new Map<string, number>();
      for (const entry of after) {
        const key = checksumPersistedDocument(entry);
        remaining.set(key, (remaining.get(key) ?? 0) + 1);
      }
      for (const entry of before) {
        const key = checksumPersistedDocument(entry);
        const count = remaining.get(key) ?? 0;
        if (count < 1) throw new PlanningReconciliationError(`RECONCILIATION_SEMANTIC_DELETION_FORBIDDEN:${path}`);
        remaining.set(key, count - 1);
      }
      return;
    }
    const keyedAfter = new Map<string, unknown>();
    for (const entry of after) {
      const key = semanticIdentity(entry);
      if (key) keyedAfter.set(key, entry);
    }
    for (let index = 0; index < before.length; index += 1) {
      const entry = before[index];
      const key = semanticIdentity(entry);
      const matching = key ? keyedAfter.get(key) : after[index];
      if (matching === undefined) throw new PlanningReconciliationError(`RECONCILIATION_SEMANTIC_DELETION_FORBIDDEN:${path}[${index}]`);
      assertNoSemanticDeletion(entry, matching, `${path}[${index}]`);
    }
    return;
  }
  if (before && typeof before === "object") {
    if (!after || typeof after !== "object" || Array.isArray(after)) throw new PlanningReconciliationError(`RECONCILIATION_SEMANTIC_DELETION_FORBIDDEN:${path}`);
    const next = after as Record<string, unknown>;
    for (const [key, value] of Object.entries(before as Record<string, unknown>)) {
      if (!(key in next)) throw new PlanningReconciliationError(`RECONCILIATION_SEMANTIC_DELETION_FORBIDDEN:${path}.${key}`);
      assertNoSemanticDeletion(value, next[key], `${path}.${key}`);
    }
  }
}

function findingAuthorizesPath(scope: PlanningReconciliationScope, path: string, operation: PlanningChangeOperation, references: readonly string[]): boolean {
  return scope.findings.some((finding) => references.includes(finding.requirementId)
    && (finding.classification === "DETERMINISTIC_REPAIRABLE" || finding.classification === "SEMANTIC_SYNTHESIS_REQUIRED")
    && finding.permittedOperationKinds.includes(operation.kind as PlanningReconciliationOperationKind)
    && pathAllowed(path, finding.permittedPathFamilies));
}

function operationReferences(operation: PlanningChangeOperation): readonly string[] {
  if (operation.kind === "set-product-scope-field" || operation.kind === "set-architecture-field") return operation.requirementReferences;
  if (operation.kind === "upsert-route" || operation.kind === "upsert-page" || operation.kind === "upsert-form") return operation.value.requirementReferences;
  return operation.requirementReferences;
}

function operationDomain(operation: PlanningChangeOperation): PlanningRefreshDomain {
  if (operation.kind === "set-product-scope-field") return "product-scope";
  if (operation.kind === "set-architecture-field") return "architecture";
  if (operation.kind === "upsert-route") return "routes";
  if (operation.kind === "upsert-page") return "pages";
  return "forms";
}

function operationPath(operation: PlanningChangeOperation): string {
  if (operation.kind === "set-product-scope-field") return `planning.productScope.${operation.field}`;
  if (operation.kind === "set-architecture-field") return `planning.architecture.${operation.field}`;
  if (operation.kind === "upsert-route") return "planning.sitemap.routes[]";
  if (operation.kind === "upsert-page") return "planning.pages.pages[]";
  return "planning.forms.forms[]";
}

function replaceById<T extends { id: string }>(entries: readonly T[], next: T): T[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => entryIndex === index ? next : entry);
}

function reconciliationDecisionId(operation: PlanningChangeOperation, index: number, scopeChecksum: string): string {
  const digest = checksumPersistedDocument({ scopeChecksum, index, operation });
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
}

function isProtectedCoreBrief(brief: CanonicalBriefV3): boolean {
  return brief.decisions.auth.mode === "NONE"
    && brief.decisions.database.mode === "NONE"
    && brief.decisions.analytics.mode === "NONE"
    && brief.decisions.form.mode === "SIMULATED"
    && brief.decisions.form.transmissionMode === "NONE"
    && brief.decisions.form.persistenceMode === "NONE"
    && brief.decisions.form.serverProcessingMode === "NONE"
    && brief.decisions.form.externalProviderMode === "NONE"
    && brief.decisions.form.privacyConsentMode === "REQUIRED"
    && brief.scope.protectedFunctionality === false;
}

function planningCoreContract(brief: CanonicalBriefV3, planning: PlanningPackage): PlanningReconciliationCoreContract {
  const protectedBrief = isProtectedCoreBrief(brief);
  const authNone = planning.authentication.decision === "none" && !planning.authentication.required;
  const databaseNone = !planning.dataModel.entities.length && !planning.supabase.postgres;
  const analyticsNone = true;
  const singlePage = brief.decisions.routePolicy.mode === "SINGLE_PAGE" && brief.pages.length <= 1 && planning.sitemap.routes.length <= 1;
  const simulatedForm = planning.forms.forms.length > 0 && planning.forms.forms.every((form) => form.submissionMechanism === "client-only");
  const noTransmission = planning.email.decision === "not-required" && !planning.supabase.edgeFunctions && planning.forms.forms.every((form) => form.submissionMechanism === "client-only");
  const noPersistence = planning.dataModel.entities.length === 0 && !planning.supabase.postgres && !planning.supabase.storage && planning.forms.forms.every((form) => form.submissionMechanism === "client-only");
  const noServerProcessing = planning.forms.forms.every((form) => form.submissionMechanism === "client-only");
  const noExternalProvider = planning.email.decision === "not-required" && !planning.supabase.edgeFunctions;
  const requiredPrivacyConsent = brief.decisions.form.privacyConsentMode === "REQUIRED" && planning.forms.forms.every((form) => form.consentRequirements.length > 0);
  const noBackend = planning.architecture.backendPriority.length === 0
    && planning.architecture.serverActions.length === 0
    && planning.architecture.routeHandlers.length === 0
    && planning.architecture.supabaseDatabaseRequirements.length === 0
    && planning.architecture.schemaPlan.length === 0
    && planning.architecture.rlsRequirements.length === 0
    && planning.dataModel.entities.length === 0
    && !planning.supabase.postgres
    && !planning.supabase.auth
    && !planning.supabase.storage
    && !planning.supabase.realtime
    && !planning.supabase.edgeFunctions
    && planning.storage.decision === "not-required"
    && planning.administration.decision === "no-admin";
  return CoreContractSchema.parse({ protectedBrief, authNone, databaseNone, analyticsNone, singlePage, simulatedForm, noTransmission, noPersistence, noServerProcessing, noExternalProvider, requiredPrivacyConsent, noBackend, clientOnlyForms: simulatedForm });
}

function allCoreContractChecksPass(contract: PlanningReconciliationCoreContract): boolean {
  return Object.values(contract).every(Boolean);
}

function classifyFinding(input: {
  evidence: PlanningCoverageEvidence;
  category: RequirementCategory;
}): { reason: PlanningReconciliationFindingReason; classification: PlanningReconciliationFindingClassification } | undefined {
  const { evidence } = input;
  if (evidence.ambiguity === "AMBIGUOUS") return { reason: "AMBIGUOUS", classification: "NOT_REPAIRABLE_WITHOUT_USER_DECISION" };
  if (evidence.validatorFinding && evidence.referencePresent && evidence.semanticEvidence === "FULL") return { reason: "VALIDATOR_FALSE_POSITIVE", classification: "VALIDATOR_DEFECT" };
  if (evidence.referencePresent && evidence.semanticEvidence === "FULL") return undefined;
  if (!evidence.referencePresent && evidence.semanticEvidence === "FULL") return { reason: "SEMANTIC_EVIDENCE_WITHOUT_REFERENCE", classification: "DETERMINISTIC_REPAIRABLE" };
  if (evidence.semanticEvidence === "PARTIAL") return { reason: "PARTIAL_SEMANTIC_COVERAGE", classification: "SEMANTIC_SYNTHESIS_REQUIRED" };
  if (evidence.referencePresent) return { reason: "REFERENCE_WITHOUT_SEMANTIC_EVIDENCE", classification: "SEMANTIC_SYNTHESIS_REQUIRED" };
  return { reason: "MISSING_REFERENCE", classification: "SEMANTIC_SYNTHESIS_REQUIRED" };
}

function assertCoverageEvidenceMatches(input: { actual: readonly PlanningCoverageEvidence[]; supplied: readonly PlanningCoverageEvidence[] }): void {
  const normalize = (values: readonly PlanningCoverageEvidence[]) => values.map((value) => {
    const withoutAuthorityMetadata = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "ambiguity" && key !== "validatorFinding"),
    );
    return { ...withoutAuthorityMetadata, semanticEvidenceScore: Number(value.semanticEvidenceScore.toFixed(6)) };
  });
  if (checksumPersistedDocument(normalize(input.actual)) !== checksumPersistedDocument(normalize(input.supplied))) throw new PlanningReconciliationError("RECONCILIATION_COVERAGE_EVIDENCE_STALE", "RECONCILIATION_COVERAGE_EVIDENCE_STALE: supplied coverage evidence does not match deterministic current-state analysis.");
}

function validateCurrentness(input: { brief: CanonicalBriefV3; planning: PlanningPackage; currentness: PlanningReconciliationCurrentness }): { states: PlanningReconciliationCurrentnessStates; core: PlanningReconciliationCoreContract; blockers: string[] } {
  const { brief, planning, currentness } = input;
  const briefChecksum = canonicalBriefChecksum(brief);
  const planningDocument = planningDocumentChecksum(planning);
  const planningSemantic = planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY);
  const boundToBrief = currentness.planning.approvedBriefChecksum === briefChecksum
    && currentness.planning.approvedBriefChecksum === planning.approvedBriefChecksum
    && currentness.brief.semanticChecksum === briefChecksum
    && currentness.brief.approvedSemanticChecksum === briefChecksum;
  const checksumValid = currentness.brief.semanticChecksum === briefChecksum
    && currentness.planning.semanticChecksum === planningSemantic
    && currentness.planning.documentChecksum === planningDocument
    && planning.semanticChecksumPolicyVersion === CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY;
  const core = planningCoreContract(brief, planning);
  const blockers: string[] = [];
  if (!currentness.brief.approved) blockers.push("RECONCILIATION_BRIEF_NOT_APPROVED");
  if (!boundToBrief) blockers.push("RECONCILIATION_BRIEF_BINDING_INVALID");
  if (!checksumValid) blockers.push("RECONCILIATION_CHECKSUM_INVALID");
  if (planning.accepted || currentness.planning.accepted) blockers.push("RECONCILIATION_PLANNING_ALREADY_ACCEPTED");
  if (planning.accepted !== currentness.planning.accepted) blockers.push("RECONCILIATION_ACCEPTANCE_TOKEN_INVALID");
  if (currentness.historicalDeltaAvailable) blockers.push("RECONCILIATION_HISTORICAL_DELTA_PREFERRED");
  if (currentness.workflowState !== "AWAITING_DESIGN_SELECTION") blockers.push("RECONCILIATION_WORKFLOW_STATE_INVALID");
  if (!allCoreContractChecksPass(core)) blockers.push("RECONCILIATION_CORE_CONTRACT_INVALID");
  if (currentness.projectId !== planning.projectId || currentness.projectVersion !== planning.projectVersion) blockers.push("RECONCILIATION_PROJECT_BINDING_INVALID");
  if (currentness.planning.approvedBriefChecksum !== planning.approvedBriefChecksum) blockers.push("RECONCILIATION_PLANNING_BRIEF_BINDING_INVALID");
  const states = CurrentnessStatesSchema.parse({ boundToBrief, checksumValid, provenanceCertified: false, coverageCertified: false, accepted: planning.accepted || currentness.planning.accepted });
  return { states, core, blockers };
}

function validatePlanningReferences(brief: CanonicalBriefV3, planning: PlanningPackage): string[] {
  const briefIds = new Set(canonicalRequirementEntries(brief).map((entry) => entry.id));
  const blockers: string[] = [];
  for (const reference of planningRequirementIds(planning)) {
    if (isLegacyRequirementId(reference)) blockers.push(`RECONCILIATION_LEGACY_REFERENCE:${reference}`);
    else if (reference.startsWith("REQUIREMENT:") && (!isV3RequirementId(reference) || !briefIds.has(reference))) blockers.push(`RECONCILIATION_ORPHAN_OR_CROSS_PROJECT_REFERENCE:${reference}`);
  }
  return blockers;
}

function findingFor(evidence: PlanningCoverageEvidence): PlanningReconciliationFinding | undefined {
  if (planningRequirementOwnership(evidence.category) === "NON_PLANNING_OWNED") return undefined;
  const classified = classifyFinding({ evidence, category: evidence.category });
  if (!classified) return undefined;
  const authorized = RECONCILIATION_POLICY[evidence.category];
  const classification = authorized.permittedPathFamilies.length && authorized.permittedOperationKinds.length
    ? classified.classification
    : "NOT_REPAIRABLE_WITHOUT_USER_DECISION";
  return FindingSchema.parse({ requirementId: evidence.requirementId, category: evidence.category, statement: evidence.statement, ownership: "PLANNING_OWNED", reason: classified.reason, classification, semanticEvidenceScore: evidence.semanticEvidenceScore, permittedDomains: [...authorized.permittedDomains], permittedPathFamilies: [...authorized.permittedPathFamilies], permittedOperationKinds: [...authorized.permittedOperationKinds] });
}

function scopePayload(input: {
  brief: CanonicalBriefV3;
  planning: PlanningPackage;
  currentness: PlanningReconciliationCurrentness;
  coverageEvidence: readonly PlanningCoverageEvidence[];
}): z.infer<typeof ScopePayloadSchema> {
  const brief = CanonicalBriefV3Schema.parse(input.brief);
  const planning = PlanningPackageSchema.parse(input.planning);
  const currentness = CurrentnessTokenSchema.parse(input.currentness);
  const actualCoverage = analyzePlanningRequirementCoverage({ candidate: planning, canonicalBrief: brief });
  assertCoverageEvidenceMatches({ actual: actualCoverage, supplied: input.coverageEvidence });
  const suppliedById = new Map(input.coverageEvidence.map((entry) => [entry.requirementId, entry]));
  const reconciledCoverage = actualCoverage.map((entry) => ({ ...entry, ambiguity: suppliedById.get(entry.requirementId)?.ambiguity ?? "NONE" as const, ...(suppliedById.get(entry.requirementId)?.validatorFinding ? { validatorFinding: suppliedById.get(entry.requirementId)!.validatorFinding } : {}) }));
  const currentnessResult = validateCurrentness({ brief, planning, currentness });
  const referenceBlockers = validatePlanningReferences(brief, planning);
  const findings = reconciledCoverage.map(findingFor).filter((finding): finding is PlanningReconciliationFinding => Boolean(finding));
  const unresolvedRequirementIds = [...new Set(findings.map((finding) => finding.requirementId))].sort();
  const authorizedFindings = findings.filter((finding) => finding.classification === "DETERMINISTIC_REPAIRABLE" || finding.classification === "SEMANTIC_SYNTHESIS_REQUIRED");
  const authorizedRequirementIds = [...new Set(authorizedFindings.filter((finding) => finding.permittedPathFamilies.length > 0).map((finding) => finding.requirementId))].sort();
  const authorizedDomains = [...new Set(authorizedFindings.flatMap((finding) => finding.permittedDomains))].sort();
  const authorizedPathFamilies = [...new Set(authorizedFindings.flatMap((finding) => finding.permittedPathFamilies))].sort();
  const permittedOperationKinds = [...new Set(authorizedFindings.flatMap((finding) => finding.permittedOperationKinds))].sort() as PlanningReconciliationOperationKind[];
  const findingsBlockingProvider = findings.filter((finding) => !authorizedRequirementIds.includes(finding.requirementId) || finding.classification === "NOT_REPAIRABLE_WITHOUT_USER_DECISION" || finding.reason === "AMBIGUOUS");
  const blockers = [...new Set([...currentnessResult.blockers, ...referenceBlockers, ...(findingsBlockingProvider.length ? ["RECONCILIATION_SCOPE_NOT_FULLY_BOUNDED"] : [])])];
  const currentnessStates = CurrentnessStatesSchema.parse({ ...currentnessResult.states, coverageCertified: findings.length === 0 && referenceBlockers.length === 0 });
  const admissibleForProviderCall = blockers.length === 0 && currentnessStates.boundToBrief && currentnessStates.checksumValid && !currentnessStates.accepted && referenceBlockers.length === 0 && findings.every((finding) => authorizedRequirementIds.includes(finding.requirementId));
  return ScopePayloadSchema.parse({
    scopeVersion: 1,
    provenanceMode: PLANNING_RECONCILIATION_PROVENANCE_MODE,
    currentness,
    currentnessStates,
    coreContract: currentnessResult.core,
    coverageEvidence: reconciledCoverage,
    unresolvedRequirementIds,
    findings,
    authorizedRequirementIds,
    authorizedDomains,
    authorizedPathFamilies,
    permittedOperationKinds,
    forbiddenOperationKinds: allForbiddenOperations,
    deletionAllowed: false,
    blockers,
    admissibleForProviderCall,
  });
}

export function derivePlanningReconciliationScope(input: {
  currentApprovedBrief: CanonicalBriefV3;
  currentPlanning: PlanningPackage;
  currentness: PlanningReconciliationCurrentness;
  coverageEvidence: readonly PlanningCoverageEvidence[];
}): PlanningReconciliationScope {
  const payload = scopePayload({ brief: input.currentApprovedBrief, planning: input.currentPlanning, currentness: input.currentness, coverageEvidence: input.coverageEvidence });
  return PlanningReconciliationScopeSchema.parse({ ...payload, scopeChecksum: stableScopeChecksum(payload) });
}

function assertScopeBinding(scope: PlanningReconciliationScope): void {
  const payload = { ...scope };
  delete (payload as { scopeChecksum?: string }).scopeChecksum;
  if (stableScopeChecksum(ScopePayloadSchema.parse(payload)) !== scope.scopeChecksum) throw new PlanningReconciliationError("RECONCILIATION_SCOPE_CHECKSUM_INVALID");
}

function assertHostRequirementReferences(scope: PlanningReconciliationScope, brief: CanonicalBriefV3, references: readonly string[]): void {
  const briefIds = new Set(canonicalRequirementEntries(brief).map((entry) => entry.id));
  if (!references.length || references.some((reference) => !isV3RequirementId(reference) || !briefIds.has(reference) || !scope.authorizedRequirementIds.includes(reference))) throw new PlanningReconciliationError("RECONCILIATION_PROVIDER_REFERENCE_UNAUTHORIZED");
}

function assertCurrentPlanningMatchesScope(scope: PlanningReconciliationScope, current: PlanningPackage): void {
  if (current.projectId !== scope.currentness.projectId
    || current.projectVersion !== scope.currentness.projectVersion
    || planningDocumentChecksum(current) !== scope.currentness.planning.documentChecksum
    || planningSemanticChecksumForPolicy(current, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY) !== scope.currentness.planning.semanticChecksum
    || current.approvedBriefChecksum !== scope.currentness.planning.approvedBriefChecksum
    || current.accepted !== scope.currentness.planning.accepted
    || current.accepted
    || scope.currentness.planning.semanticChecksumPolicy !== CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY) throw new PlanningReconciliationError("RECONCILIATION_CURRENTNESS_STALE");
}

function applyOperation(next: PlanningPackage, operation: PlanningChangeOperation): void {
  if (operation.kind === "set-product-scope-field") {
    if (Array.isArray(operation.value)) {
      const currentValues = next.productScope[operation.field] as string[];
      if (currentValues.some((value) => !operation.value.includes(value))) throw new PlanningReconciliationError("RECONCILIATION_SCOPE_LOSS_FORBIDDEN");
    }
    next.productScope = { ...next.productScope, [operation.field]: operation.value };
  } else if (operation.kind === "set-architecture-field") {
    next.architecture = { ...next.architecture, [operation.field]: operation.field === "npmScripts" ? Object.fromEntries(operation.value.map((script) => [script.name, script.command])) : operation.value };
  } else if (operation.kind === "upsert-route") {
    if (!next.sitemap.routes.some((route) => route.id === operation.value.id)) throw new PlanningReconciliationError("RECONCILIATION_NEW_ROUTE_FORBIDDEN");
    const { primaryCta, parentId, ...route } = operation.value;
    next.sitemap = { ...next.sitemap, routes: replaceById(next.sitemap.routes, { ...route, ...(primaryCta === null ? {} : { primaryCta }), ...(parentId === null ? {} : { parentId }) }) };
  } else if (operation.kind === "upsert-page") {
    if (!next.pages.pages.some((page) => page.id === operation.value.id)) throw new PlanningReconciliationError("RECONCILIATION_NEW_PAGE_FORBIDDEN");
    next.pages = { ...next.pages, pages: replaceById(next.pages.pages, operation.value) };
  } else if (operation.kind === "upsert-form") {
    if (!next.forms.forms.some((form) => form.id === operation.value.id)) throw new PlanningReconciliationError("RECONCILIATION_NEW_FORM_FORBIDDEN");
    next.forms = { ...next.forms, forms: replaceById(next.forms.forms, operation.value) };
  } else {
    throw new PlanningReconciliationError("RECONCILIATION_OPERATION_FORBIDDEN");
  }
}

function assertCorePreserved(before: PlanningReconciliationCoreContract, after: PlanningReconciliationCoreContract): void {
  if (before.protectedBrief && (!allCoreContractChecksPass(after) || checksumPersistedDocument(before) !== checksumPersistedDocument(after))) throw new PlanningReconciliationError("RECONCILIATION_CORE_CONTRACT_CHANGED");
}

export function applyPlanningReconciliationProposal(input: {
  scope: PlanningReconciliationScope;
  current: PlanningPackage;
  canonicalBrief: CanonicalBriefV3;
  proposal: unknown;
  timestamp: string;
}): PlanningReconciliationAdmission {
  assertScopeBinding(input.scope);
  const proposal = PlanningReconciliationProviderProposalSchema.parse(input.proposal);
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const current = PlanningPackageSchema.parse(input.current);
  if (!input.scope.admissibleForProviderCall) throw new PlanningReconciliationError("RECONCILIATION_SCOPE_NOT_ADMISSIBLE");
  if (canonicalBriefChecksum(brief) !== input.scope.currentness.brief.semanticChecksum
    || !input.scope.currentness.brief.approved
    || input.scope.currentness.brief.approvedSemanticChecksum !== input.scope.currentness.brief.semanticChecksum
  ) throw new PlanningReconciliationError("RECONCILIATION_CURRENTNESS_STALE");
  assertCurrentPlanningMatchesScope(input.scope, current);
  const next = structuredClone(current) as PlanningPackage;
  const operationPaths: string[] = [];
  for (const operation of proposal.changes) {
    if (operation.kind === "remove-route" || operation.kind === "remove-page" || operation.kind === "remove-form") throw new PlanningReconciliationError("RECONCILIATION_PROVIDER_DELETION_FORBIDDEN");
    if (!(input.scope.permittedOperationKinds as readonly string[]).includes(operation.kind) || !input.scope.authorizedDomains.includes(operationDomain(operation))) throw new PlanningReconciliationError("RECONCILIATION_PROVIDER_OPERATION_UNAUTHORIZED");
    const references = operationReferences(operation);
    assertHostRequirementReferences(input.scope, brief, references);
    const operationBefore = comparableSemanticValue(next);
    operationPaths.push(operationPath(operation));
    applyOperation(next, operation);
    const operationAfter = comparableSemanticValue(next);
    assertNoSemanticDeletion(operationBefore, operationAfter);
    const operationChangedPaths = diffSemanticPaths(operationBefore, operationAfter).map(normalizePath);
    const unauthorizedOperationPaths = operationChangedPaths.filter((path) => path !== "planning.traceability[]" && !findingAuthorizesPath(input.scope, path, operation, references));
    if (unauthorizedOperationPaths.length) throw new PlanningReconciliationError(`RECONCILIATION_PROVIDER_PATH_UNAUTHORIZED:${unauthorizedOperationPaths.join(",")}`);
  }
  next.updatedAt = input.timestamp;
  next.semanticChecksumPolicyVersion = CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY;
  next.approvedBriefChecksum = input.scope.currentness.brief.semanticChecksum;
  next.accepted = false;
  next.acceptance = {};
  next.architecture = { ...next.architecture, acceptance: { accepted: false } };
  for (const [index, operation] of proposal.changes.entries()) next.traceability = [...next.traceability, {
    decisionId: reconciliationDecisionId(operation, index, input.scope.scopeChecksum),
    category: "planning-reconciliation",
    requirementReferences: [...new Set(operationReferences(operation))],
    systemConstraintReferences: ["PLANNING_RECONCILIATION_HOST_APPLY"],
    rationale: `Host applied bounded ${operation.kind} reconciliation operation.`,
    confidence: "high",
    userConfirmationRequired: false,
  }];
  const candidate = PlanningPackageSchema.parse(next);
  assertNoSemanticDeletion(comparableSemanticValue(current), comparableSemanticValue(candidate));
  const changedPaths = [...new Set(diffSemanticPaths(
    // Lifecycle and policy fields are excluded from the semantic domain by the
    // shared checksum projection. The explicit checks above still own them.
    comparableSemanticValue(current),
    comparableSemanticValue(candidate),
  ).map(normalizePath))].sort();
  const unauthorizedPaths = changedPaths.filter((path) => !pathAllowed(path, input.scope.authorizedPathFamilies) && path !== "planning.traceability[]");
  if (unauthorizedPaths.length) throw new PlanningReconciliationError(`RECONCILIATION_UNAUTHORIZED_PATH:${unauthorizedPaths.join(",")}`);
  const beforeCore = planningCoreContract(brief, current);
  const afterCore = planningCoreContract(brief, candidate);
  assertCorePreserved(beforeCore, afterCore);
  const postApplyCoverage = analyzePlanningRequirementCoverage({ candidate, canonicalBrief: brief });
  const remainingBlocking = postApplyCoverage.filter((evidence) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(evidence.category) && (evidence.semanticEvidence !== "FULL" || !evidence.referencePresent));
  if (remainingBlocking.length) throw new PlanningReconciliationError("RECONCILIATION_POST_APPLY_COVERAGE_BLOCKING");
  return { candidate, proposal, changedPaths: [...new Set([...operationPaths, ...changedPaths])].sort(), blockers: [], postApplyCoverage };
}

export function buildPlanningReconciliationProviderEnvelope(input: { scope: PlanningReconciliationScope; canonicalBrief: CanonicalBriefV3; currentPlanning: PlanningPackage }): PlanningReconciliationProviderEnvelope {
  assertScopeBinding(input.scope);
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const currentPlanning = PlanningPackageSchema.parse(input.currentPlanning);
  if (!input.scope.admissibleForProviderCall) throw new PlanningReconciliationError("RECONCILIATION_SCOPE_NOT_ADMISSIBLE");
  if (canonicalBriefChecksum(brief) !== input.scope.currentness.brief.semanticChecksum
    || !input.scope.currentness.brief.approved
    || input.scope.currentness.brief.approvedSemanticChecksum !== input.scope.currentness.brief.semanticChecksum) throw new PlanningReconciliationError("RECONCILIATION_CURRENTNESS_STALE");
  assertCurrentPlanningMatchesScope(input.scope, currentPlanning);
  const requirementIds = new Set(input.scope.authorizedRequirementIds);
  const requirements = canonicalRequirementEntries(brief).filter((entry) => requirementIds.has(entry.id));
  const allowedTopLevel = new Set(input.scope.authorizedDomains.map((domain) => ({
    "product-scope": "productScope",
    routes: "sitemap",
    pages: "pages",
    flows: "userFlows",
    forms: "forms",
    architecture: "architecture",
    content: "content",
    tests: "testStrategy",
  }[domain])).filter((key): key is keyof PlanningPackage => Boolean(key)));
  const planningContext: Record<string, unknown> = {};
  for (const key of allowedTopLevel) planningContext[key] = currentPlanning[key];
  return PlanningReconciliationProviderEnvelopeSchema.parse({
    contractVersion: 1,
    projectId: input.scope.currentness.projectId,
    projectVersion: input.scope.currentness.projectVersion,
    scopeChecksum: input.scope.scopeChecksum,
    approvedBriefChecksum: input.scope.currentness.brief.semanticChecksum,
    requirements,
    planningContext,
    authorizedRequirementIds: input.scope.authorizedRequirementIds,
    authorizedDomains: input.scope.authorizedDomains,
    authorizedPathFamilies: input.scope.authorizedPathFamilies,
    permittedOperationKinds: input.scope.permittedOperationKinds,
    forbiddenOperationKinds: input.scope.forbiddenOperationKinds,
    immutableConstraints: [
      "Provider may not author scope, identities, lineage, checksums, CAS tokens, workflow, acceptance, currentness, or Project Memory state.",
      "Provider may not use legacy or provider-authored requirement IDs.",
      "Provider may not delete or replace the Planning package.",
    ],
  });
}

export function planningReconciliationCurrentnessSummary(scope: PlanningReconciliationScope): PlanningReconciliationCurrentnessStates {
  assertScopeBinding(scope);
  return scope.currentnessStates;
}
