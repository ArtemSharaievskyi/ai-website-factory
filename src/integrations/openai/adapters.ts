import { createHash, randomUUID } from "node:crypto";
import type { LeadAnalysisProvider } from "@/agents/lead/ports";
import {
  BriefDraftSchema,
  ClarificationPlanSchema,
  ClarificationPlanProviderOutputSchema,
  LeadAgentAnalysisSchema,
  LeadAnalysisProviderOutputSchema,
  type BriefDraft,
  type ClarificationPlan,
  type ClarificationPlanProviderOutput,
  type LeadAgentAnalysis,
  type LeadAnalysisProviderOutput,
} from "@/agents/lead/contracts";
import type { RequirementCategory } from "@/domain/requirements/v3/schema";
import type { PlannerArchitectureProvider } from "@/agents/planner/ports";
import type { PlanningRecoveryProviderInput, PlanningRecoveryProviderResult } from "@/agents/planner/recovery";
import {
  createPlanningRecoverySemanticAccountingSchema,
  PlanningRecoverySemanticAccountingEntrySchema,
  PlanningRequirementDispositionSchema,
  PlanningTargetHandleRefSchema,
  type CanonicalPlanningRouteManifest,
  type PlanningOwnedRequirementManifest,
} from "@/agents/planner/recovery-manifests";
import {
  PLANNER_PROVIDER_CONTRACT_VERSION,
  PlannerPageToken,
  PlannerRequirementToken,
  PlannerRouteToken,
  plannerProviderReferenceProtocol,
  PlannerReferenceTableSchema,
  type PlannerReferenceTable,
} from "@/agents/planner/reference-table";
import { isClientOnlyFormBrief, isNoBackendBrief } from "@/agents/planner/deterministic";
import { PlanningChangeSetProviderOutputSchema, type PlannerRefreshProviderInput, type PlanningChangeSetProviderOutput } from "@/agents/planner/changeset";
import {
  FormFieldSchema,
  FormPlanSchema,
  FormSchema,
  PlanningPackageSchema,
  StoragePlanSchema,
  type PlanningPackage,
} from "@/agents/planner/contracts";
import type { DesignDirectionProvider } from "@/agents/design/ports";
import {
  DesignDirectionSchema,
  DesignDirectionSetSchema,
  type DesignDirectionSet,
} from "@/domain/design/schema";
import type {
  ImplementationProvider,
  ImplementationContext,
  ImplementationChangeProposal,
} from "@/agents/implementation/contracts";
import { ImplementationChangeProposalSchema } from "@/agents/implementation/contracts";
import { OpenAiStructuredClient, buildProductionResponseFormat, type StructuredSchemaDefinition } from "./client";
import { AiProviderError } from "./errors";
import { boundedRolePrompt as rolePrompt } from "@/runtime/context/bridge";
import type { ProviderDiagnostic, ProviderUsageSink } from "./usage";
import type { OrchestrationPlanningProvider } from "@/orchestration/orchestrator/service";
import {
  ArchitectureReviewProviderOutputSchema,
  type ArchitectureReviewProviderOutput,
} from "@/domain/review/schema";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import type { ArchitectureReviewProvider } from "@/agents/reviewers/architecture/ports";
import type { ContractAuditProvider } from "@/agents/reviewers/contracts/ports";
import { CONTRACT_AUDIT_PROMPT_VERSION, type ContractAuditInput } from "@/agents/reviewers/contracts/contracts";
import {
  ContractAuditProviderOutputSchema,
  type ContractAuditProviderOutput,
} from "@/domain/review/schema";
import type { CodeIntegrationReviewProvider } from "@/agents/reviewers/code-integration/ports";
import type { CodeIntegrationReviewInput } from "@/agents/reviewers/code-integration/contracts";
import {
  CodeIntegrationReviewProviderOutputSchema,
  type CodeIntegrationReviewProviderOutput,
} from "@/domain/review/schema";
import type { SecurityReviewProvider } from "@/agents/reviewers/security/ports";
import type { SecurityReviewInput } from "@/agents/reviewers/security/contracts";
import {
  SecurityReviewProviderOutputSchema,
  type SecurityReviewProviderOutput,
} from "@/domain/review/schema";
import type { TestQualityReviewProvider } from "@/agents/reviewers/test-quality/ports";
import type { TestQualityReviewInput } from "@/agents/reviewers/test-quality/contracts";
import {
  TestQualityReviewProviderOutputSchema,
  type TestQualityReviewProviderOutput,
} from "@/domain/review/schema";
import { z } from "zod";
import {
  NonEmptyStringSchema,
  IsoDateTimeSchema,
  UserValueSchema,
} from "@/domain/shared/schemas";
import { ProjectBriefV2Schema, type RequirementSpecification } from "@/domain/requirements/schema";
import {
  BriefAssetRequirementsSchema,
  BriefBrandVisualRequirementsSchema,
  BriefDecisionSchema,
  BriefDeferredIntegrationSchema,
  BriefFormBehaviorRequirementsSchema,
  BriefLegalComplianceRequirementsSchema,
  BriefRequirementEntrySchema,
  BriefSeoRequirementsSchema,
  BriefUxResponsiveRequirementsSchema,
} from "@/domain/requirements/brief";
import { OperatorLanguageSchema, SiteLanguageDecisionSchema, type SiteLanguageDecision } from "@/domain/language/schema";
import { resolveLogoPolicy } from "@/domain/requirements/logo-policy";
import {
  AssetManifestEntrySchema,
  AssetManifestSchema,
} from "@/domain/assets/schema";
import { TechnicalArchitectureSchema } from "@/domain/architecture/schema";
import {
  SitemapPlanSchema,
  UserFlowPlanSchema,
  TraceabilitySchema,
} from "@/agents/planner/contracts";
import { isWorkflowRequirement } from "@/agents/lead/clarification-policy";
import type { ApprovedProceduralSkillPromptContext } from "./prompts";
import { dependencyCatalogPromptContext } from "@/dependencies/authority";
import { sliceDocumentationExcerpt } from "@/runtime/context/slicing";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
/** Read-only export for local contract verification; production behavior is unchanged. */
export const OrchestrationPlanSchema = z
  .object({ tasks: z.array(z.unknown()) })
  .strict();
const checksumText = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const checksumTextPatchResult = (operation: { relativePath: string; oldText: string; newText: string; expectedResultChecksum: string }, files: ImplementationContext["files"]) => {
  const relativePath = operation.relativePath.replaceAll("\\", "/");
  const source = files.find((file) => file.relativePath.replaceAll("\\", "/") === relativePath);
  if (!source || source.content.split(operation.oldText).length - 1 !== 1) return operation.expectedResultChecksum;
  return checksumText(source.content.replace(operation.oldText, operation.newText));
};
const dropNullFields = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== null));
const withoutProjectIdentity = <T extends Record<string, z.ZodTypeAny>>(shape: T) => {
  const result = { ...shape };
  delete result.projectId;
  delete result.projectVersion;
  return result;
};
const withoutProviderDocumentMetadata = <T extends Record<string, z.ZodTypeAny>>(shape: T) => {
  const result = withoutProjectIdentity(shape);
  delete result.createdAt;
  delete result.updatedAt;
  return result;
};
const withoutProviderDocumentMetadataAndAcceptance = <T extends Record<string, z.ZodTypeAny>>(shape: T) => {
  const result = withoutProviderDocumentMetadata(shape);
  delete result.acceptance;
  return result;
};
const withoutProjectIdentityAndAcceptance = <T extends Record<string, z.ZodTypeAny>>(shape: T) => {
  const result = withoutProjectIdentity(shape);
  delete result.acceptance;
  return result;
};
function bindProjectIdentity<T>(value: T, host: { projectId: string; projectVersion: number }): T {
  if (Array.isArray(value)) return value.map((item) => bindProjectIdentity(item, host)) as T;
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, bindProjectIdentity(item, host)]));
  if (typeof result.documentType === "string") {
    result.projectId = host.projectId;
    result.projectVersion = host.projectVersion;
  }
  return result as T;
}
const normalizeAstTransportOperation = (operation: Record<string, unknown>) => {
  const rest = { ...operation };
  for (const key of ["taskId", "taskContractId", "taskContractChecksum", "taskGraphChecksum", "projectId", "projectVersion"]) delete rest[key];
  const artifactId = rest.artifactId;
  const expectedTarget = rest.expectedTarget;
  const selector = rest.selector;
  const payload = rest.payload;
  delete rest.artifactId;
  delete rest.expectedTarget;
  delete rest.selector;
  delete rest.payload;
  return { ...rest, ...(artifactId === null ? {} : { artifactId }), ...(expectedTarget === null ? {} : { expectedTarget: dropNullFields(expectedTarget as Record<string, unknown>) }), selector: dropNullFields(selector as Record<string, unknown>), payload: dropNullFields(payload as Record<string, unknown>) };
};

const ImplementationOperationStructuredBaseSchema = z
  .object({
    relativePath: z.string().min(1),
    expectedPriorChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    expectedResultChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    encoding: z.literal("utf-8"),
    reason: z.string().min(1).max(500),
    requirementReferences: z.array(z.string().min(1)),
    planningReferences: z.array(z.string().min(1)),
    selectedDesignReferences: z.array(z.string().min(1)),
  })
  .strict();
const AstSelectorStructuredSchema = z.discriminatedUnion("selectorKind", [
  z.object({ selectorKind: z.literal("function"), name: z.string(), exported: z.boolean().nullable(), defaultExport: z.boolean().nullable() }).strict(),
  z.object({ selectorKind: z.literal("arrow-function"), name: z.string(), exported: z.boolean().nullable(), defaultExport: z.boolean().nullable() }).strict(),
  z.object({ selectorKind: z.literal("variable"), name: z.string() }).strict(),
  z.object({ selectorKind: z.literal("object-property"), objectName: z.string(), propertyName: z.string() }).strict(),
  z.object({ selectorKind: z.literal("import-declaration"), moduleSpecifier: z.string(), typeOnly: z.boolean().nullable() }).strict(),
  z.object({ selectorKind: z.literal("import-specifier"), moduleSpecifier: z.string(), importedName: z.string(), localName: z.string().nullable(), typeOnly: z.boolean().nullable() }).strict(),
  z.object({ selectorKind: z.literal("class-method"), className: z.string(), methodName: z.string(), exported: z.boolean().nullable(), defaultExport: z.boolean().nullable() }).strict(),
]);
const AstExpectedTargetStructuredSchema = z.object({ nodeKind: z.string(), structuralFingerprint: z.string().nullable() }).strict();
const AstPatchStructuredBaseSchema = z.object({
  type: z.literal("ast-patch"),
  operationId: z.string().uuid(),
  operationVersion: z.literal("1.0.0"),
  relativePath: z.string().min(1),
  expectedFileChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  expectedResultChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  encoding: z.literal("utf-8"),
  artifactId: z.string().nullable(),
  reason: z.string().min(1).max(500),
  requirementReferences: z.array(z.string().min(1)),
  planningReferences: z.array(z.string().min(1)),
  selectedDesignReferences: z.array(z.string().min(1)),
  selector: AstSelectorStructuredSchema,
  expectedTarget: AstExpectedTargetStructuredSchema.nullable(),
  resultValidation: z.object({ parseRequired: z.literal(true), validationVersion: z.literal("1") }).strict(),
}).strict();
const AstPatchStructuredSchema = z.discriminatedUnion("patchKind", [
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("REPLACE_NODE_BODY"), payload: z.object({ body: z.string() }).strict() }),
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("INSERT_BEFORE_NODE"), payload: z.object({ source: z.string() }).strict() }),
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("INSERT_AFTER_NODE"), payload: z.object({ source: z.string() }).strict() }),
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("ADD_NAMED_IMPORT"), payload: z.object({ moduleSpecifier: z.string(), importedName: z.string(), localName: z.string().nullable(), typeOnly: z.boolean() }).strict() }),
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("REMOVE_IMPORT_SPECIFIER"), payload: z.object({}).strict() }),
  AstPatchStructuredBaseSchema.extend({ patchKind: z.literal("ADD_OBJECT_PROPERTY"), payload: z.object({ propertyName: z.string(), value: z.string() }).strict() }),
]);
const ImplementationOperationStructuredSchema = z.union([
  ImplementationOperationStructuredBaseSchema.extend({
    type: z.literal("create-file"),
    content: z.string(),
  }),
  ImplementationOperationStructuredBaseSchema.extend({
    type: z.literal("replace-file"),
    content: z.string(),
  }),
  ImplementationOperationStructuredBaseSchema.extend({
    type: z.literal("delete-file"),
  }),
  ImplementationOperationStructuredBaseSchema.extend({
    type: z.literal("patch-text"),
    oldText: z.string(),
    newText: z.string(),
  }),
  AstPatchStructuredSchema,
]);
const Phase7CStructuredBindingSchema = z.object({
  dataContractIds: z.array(z.string().uuid()),
  databaseDecisionId: z.string().uuid().nullable(),
  databaseDecisionChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  dependencyProposalId: z.string().uuid().nullable(),
}).strict();
export const ImplementationChangeProposalStructuredOutputSchema = z
  .object({
    proposalId: z.string().uuid(),
    summary: z.string().min(1).max(1000),
    operations: z.array(ImplementationOperationStructuredSchema),
    expectedChangedFiles: z.array(z.string().min(1)),
    expectedCreatedFiles: z.array(z.string().min(1)),
    expectedDeletedFiles: z.array(z.string().min(1)),
    validationPlan: z.array(z.string().min(1)),
    requirementReferences: z.array(z.string().min(1)),
    planningReferences: z.array(z.string().min(1)),
    selectedDesignReferences: z.array(z.string().min(1)),
    phase7c: Phase7CStructuredBindingSchema.nullable(),
    providerMetadata: z
      .object({
        provider: z.string().min(1),
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    generatedAt: z.string().datetime(),
  })
  .strict();
const ImplementationOperationWithoutAstStructuredSchema = z.union([
  ImplementationOperationStructuredBaseSchema.extend({ type: z.literal("create-file"), content: z.string() }),
  ImplementationOperationStructuredBaseSchema.extend({ type: z.literal("replace-file"), content: z.string() }),
  ImplementationOperationStructuredBaseSchema.extend({ type: z.literal("patch-text"), oldText: z.string(), newText: z.string() }),
  ImplementationOperationStructuredBaseSchema.extend({ type: z.literal("delete-file") }),
]);
const ImplementationChangeProposalWithoutAstStructuredOutputSchema = ImplementationChangeProposalStructuredOutputSchema.extend({ operations: z.array(ImplementationOperationWithoutAstStructuredSchema) });

const BriefStructuredAnalysisMetadataSchema = z
  .object({
    provider: z.string(),
    unsupportedAssumptions: z.array(z.string()),
    contradictionCount: z.number().int().nonnegative(),
  })
  .strict();
/** Strict-output transport shape; nullable values are normalized into the canonical Brief domain shape below. */
const BriefSeoTransportSchema = BriefSeoRequirementsSchema.extend({
  exactTitle: NonEmptyStringSchema.nullable(),
  exactMetaDescription: NonEmptyStringSchema.nullable(),
  pageMetadata: z.array(z.object({
    route: NonEmptyStringSchema,
    title: NonEmptyStringSchema.nullable(),
    metaDescription: NonEmptyStringSchema.nullable(),
    keywords: z.array(NonEmptyStringSchema),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
  }).strict()),
});
const BriefPageTransportSchema = z.object({ slug: NonEmptyStringSchema, purpose: NonEmptyStringSchema }).strict();
const BriefUnresolvedItemTransportSchema = z.object({ id: z.string().uuid(), description: NonEmptyStringSchema, blocking: z.boolean() }).strict();
const BriefEvidenceTransportSchema = z.object({ field: NonEmptyStringSchema, source: NonEmptyStringSchema, excerpt: NonEmptyStringSchema }).strict();
const BriefAssetReferenceTransportSchema = z.string().min(1).max(160).regex(/^[^\\/]+$/);
const BriefAssetRequirementsTransportSchema = BriefAssetRequirementsSchema.extend({
  requiredAssets: z.array(z.object({
    reference: BriefAssetReferenceTransportSchema,
    role: z.enum(["logo", "brand-reference", "photography", "illustration", "document", "other"]),
    usage: NonEmptyStringSchema,
    replacementForbidden: z.boolean(),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
  }).strict()),
});
/**
 * Provider DTO only. Host-owned identity, language, approval, history, checksums,
 * and trace/reconciliation state are deliberately not part of this schema.
 */
export const BriefRequirementsTransportSchema = z.object({
  projectSummary: NonEmptyStringSchema,
  protectedFunctionalityRequired: z.boolean(),
  imagesRequired: z.boolean(),
  businessGoals: z.array(NonEmptyStringSchema),
  targetAudiences: z.array(NonEmptyStringSchema),
  pages: z.array(BriefPageTransportSchema),
  userRoles: z.array(NonEmptyStringSchema),
  features: z.array(NonEmptyStringSchema),
  forms: z.array(NonEmptyStringSchema),
  contentRequirements: z.array(NonEmptyStringSchema),
  backendRequirements: z.array(NonEmptyStringSchema),
  supabaseRequirements: z.array(NonEmptyStringSchema),
  authenticationDecision: z.enum(["no-authentication-guest-first", "authentication-required", "pending"]),
  storageDecision: z.enum(["not-needed", "needed", "pending"]),
  emailDecision: z.enum(["not-needed", "needed", "pending"]),
  administrationDecision: z.enum(["not-needed", "needed", "pending"]),
  seoRequirements: z.array(NonEmptyStringSchema),
  imageSourceDecision: z.enum(["ai-generated", "user-supplied", "ai-plus-user-supplied", "placeholders", "custom", "pending"]),
  suppliedBrandInformation: UserValueSchema,
  suppliedLogoLocation: UserValueSchema,
  technicalConstraints: z.array(NonEmptyStringSchema),
  explicitExclusions: z.array(NonEmptyStringSchema),
  userAcceptanceCriteria: z.array(NonEmptyStringSchema),
  unresolvedItems: z.array(BriefUnresolvedItemTransportSchema),
  projectTitle: NonEmptyStringSchema.nullable(),
  contactFacts: z.array(NonEmptyStringSchema),
  legalFacts: z.array(NonEmptyStringSchema),
  brandFacts: z.array(NonEmptyStringSchema),
  logoMetadata: z.array(NonEmptyStringSchema),
  imageSourcingNotes: z.array(NonEmptyStringSchema),
  evidence: z.array(BriefEvidenceTransportSchema),
  recommendations: z.array(NonEmptyStringSchema),
  analysisMetadata: BriefStructuredAnalysisMetadataSchema.nullable(),
  content: z.array(BriefRequirementEntrySchema),
  technical: z.array(BriefRequirementEntrySchema),
  brandVisualRequirements: BriefBrandVisualRequirementsSchema,
  assetRequirements: BriefAssetRequirementsTransportSchema,
  formBehaviorRequirements: BriefFormBehaviorRequirementsSchema,
  uxResponsiveRequirements: BriefUxResponsiveRequirementsSchema,
  seoMetadata: BriefSeoTransportSchema,
  legalComplianceConstraints: BriefLegalComplianceRequirementsSchema,
  prohibitedRequirements: z.array(BriefRequirementEntrySchema),
  deferredIntegrations: z.array(BriefDeferredIntegrationSchema),
  decisions: z.array(BriefDecisionSchema),
}).strict();
export const BriefDraftStructuredOutputSchema = BriefDraftSchema.omit({ projectId: true, projectVersion: true, briefChecksum: true }).extend({
  requirements: BriefRequirementsTransportSchema,
});
// Professional design contracts are host-bound after model generation; they
// are intentionally excluded from the model transport shape so the strict
// provider schema does not become a second source of design authority.
const StrictDesignDirectionSchema = DesignDirectionSchema.omit({ id: true, professionalDesign: true, canonicalContent: true, canonicalServiceConflictRefs: true }).required().extend({
  /** Optional typed provider observation; host canonical content remains authoritative. */
  canonicalServiceConflictRefs: z.array(NonEmptyStringSchema.max(240)).max(20).nullable(),
});
/** Provider-authored semantic directions only; all set, identity, and lifecycle metadata is host-owned. */
export const DesignDirectionStructuredOutputSchema = z
  .object({ directions: z.array(StrictDesignDirectionSchema).length(3) })
  .strict()
  .required();
export const isWorkflowApprovalBlocker = (text: string) =>
  /(?:project )?brief approval (?:is required|is still pending)|brief.*(?:approval|user approval|approved).*before planner|approve.*brief.*before planner|planner.*before.*brief approval|explicit.*brief.*approval.*(?:not|pending|recorded)|brief.*(?:not|has not).*explicitly approved|brief.*draft.*(?:not|has not).*approved.*before planner/i.test(
    text,
  );
const zodIssuePaths = (error: unknown) => error instanceof z.ZodError ? error.issues.map((issue) => issue.path.map(String).join(".")).filter(Boolean).slice(0, 20) : undefined;
const zodIssueCount = (error: unknown) => error instanceof z.ZodError ? error.issues.length : undefined;
const zodIssueCode = (error: unknown) => {
  const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
  if (!issue) return undefined;
  if (issue.code === "unrecognized_keys") return "UNKNOWN_FIELD";
  if (issue.code === "invalid_type") return "INVALID_TYPE";
  if (issue.code === "invalid_value") return "INVALID_ENUM_OR_LITERAL";
  if (issue.code === "invalid_format") return "INVALID_FORMAT";
  return "INVALID_FIELD";
};
function normalizeBriefDraft(
  value: z.infer<typeof BriefDraftStructuredOutputSchema>,
  host: { projectId: string; projectVersion: number; operatorLanguage: z.infer<typeof OperatorLanguageSchema>; siteLanguage: SiteLanguageDecision; originalPromptChecksum: string },
  providerDiagnostic?: ProviderDiagnostic,
): BriefDraft {
  const { requirements: transportRequirements, ...providerDraft } = value;
  const {
    projectTitle,
    analysisMetadata,
    seoMetadata,
    ...canonicalFields
  } = transportRequirements;
  const normalizedSeoMetadata = {
    primaryKeywords: seoMetadata.primaryKeywords,
    ...(seoMetadata.exactTitle === null ? {} : { exactTitle: seoMetadata.exactTitle }),
    ...(seoMetadata.exactMetaDescription === null ? {} : { exactMetaDescription: seoMetadata.exactMetaDescription }),
    locationTargeting: seoMetadata.locationTargeting,
    pageMetadata: seoMetadata.pageMetadata.map((page) => ({
      route: page.route,
      keywords: page.keywords,
      sourceRefs: page.sourceRefs,
      ...(page.title === null ? {} : { title: page.title }),
      ...(page.metaDescription === null ? {} : { metaDescription: page.metaDescription }),
  })),
  };
  const siteLanguage = SiteLanguageDecisionSchema.parse(host.siteLanguage);
  if (siteLanguage === "UNRESOLVED") throw new AiProviderError("AI_OUTPUT_INVALID", "Provider output cannot be bound while the host site language is unresolved.", undefined, { ...providerDiagnostic, stage: "provider_normalization", outputStage: "HOST_MAPPING_FAILED", requestAttempted: providerDiagnostic?.requestAttempted ?? true, apiResponseReceived: providerDiagnostic?.apiResponseReceived ?? true, responseReceived: providerDiagnostic?.responseReceived ?? true, outputComplete: providerDiagnostic?.outputComplete ?? true, schemaName: providerDiagnostic?.schemaName ?? "brief-draft", issueCode: "SITE_LANGUAGE_UNRESOLVED", fieldPath: "localization.defaultLocale" });
  const siteLocale = siteLanguage;
  const normalizedRequirements = {
    schemaVersion: 1 as const,
    documentType: "requirements" as const,
    projectId: host.projectId,
    projectVersion: host.projectVersion,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...canonicalFields,
    seoMetadata: normalizedSeoMetadata,
    operatorLanguage: host.operatorLanguage,
    localization: { locales: [siteLocale], defaultLocale: siteLocale },
    briefSchemaVersion: 2 as const,
    briefStatus: "draft" as const,
    approval: { approved: false },
    briefVersion: 1,
    ...(projectTitle === null ? {} : { projectTitle }),
    ...(analysisMetadata === null ? {} : { analysisMetadata: { ...analysisMetadata, originalPromptChecksum: host.originalPromptChecksum } }),
  };
  normalizedRequirements.brandFacts = normalizedRequirements.brandFacts.filter(
    (fact) =>
      !/^(project name:|business name:|no supplied|no (palette|typography|logo|layout)|no prescribed (palette|typography|logo|layout)|no (logo|brand|palette|typography|layout) (was )?(provided|supplied)|(?:logo|brand|palette|typography|layout) (was )?not (provided|supplied)|(?:use|propose) a neutral .* (?:visual )?design direction|.*is the project name)/i.test(
        fact.trim(),
      ),
  );
  const unresolvedItems = value.unresolvedItems.filter(
    (item) => !isWorkflowRequirement(item),
  );
  const normalizedRequirementItems = transportRequirements.unresolvedItems.filter(
    (item) => !isWorkflowRequirement({ description: item.description }),
  );
  const blockingReasons = value.blockingReasons.filter(
    (reason) =>
      !isWorkflowApprovalBlocker(reason) &&
      !/no blocking confirmation is required.*brief draft/i.test(reason),
  );
  let canonicalRequirements: z.infer<typeof ProjectBriefV2Schema>;
  try {
    canonicalRequirements = ProjectBriefV2Schema.parse({ ...normalizedRequirements, unresolvedItems: normalizedRequirementItems });
  } catch (error) {
    throw new AiProviderError("AI_OUTPUT_INVALID", "Provider output could not be bound to canonical Project Brief V2.", undefined, { ...providerDiagnostic, stage: "provider_normalization", outputStage: "CANONICAL_BRIEF_V2_VALIDATION_FAILED", requestAttempted: providerDiagnostic?.requestAttempted ?? true, apiResponseReceived: providerDiagnostic?.apiResponseReceived ?? true, responseReceived: providerDiagnostic?.responseReceived ?? true, outputComplete: providerDiagnostic?.outputComplete ?? true, schemaName: providerDiagnostic?.schemaName ?? "brief-draft", issueCode: zodIssueCode(error), fieldPath: zodIssuePaths(error)?.[0], issueCount: zodIssueCount(error), domainValidationIssuePaths: zodIssuePaths(error) });
  }
  try {
    const normalizedDraft = {
      ...providerDraft,
      projectId: host.projectId,
      projectVersion: host.projectVersion,
      requirements: canonicalRequirements,
      unresolvedItems,
      blockingReasons,
      readyForApproval:
        blockingReasons.length === 0 &&
        unresolvedItems.every((item) => !item.blocking),
      briefChecksum: checksumPersistedDocument(canonicalRequirements),
    };
    return BriefDraftSchema.parse(normalizedDraft);
  } catch (error) {
    throw new AiProviderError("AI_OUTPUT_INVALID", "Provider output could not be mapped to the Lead draft contract.", undefined, { ...providerDiagnostic, stage: "provider_normalization", outputStage: "HOST_MAPPING_FAILED", requestAttempted: providerDiagnostic?.requestAttempted ?? true, apiResponseReceived: providerDiagnostic?.apiResponseReceived ?? true, responseReceived: providerDiagnostic?.responseReceived ?? true, outputComplete: providerDiagnostic?.outputComplete ?? true, schemaName: providerDiagnostic?.schemaName ?? "brief-draft", issueCode: zodIssueCode(error), fieldPath: zodIssuePaths(error)?.[0], issueCount: zodIssueCount(error), domainValidationIssuePaths: zodIssuePaths(error) });
  }
}

const StrictTraceabilitySchema = TraceabilitySchema.omit({ decisionId: true }).extend({
  unresolvedDependency: z.string().nullable(),
});
const StrictRouteSchema = z
  .object({
    id: NonEmptyStringSchema,
    requirementReferences: z.array(NonEmptyStringSchema).min(1),
    path: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
    titlePurpose: NonEmptyStringSchema,
    pageType: z.enum([
      "landing",
      "content",
      "form",
      "dashboard",
      "auth",
      "legal",
      "application",
    ]),
    visibility: z.enum(["public", "protected"]),
    intendedUser: NonEmptyStringSchema,
    primaryGoal: NonEmptyStringSchema,
    primaryCta: NonEmptyStringSchema.nullable(),
    contentResponsibilities: z.array(NonEmptyStringSchema),
    dataDependencies: z.array(NonEmptyStringSchema),
    formDependencies: z.array(NonEmptyStringSchema),
    authRequired: z.boolean(),
    seoRelevant: z.boolean(),
    parentId: NonEmptyStringSchema.nullable(),
    navigationVisible: z.boolean(),
  })
  .strict();
const StrictStepSchema = z
  .object({
    order: z.number().int().positive(),
    description: NonEmptyStringSchema,
    routeId: NonEmptyStringSchema.nullable(),
    decision: NonEmptyStringSchema.nullable(),
  })
  .strict();
const StrictFlowSchema = z
  .object({
    id: NonEmptyStringSchema,
    requirementReferences: z.array(NonEmptyStringSchema).min(1),
    actor: NonEmptyStringSchema,
    trigger: NonEmptyStringSchema,
    startRoute: NonEmptyStringSchema,
    steps: z.array(StrictStepSchema),
    dataCreated: z.array(NonEmptyStringSchema),
    dataRead: z.array(NonEmptyStringSchema),
    dataUpdated: z.array(NonEmptyStringSchema),
    successOutcome: NonEmptyStringSchema,
    failureOutcomes: z.array(NonEmptyStringSchema),
    authorizationRequirements: z.array(NonEmptyStringSchema),
    formRequirements: z.array(NonEmptyStringSchema),
    emailRequirements: z.array(NonEmptyStringSchema),
    storageRequirements: z.array(NonEmptyStringSchema),
    acceptanceCriteria: z.array(NonEmptyStringSchema),
  })
  .strict();
const StrictArchitectureSchema = z
  .object({
    ...withoutProjectIdentityAndAcceptance(TechnicalArchitectureSchema.shape),
    backendPriority: z
      .array(z.enum(["server-actions", "route-handlers", "supabase-services"]))
      .max(3),
    npmScripts: z.array(
      z
        .object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema })
        .strict(),
    ),
  })
  .strict();
const StrictAssetManifestSchema = z
  .object({
    ...withoutProjectIdentity(AssetManifestSchema.shape),
    entries: z.array(
      z
        .object({
          ...AssetManifestEntrySchema.shape,
          consistencyGroup: NonEmptyStringSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const StrictFormSchema = FormSchema.safeExtend({
  fields: z.array(FormFieldSchema),
});
const StrictFormPlanSchema = z
  .object({
    ...withoutProjectIdentity(FormPlanSchema.shape),
    forms: z.array(StrictFormSchema),
    traceability: z.array(StrictTraceabilitySchema),
  })
  .strict();
export const PlanningPackageStructuredOutputSchema =
  PlanningPackageSchema.omit({ projectId: true, projectVersion: true, semanticChecksumPolicyVersion: true, providerContractVersion: true, approvedBriefChecksum: true, routePolicy: true, accepted: true, acceptance: true }).extend({
    databaseRecommendation: z.object({ recommendation: z.enum(["REQUIRED", "NOT_REQUIRED", "UNCERTAIN"]), rationale: z.string().min(1), requirementReferences: z.array(z.string().min(1)).min(1), userDecisionRequired: z.literal(true), selectedMode: z.enum(["NONE", "SUPABASE_NEW", "SUPABASE_EXISTING"]).nullable() }).strict().nullable(),
    productScope: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.productScope.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    sitemap: z.object({
      ...withoutProjectIdentity(SitemapPlanSchema.shape),
      routes: z.array(StrictRouteSchema),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    navigation: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.navigation.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    pages: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.pages.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    userFlows: z.object({
      ...withoutProjectIdentity(UserFlowPlanSchema.shape),
      flows: z.array(StrictFlowSchema),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    forms: StrictFormPlanSchema,
    dataModel: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.dataModel.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    authentication: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.authentication.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    supabase: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.supabase.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    email: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.email.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    storage: z.object({
      ...withoutProjectIdentity(StoragePlanSchema.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    administration: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.administration.shape),
      traceability: z.array(StrictTraceabilitySchema),
    }).strict(),
    content: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.content.shape),
    }).strict(),
    assets: StrictAssetManifestSchema,
    architecture: StrictArchitectureSchema,
    environment: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.environment.shape),
    }).strict(),
    dependencies: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.dependencies.shape),
    }).strict(),
    testStrategy: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.testStrategy.shape),
    }).strict(),
    security: z.object({
      ...withoutProjectIdentity(PlanningPackageSchema.shape.security.shape),
    }).strict(),
    traceability: z.array(StrictTraceabilitySchema),
  });

/**
 * Current Planning provider protocol v4.  The model receives and returns only
 * host-issued short tokens; canonical IDs are never transport identities.
 * Dynamic token enums were intentionally not used: exact host lookup below is
 * the shared deterministic authority that preserves stable semantic failure
 * codes for malformed, stale, or hallucinated tokens.
 */
export class PlannerReferenceBindingError extends Error {
  constructor(readonly code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" | "PLANNING_REQUIREMENT_COVERAGE_MISSING" | "PLANNING_REQUIREMENT_COVERAGE_DUPLICATE" | "PLANNING_REQUIREMENT_COVERAGE_INVALID" | "PLANNING_ROUTE_POLICY_MISMATCH", readonly fieldPath: string) {
    super(`${code}:${fieldPath}`);
    this.name = "PlannerReferenceBindingError";
  }
}

const TokenRequirementReferencesSchema = z.array(PlannerRequirementToken).min(1).max(64);
const StrictTokenTraceabilitySchema = StrictTraceabilitySchema.extend({
  requirementReferences: TokenRequirementReferencesSchema,
});
const StrictTokenRouteSchema = StrictRouteSchema.omit({ id: true, path: true, parentId: true, requirementReferences: true }).extend({
  routeToken: PlannerRouteToken,
  pageToken: PlannerPageToken,
  requirementReferences: TokenRequirementReferencesSchema,
}).strict();
const StrictTokenPageSchema = PlanningPackageStructuredOutputSchema.shape.pages.shape.pages.element
  .omit({ id: true, routeId: true, requirementReferences: true })
  .extend({
    pageToken: PlannerPageToken,
    routeToken: PlannerRouteToken,
    requirementReferences: TokenRequirementReferencesSchema,
  }).strict();
const StrictTokenStepSchema = StrictStepSchema.omit({ routeId: true }).extend({
  routeToken: PlannerRouteToken.nullable(),
}).strict();
const StrictTokenFlowSchema = StrictFlowSchema.omit({ startRoute: true, requirementReferences: true }).extend({
  startRouteToken: PlannerRouteToken,
  steps: z.array(StrictTokenStepSchema),
  requirementReferences: TokenRequirementReferencesSchema,
}).strict();
const tokenFormShape = Object.fromEntries(Object.entries(FormSchema.shape).filter(([key]) => key !== "route" && key !== "requirementReferences")) as Omit<typeof FormSchema.shape, "route" | "requirementReferences">;
const StrictTokenFormSchema = z.object({
  ...tokenFormShape,
  routeToken: PlannerRouteToken,
  requirementReferences: TokenRequirementReferencesSchema,
}).strict();
const StrictTokenArchitectureSchema = z.object({
  ...withoutProviderDocumentMetadataAndAcceptance(TechnicalArchitectureSchema.shape),
  backendPriority: z.array(z.enum(["server-actions", "route-handlers", "supabase-services"])).max(3),
  npmScripts: z.array(z.object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema }).strict()),
  routes: z.array(z.object({ routeToken: PlannerRouteToken, responsibility: NonEmptyStringSchema }).strict()),
}).strict();
const StrictTokenProfileSchema = PlanningPackageStructuredOutputSchema.shape.profile.extend({
  requirementReferences: TokenRequirementReferencesSchema,
}).strict();
const StrictTokenProductScopeSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.productScope.shape),
  acceptanceMapping: z.array(PlanningPackageStructuredOutputSchema.shape.productScope.shape.acceptanceMapping.element.extend({ requirementReferences: TokenRequirementReferencesSchema }).strict()),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenDataModelSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.dataModel.shape),
  entities: z.array(PlanningPackageStructuredOutputSchema.shape.dataModel.shape.entities.element.extend({ requirementReferences: TokenRequirementReferencesSchema }).strict()),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenAuthenticationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.authentication.shape),
  protectedRoutes: z.array(PlannerRouteToken),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenSupabaseSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.supabase.shape),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenEnvironmentSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.environment.shape),
  variables: z.array(PlanningPackageStructuredOutputSchema.shape.environment.shape.variables.element.extend({ requirementReferences: TokenRequirementReferencesSchema }).strict()),
}).strict();
const StrictTokenDependencySchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.dependencies.shape),
  dependencies: z.array(PlanningPackageStructuredOutputSchema.shape.dependencies.shape.dependencies.element.extend({ requirementReferences: TokenRequirementReferencesSchema }).strict()),
}).strict();
const StrictTokenSecuritySchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.security.shape),
  controls: z.array(PlanningPackageStructuredOutputSchema.shape.security.shape.controls.element.extend({ requirementReferences: TokenRequirementReferencesSchema }).strict()),
}).strict();
const StrictTokenDatabaseRecommendationSchema = z.object({
  recommendation: z.enum(["REQUIRED", "NOT_REQUIRED", "UNCERTAIN"]),
  rationale: z.string().min(1),
  requirementReferences: TokenRequirementReferencesSchema,
  userDecisionRequired: z.literal(true),
  selectedMode: z.enum(["NONE", "SUPABASE_NEW", "SUPABASE_EXISTING"]).nullable(),
}).strict().nullable();
const StrictTokenSitemapSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.sitemap.shape),
  routes: z.array(StrictTokenRouteSchema),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenNavigationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.navigation.shape),
  primary: z.array(PlannerRouteToken),
  secondary: z.array(PlannerRouteToken),
  footer: z.array(PlannerRouteToken),
  contextual: z.array(PlannerRouteToken),
  protected: z.array(PlannerRouteToken),
  routeReferences: z.array(PlannerRouteToken).min(1),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenPagesSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.pages.shape),
  pages: z.array(StrictTokenPageSchema),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenUserFlowsSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.userFlows.shape),
  flows: z.array(StrictTokenFlowSchema),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenFormsSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.forms.shape),
  forms: z.array(StrictTokenFormSchema),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenEmailSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.email.shape),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenStorageSchema = z.object({
  ...withoutProviderDocumentMetadata(StoragePlanSchema.shape),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenAdministrationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.administration.shape),
  protectedRoutes: z.array(PlannerRouteToken),
  traceability: z.array(StrictTokenTraceabilitySchema),
}).strict();
const StrictTokenContentSchema = z.object({ ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.content.shape) }).strict();
const StrictTokenAssetManifestSchema = z.object({
  ...withoutProviderDocumentMetadata(AssetManifestSchema.shape),
  entries: z.array(z.object({ ...AssetManifestEntrySchema.shape, consistencyGroup: NonEmptyStringSchema.nullable() }).strict()),
}).strict();
const StrictTokenTestStrategySchema = z.object({ ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.testStrategy.shape) }).strict();
export const PlannerRequirementCoverageValueSchema = z.object({
  planningElementIds: z.array(NonEmptyStringSchema).min(1).max(32),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();

function createMandatoryPlannerCoverageSchema(table: PlannerReferenceTable) {
  const shape: Record<string, typeof PlannerRequirementCoverageValueSchema> = {};
  for (const entry of table.requirements.filter((candidate) => candidate.mandatory)) shape[entry.token] = PlannerRequirementCoverageValueSchema;
  return z.object(shape).strict();
}

export function createTokenizedPlanningProviderWireSchema(referenceTable: PlannerReferenceTable) {
  const table = PlannerReferenceTableSchema.parse(referenceTable);
  return PlanningPackageStructuredOutputSchema.omit({ createdAt: true, updatedAt: true }).extend({
    coverageByRequirement: createMandatoryPlannerCoverageSchema(table),
    profile: StrictTokenProfileSchema,
    databaseRecommendation: StrictTokenDatabaseRecommendationSchema,
    productScope: StrictTokenProductScopeSchema,
    sitemap: StrictTokenSitemapSchema,
    navigation: StrictTokenNavigationSchema,
    pages: StrictTokenPagesSchema,
    userFlows: StrictTokenUserFlowsSchema,
    forms: StrictTokenFormsSchema,
    dataModel: StrictTokenDataModelSchema,
    authentication: StrictTokenAuthenticationSchema,
    supabase: StrictTokenSupabaseSchema,
    email: StrictTokenEmailSchema,
    storage: StrictTokenStorageSchema,
    administration: StrictTokenAdministrationSchema,
    content: StrictTokenContentSchema,
    assets: StrictTokenAssetManifestSchema,
    environment: StrictTokenEnvironmentSchema,
    dependencies: StrictTokenDependencySchema,
    testStrategy: StrictTokenTestStrategySchema,
    security: StrictTokenSecuritySchema,
    architecture: StrictTokenArchitectureSchema,
    traceability: z.array(StrictTokenTraceabilitySchema),
  }).strict();
}
export const TokenizedPlanningPackageStructuredOutputSchema = createTokenizedPlanningProviderWireSchema;
export type TokenizedPlanningProviderWire = z.infer<ReturnType<typeof createTokenizedPlanningProviderWireSchema>>;

function bindPlannerRequirementReferences(value: unknown, requirements: ReadonlyMap<string, string>, fieldPath = "$"): unknown {
  if (Array.isArray(value)) return value.map((child, index) => bindPlannerRequirementReferences(child, requirements, `${fieldPath}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (key !== "requirementReferences" || !Array.isArray(child)) return [key, bindPlannerRequirementReferences(child, requirements, `${fieldPath}.${key}`)];
    return [key, child.map((reference, index) => {
      if (typeof reference !== "string" || !requirements.has(reference))
        throw new PlannerReferenceBindingError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", `${fieldPath}.${key}[${index}]`);
      return requirements.get(reference)!;
    })];
  }));
}

function requirePlannerRoute(routes: ReadonlyMap<string, PlannerReferenceTable["routes"][number]>, token: string, fieldPath: string) {
  const route = routes.get(token);
  if (!route) throw new PlannerReferenceBindingError("PLANNING_ROUTE_POLICY_MISMATCH", fieldPath);
  return route;
}

function requirePlannerPage(pages: ReadonlyMap<string, PlannerReferenceTable["pages"][number]>, token: string, fieldPath: string) {
  const page = pages.get(token);
  if (!page) throw new PlannerReferenceBindingError("PLANNING_ROUTE_POLICY_MISMATCH", fieldPath);
  return page;
}

const PLANNING_ELEMENT_SECTION_IDS = [
  "profile", "productScope", "sitemap", "navigation", "pages", "userFlows", "forms", "dataModel", "authentication", "supabase", "email", "storage", "administration", "content", "assets", "architecture", "environment", "dependencies", "testStrategy", "security", "traceability",
] as const;

const PLANNER_COVERAGE_SECTIONS_BY_CATEGORY: Partial<Record<RequirementCategory, readonly string[]>> = {
  ACCEPTANCE: ["productScope", "testStrategy", "traceability"],
  ADMINISTRATION: ["administration", "authentication", "pages"],
  AUDIENCE: ["profile", "productScope", "pages"],
  BACKEND: ["architecture", "dataModel", "supabase"],
  BUSINESS_GOAL: ["profile", "productScope"],
  CONTENT: ["content", "pages"],
  DATABASE: ["dataModel", "supabase", "architecture"],
  DECISION: ["productScope", "architecture", "traceability"],
  DEFERRED_INTEGRATION: ["dependencies", "email", "storage", "supabase"],
  EXCLUSION: ["productScope", "architecture", "security"],
  FEATURE: ["productScope", "pages", "userFlows", "forms", "dataModel", "architecture"],
  FORM: ["forms", "pages", "userFlows"],
  FORM_INTERACTION: ["forms", "userFlows", "pages"],
  LEGAL_CONSTRAINT: ["productScope", "security", "testStrategy"],
  PROHIBITED: ["security", "architecture", "productScope"],
  SEO: ["sitemap", "pages", "content"],
  TECHNICAL: ["architecture", "environment", "dependencies", "testStrategy", "security"],
  USER_ROLE: ["authentication", "administration", "profile"],
  UX_RESPONSIVE: ["pages", "navigation"],
};
const PLANNER_ROUTE_PAGE_CATEGORIES = new Set<RequirementCategory>(["ACCEPTANCE", "ADMINISTRATION", "AUDIENCE", "CONTENT", "FEATURE", "FORM", "FORM_INTERACTION", "SEO", "USER_ROLE", "UX_RESPONSIVE"]);
const PLANNER_PLACEHOLDER_SEMANTIC_EVIDENCE = new Set(["covered", "implemented", "handled", "see plan", "same as requirement"]);

function normalizedPlannerCoverageEvidence(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ");
}

function planningElementIds(value: unknown) {
  const ids = new Set<string>(PLANNING_ELEMENT_SECTION_IDS);
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child)); return; }
    if (!node || typeof node !== "object") return;
    for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
      if (["id", "routeToken", "pageToken"].includes(childKey) && typeof child === "string") ids.add(child);
      visit(child);
    }
  };
  visit(value);
  return ids;
}

function validatePlannerRequirementCoverage(value: unknown, table: PlannerReferenceTable, providerValue: unknown) {
  const coverage = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const requirements = new Map(table.requirements.map((entry) => [entry.token, entry]));
  const required = table.requirements.filter((entry) => entry.mandatory);
  const candidateElementIds = planningElementIds(providerValue);
  const hasCompatiblePlanningElement = (entry: PlannerReferenceTable["requirements"][number], ids: readonly string[]) => {
    const sections = PLANNER_COVERAGE_SECTIONS_BY_CATEGORY[entry.category] ?? ["traceability"];
    return ids.some((id) => sections.includes(id) || (PLANNER_ROUTE_PAGE_CATEGORIES.has(entry.category) && /^(?:PAGE|ROUTE)_\d{3,}$/.test(id)));
  };
  if (!coverage) throw new PlannerReferenceBindingError("PLANNING_REQUIREMENT_COVERAGE_INVALID", "coverageByRequirement");
  for (const token of Object.keys(coverage)) {
    const entry = requirements.get(token);
    if (!entry || !entry.mandatory) throw new PlannerReferenceBindingError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", `coverageByRequirement.${token}`);
  }
  for (const entry of required) {
    if (!Object.prototype.hasOwnProperty.call(coverage, entry.token)) throw new PlannerReferenceBindingError("PLANNING_REQUIREMENT_COVERAGE_MISSING", entry.token);
    const parsed = PlannerRequirementCoverageValueSchema.safeParse(coverage[entry.token]);
    if (!parsed.success || parsed.data.planningElementIds.some((id) => !candidateElementIds.has(id)) || !hasCompatiblePlanningElement(entry, parsed.success ? parsed.data.planningElementIds : []) || (parsed.success && PLANNER_PLACEHOLDER_SEMANTIC_EVIDENCE.has(normalizedPlannerCoverageEvidence(parsed.data.semanticEvidence))))
      throw new PlannerReferenceBindingError("PLANNING_REQUIREMENT_COVERAGE_INVALID", `coverageByRequirement.${entry.token}`);
  }
  return coverage;
}

export function normalizeTokenizedPlanningPackage(
  value: TokenizedPlanningProviderWire,
  host: { projectId: string; projectVersion: number; approvedBriefChecksum: string },
  approvedBrief: PlannerBriefNormalizationInput,
  table: PlannerReferenceTable,
): PlanningPackage {
  validatePlannerRequirementCoverage(value.coverageByRequirement, table, value);
  const requirements = new Map(table.requirements.map((entry) => [entry.token, entry.canonicalRequirementId]));
  const routes = new Map(table.routes.map((entry) => [entry.token, entry]));
  const pages = new Map(table.pages.map((entry) => [entry.token, entry]));
  const expectedRouteTokens = new Set(table.routes.map((entry) => entry.token));
  const expectedPageTokens = new Set(table.pages.map((entry) => entry.token));
  const bound = bindPlannerRequirementReferences(value, requirements) as TokenizedPlanningProviderWire;
  const unique = (tokens: readonly string[], expected: ReadonlySet<string>, fieldPath: string) => {
    if (tokens.length !== expected.size || new Set(tokens).size !== tokens.length || tokens.some((token) => !expected.has(token)))
      throw new PlannerReferenceBindingError("PLANNING_ROUTE_POLICY_MISMATCH", fieldPath);
  };
  unique(bound.sitemap.routes.map((route) => route.routeToken), expectedRouteTokens, "sitemap.routes");
  unique(bound.pages.pages.map((page) => page.pageToken), expectedPageTokens, "pages.pages");
  const normalizedRoutes = bound.sitemap.routes.map((route, index) => {
    const hostRoute = requirePlannerRoute(routes, route.routeToken, `sitemap.routes[${index}].routeToken`);
    if (route.pageToken !== hostRoute.pageToken) throw new PlannerReferenceBindingError("PLANNING_ROUTE_POLICY_MISMATCH", `sitemap.routes[${index}].pageToken`);
    const fields = Object.fromEntries(Object.entries(route).filter(([key]) => key !== "routeToken" && key !== "pageToken"));
    const parentRoute = hostRoute.parentPageId === null
      ? undefined
      : [...routes.values()].find((candidate) => candidate.canonicalPageId === hostRoute.parentPageId);
    return { ...fields, id: hostRoute.canonicalRouteId, path: hostRoute.path, ...(parentRoute ? { parentId: parentRoute.canonicalRouteId } : {}) };
  });
  const normalizedPages = bound.pages.pages.map((page, index) => {
    const hostPage = requirePlannerPage(pages, page.pageToken, `pages.pages[${index}].pageToken`);
    const hostRoute = requirePlannerRoute(routes, page.routeToken, `pages.pages[${index}].routeToken`);
    if (hostRoute.pageToken !== hostPage.token) throw new PlannerReferenceBindingError("PLANNING_ROUTE_POLICY_MISMATCH", `pages.pages[${index}]`);
    const fields = Object.fromEntries(Object.entries(page).filter(([key]) => key !== "pageToken" && key !== "routeToken"));
    return { ...fields, id: hostPage.planningPageId, routeId: hostRoute.canonicalRouteId };
  });
  const bindRouteTokens = (tokens: readonly string[], fieldPath: string) => tokens.map((routeToken, index) => requirePlannerRoute(routes, routeToken, `${fieldPath}[${index}]`).canonicalRouteId);
  const normalized = injectRecoveryHostMetadata({
    ...bound,
    sitemap: { ...bound.sitemap, routes: normalizedRoutes },
    navigation: { ...bound.navigation, primary: bindRouteTokens(bound.navigation.primary, "navigation.primary"), secondary: bindRouteTokens(bound.navigation.secondary, "navigation.secondary"), footer: bindRouteTokens(bound.navigation.footer, "navigation.footer"), contextual: bindRouteTokens(bound.navigation.contextual, "navigation.contextual"), protected: bindRouteTokens(bound.navigation.protected, "navigation.protected"), routeReferences: bindRouteTokens(bound.navigation.routeReferences, "navigation.routeReferences") },
    pages: { ...bound.pages, pages: normalizedPages },
    userFlows: { ...bound.userFlows, flows: bound.userFlows.flows.map((flow, flowIndex) => { const { startRouteToken, ...fields } = flow; return { ...fields, startRoute: requirePlannerRoute(routes, startRouteToken, `userFlows.flows[${flowIndex}].startRouteToken`).path, steps: flow.steps.map((step, stepIndex) => { const { routeToken, ...stepFields } = step; return { ...stepFields, routeId: routeToken === null ? null : requirePlannerRoute(routes, routeToken, `userFlows.flows[${flowIndex}].steps[${stepIndex}].routeToken`).canonicalRouteId }; }) }; }) },
    forms: { ...bound.forms, forms: bound.forms.forms.map((form, index) => { const { routeToken, ...fields } = form; return { ...fields, route: requirePlannerRoute(routes, routeToken, `forms.forms[${index}].routeToken`).path }; }) },
    authentication: { ...bound.authentication, protectedRoutes: bindRouteTokens(bound.authentication.protectedRoutes, "authentication.protectedRoutes") },
    administration: { ...bound.administration, protectedRoutes: bindRouteTokens(bound.administration.protectedRoutes, "administration.protectedRoutes") },
    architecture: { ...bound.architecture, routes: bound.architecture.routes.map((route, index) => ({ responsibility: route.responsibility, path: requirePlannerRoute(routes, route.routeToken, `architecture.routes[${index}].routeToken`).path })) },
  }, new Date().toISOString()) as z.infer<typeof PlanningPackageStructuredOutputSchema>;
  const { coverageByRequirement, ...packageValue } = normalized as typeof normalized & { coverageByRequirement?: unknown };
  void coverageByRequirement;
  return PlanningPackageSchema.parse({ ...normalizePlanningPackage(packageValue, host, approvedBrief), providerContractVersion: PLANNER_PROVIDER_CONTRACT_VERSION });
}

// Recovery references are transport handles, never canonical identities. The
// host binds these exact opaque handles before the internal package contract
// validates canonical V3 requirement references.
const RecoveryRequirementHandleOutputSchema = z.string().regex(/^planning-requirement:R\d{3}$/);
const RecoveryRequirementReferencesSchema = z.array(RecoveryRequirementHandleOutputSchema).min(1);
const RecoveryRouteHandleOutputSchema = z.string().regex(/^planning-route:[A-Za-z0-9_.:-]{1,180}$/);
const RecoveryPageHandleOutputSchema = z.string().regex(/^planning-page:[A-Za-z0-9_.:-]{1,180}$/);
const StrictRecoveryTraceabilitySchema = StrictTraceabilitySchema.extend({
  requirementReferences: RecoveryRequirementReferencesSchema,
});
const StrictRecoveryRouteSchema = StrictRouteSchema.omit({ id: true, requirementReferences: true, parentId: true }).extend({
  routeHandle: RecoveryRouteHandleOutputSchema,
  pageHandle: RecoveryPageHandleOutputSchema,
  parentPageHandle: RecoveryPageHandleOutputSchema.nullable(),
  requirementReferences: RecoveryRequirementReferencesSchema,
}).strict();
const StrictRecoveryPageSchema = PlanningPackageStructuredOutputSchema.shape.pages.shape.pages.element
  .omit({ id: true, routeId: true, requirementReferences: true })
  .extend({
    pageHandle: RecoveryPageHandleOutputSchema,
    routeHandle: RecoveryRouteHandleOutputSchema,
    requirementReferences: RecoveryRequirementReferencesSchema,
  }).strict();
const StrictRecoveryStepSchema = StrictStepSchema.omit({ routeId: true }).extend({
  routeHandle: RecoveryRouteHandleOutputSchema.nullable(),
}).strict();
const StrictRecoveryFlowSchema = StrictFlowSchema.omit({ startRoute: true, requirementReferences: true }).extend({
  startRouteHandle: RecoveryRouteHandleOutputSchema,
  steps: z.array(StrictRecoveryStepSchema),
  requirementReferences: RecoveryRequirementReferencesSchema,
}).strict();
const recoveryFormShape = Object.fromEntries(Object.entries(FormSchema.shape).filter(([key]) => key !== "route" && key !== "requirementReferences")) as Omit<typeof FormSchema.shape, "route" | "requirementReferences">;
const StrictRecoveryFormSchema = z.object({
  ...recoveryFormShape,
  routeHandle: RecoveryRouteHandleOutputSchema,
  requirementReferences: RecoveryRequirementReferencesSchema,
}).strict();
const StrictRecoveryArchitectureSchema = z.object({
  ...withoutProviderDocumentMetadataAndAcceptance(TechnicalArchitectureSchema.shape),
  backendPriority: z
    .array(z.enum(["server-actions", "route-handlers", "supabase-services"]))
    .max(3),
  npmScripts: z.array(
    z
      .object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema })
      .strict(),
  ),
  routes: z.array(z.object({ routeHandle: RecoveryRouteHandleOutputSchema, responsibility: NonEmptyStringSchema }).strict()),
}).strict();
const StrictRecoveryProfileSchema = PlanningPackageStructuredOutputSchema.shape.profile.extend({
  requirementReferences: RecoveryRequirementReferencesSchema,
}).strict();
const StrictRecoveryProductScopeSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.productScope.shape),
  acceptanceMapping: z.array(PlanningPackageStructuredOutputSchema.shape.productScope.shape.acceptanceMapping.element.extend({ requirementReferences: RecoveryRequirementReferencesSchema }).strict()),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryDataModelSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.dataModel.shape),
  entities: z.array(PlanningPackageStructuredOutputSchema.shape.dataModel.shape.entities.element.extend({ requirementReferences: RecoveryRequirementReferencesSchema }).strict()),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryAuthenticationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.authentication.shape),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoverySupabaseSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.supabase.shape),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryEnvironmentSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.environment.shape),
  variables: z.array(PlanningPackageStructuredOutputSchema.shape.environment.shape.variables.element.extend({ requirementReferences: RecoveryRequirementReferencesSchema }).strict()),
}).strict();
const StrictRecoveryDependencySchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.dependencies.shape),
  dependencies: z.array(PlanningPackageStructuredOutputSchema.shape.dependencies.shape.dependencies.element.extend({ requirementReferences: RecoveryRequirementReferencesSchema }).strict()),
}).strict();
const StrictRecoverySecuritySchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.security.shape),
  controls: z.array(PlanningPackageStructuredOutputSchema.shape.security.shape.controls.element.extend({ requirementReferences: RecoveryRequirementReferencesSchema }).strict()),
}).strict();
const StrictRecoveryDatabaseRecommendationSchema = z.object({
  recommendation: z.enum(["REQUIRED", "NOT_REQUIRED", "UNCERTAIN"]),
  rationale: z.string().min(1),
  requirementReferences: RecoveryRequirementReferencesSchema,
  userDecisionRequired: z.literal(true),
  selectedMode: z.enum(["NONE", "SUPABASE_NEW", "SUPABASE_EXISTING"]).nullable(),
}).strict().nullable();
const StrictRecoverySitemapSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.sitemap.shape),
  routes: z.array(StrictRecoveryRouteSchema),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryNavigationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.navigation.shape),
  primary: z.array(RecoveryRouteHandleOutputSchema),
  secondary: z.array(RecoveryRouteHandleOutputSchema),
  footer: z.array(RecoveryRouteHandleOutputSchema),
  contextual: z.array(RecoveryRouteHandleOutputSchema),
  protected: z.array(RecoveryRouteHandleOutputSchema),
  routeReferences: z.array(RecoveryRouteHandleOutputSchema).min(1),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryPagesSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.pages.shape),
  pages: z.array(StrictRecoveryPageSchema),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryUserFlowsSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.userFlows.shape),
  flows: z.array(StrictRecoveryFlowSchema),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryFormsSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.forms.shape),
  forms: z.array(StrictRecoveryFormSchema),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryEmailSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.email.shape),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryStorageSchema = z.object({
  ...withoutProviderDocumentMetadata(StoragePlanSchema.shape),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryAdministrationSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.administration.shape),
  traceability: z.array(StrictRecoveryTraceabilitySchema),
}).strict();
const StrictRecoveryContentSchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.content.shape),
}).strict();
const StrictRecoveryAssetManifestSchema = z.object({
  ...withoutProviderDocumentMetadata(AssetManifestSchema.shape),
  entries: z.array(
    z.object({
      ...AssetManifestEntrySchema.shape,
      consistencyGroup: NonEmptyStringSchema.nullable(),
    }).strict(),
  ),
}).strict();
const StrictRecoveryTestStrategySchema = z.object({
  ...withoutProviderDocumentMetadata(PlanningPackageStructuredOutputSchema.shape.testStrategy.shape),
}).strict();

/** Recovery-only provider DTO. The keyed accounting shape is generated from the host manifest. */
export function createPlanningRecoveryProviderWireSchema(manifest: Pick<PlanningOwnedRequirementManifest, "requirements">) {
  return PlanningPackageStructuredOutputSchema.omit({ createdAt: true, updatedAt: true }).extend({
    requirementAccounting: createPlanningRecoverySemanticAccountingSchema(manifest),
    profile: StrictRecoveryProfileSchema,
    databaseRecommendation: StrictRecoveryDatabaseRecommendationSchema,
    productScope: StrictRecoveryProductScopeSchema,
    sitemap: StrictRecoverySitemapSchema,
    navigation: StrictRecoveryNavigationSchema,
    pages: StrictRecoveryPagesSchema,
    userFlows: StrictRecoveryUserFlowsSchema,
    forms: StrictRecoveryFormsSchema,
    dataModel: StrictRecoveryDataModelSchema,
    authentication: StrictRecoveryAuthenticationSchema,
    supabase: StrictRecoverySupabaseSchema,
    email: StrictRecoveryEmailSchema,
    storage: StrictRecoveryStorageSchema,
    administration: StrictRecoveryAdministrationSchema,
    content: StrictRecoveryContentSchema,
    assets: StrictRecoveryAssetManifestSchema,
    environment: StrictRecoveryEnvironmentSchema,
    dependencies: StrictRecoveryDependencySchema,
    testStrategy: StrictRecoveryTestStrategySchema,
    security: StrictRecoverySecuritySchema,
    architecture: StrictRecoveryArchitectureSchema,
    traceability: z.array(StrictRecoveryTraceabilitySchema),
  }).strict();
}

/** Shared definitions keep the repeated keyed accounting values out of the provider wire schema. */
export const PlanningRecoveryProviderSchemaDefinitions: Record<string, StructuredSchemaDefinition> = {
  PlanningRecoveryAccountingEntry: PlanningRecoverySemanticAccountingEntrySchema,
  PlanningRequirementDisposition: PlanningRequirementDispositionSchema,
  PlanningTargetHandleRef: PlanningTargetHandleRefSchema,
};

/** Named factory exports retain the registered contract vocabulary without a static cardinality. */
export const PlanningRecoveryProviderWireSchema = createPlanningRecoveryProviderWireSchema;
export const PlanningRecoveryPackageStructuredOutputSchema = createPlanningRecoveryProviderWireSchema;
export type PlanningRecoveryProviderWire = z.infer<ReturnType<typeof createPlanningRecoveryProviderWireSchema>>;
type PlanningRecoveryProviderPackage = PlanningRecoveryProviderWire;

function omitRecoveryFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}

function recoveryBindingFailure(issueCode: string, fieldPath: string): never {
  throw new AiProviderError(
    "AI_OUTPUT_INVALID",
    "Provider recovery output could not be bound to the host-issued Planning manifests.",
    undefined,
    {
      stage: "provider_normalization",
      outputStage: "HOST_MAPPING_FAILED",
      requestAttempted: true,
      apiResponseReceived: true,
      responseReceived: true,
      outputComplete: true,
      schemaName: "planning-recovery-package",
      issueCode,
      fieldPath,
      issueCount: 1,
    },
  );
}

function bindRecoveryRouteHandle(
  handle: string,
  routesByHandle: ReadonlyMap<string, CanonicalPlanningRouteManifest["routes"][number]>,
  fieldPath: string,
) {
  const route = routesByHandle.get(handle);
  if (!route) recoveryBindingFailure("UNKNOWN_RECOVERY_ROUTE_HANDLE", fieldPath);
  return route;
}

function bindRecoveryRequirementReferences(value: unknown, requirementsByHandle: ReadonlyMap<string, string>, planningRequirementIds: ReadonlySet<string>, fieldPath = "$"): unknown {
  if (Array.isArray(value)) return value.map((child, index) => bindRecoveryRequirementReferences(child, requirementsByHandle, planningRequirementIds, `${fieldPath}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (key !== "requirementReferences" || !Array.isArray(child)) return [key, bindRecoveryRequirementReferences(child, requirementsByHandle, planningRequirementIds, `${fieldPath}.${key}`)];
    return [key, child.map((reference, index) => {
      if (typeof reference !== "string") recoveryBindingFailure("INVALID_RECOVERY_REQUIREMENT_REFERENCE", `${fieldPath}.${key}[${index}]`);
      const boundId = requirementsByHandle.get(reference);
      if (boundId) return boundId;
      if (planningRequirementIds.has(reference)) recoveryBindingFailure("RECOVERY_PROVIDER_REQUIREMENT_ID_FORBIDDEN", `${fieldPath}.${key}[${index}]`);
      return reference;
    })];
  }));
}

function injectRecoveryHostMetadata(value: unknown, timestamp: string): unknown {
  if (Array.isArray(value)) return value.map((child) => injectRecoveryHostMetadata(child, timestamp));
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, injectRecoveryHostMetadata(child, timestamp)]));
  if (typeof result.documentType === "string") {
    result.createdAt = timestamp;
    result.updatedAt = timestamp;
  }
  return result;
}

function normalizeRecoveryPlanningPackage(
  value: PlanningRecoveryProviderPackage,
  host: { projectId: string; projectVersion: number; approvedBriefChecksum: string; timestamp: string },
  approvedBrief: PlannerBriefNormalizationInput,
  routeManifest: CanonicalPlanningRouteManifest,
  requirementManifest: PlanningOwnedRequirementManifest,
): PlanningRecoveryProviderResult {
  const requiredRoutes = routeManifest.routes.filter((route) => route.required);
  const routesByHandle = new Map(requiredRoutes.map((route) => [route.routeHandle, route]));
  const routesByPageHandle = new Map(requiredRoutes.map((route) => [route.pageHandle, route]));
  const requirementIds = new Set(requirementManifest.requirements.map((entry) => entry.requirementId));
  const requirementsByHandle = new Map(requirementManifest.requirements.map((entry) => [entry.requirementHandle, entry.requirementId]));
  const routePaths = new Set(requiredRoutes.map((route) => route.path));
  const boundValue = bindRecoveryRequirementReferences(value, requirementsByHandle, requirementIds) as PlanningRecoveryProviderPackage;
  if (boundValue.sitemap.routes.length !== requiredRoutes.length) recoveryBindingFailure("RECOVERY_ROUTE_CARDINALITY", "sitemap.routes");

  const validateRequirementReferences = (input: unknown, fieldPath = "$") => {
    if (Array.isArray(input)) return input.forEach((child, index) => validateRequirementReferences(child, `${fieldPath}[${index}]`));
    if (!input || typeof input !== "object") return;
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      if (key === "requirementReferences" && Array.isArray(child)) {
        for (const [index, reference] of child.entries()) if (typeof reference !== "string" || !requirementIds.has(reference)) recoveryBindingFailure("UNKNOWN_V3_REQUIREMENT_ID", `${fieldPath}.${key}[${index}]`);
      }
      validateRequirementReferences(child, `${fieldPath}.${key}`);
    }
  };
  validateRequirementReferences(boundValue);

  const normalizedRoutes = boundValue.sitemap.routes.map((route, index) => {
    const manifestRoute = bindRecoveryRouteHandle(route.routeHandle, routesByHandle, `sitemap.routes[${index}].routeHandle`);
    if (route.pageHandle !== manifestRoute.pageHandle) recoveryBindingFailure("RECOVERY_ROUTE_PAGE_HANDLE_MISMATCH", `sitemap.routes[${index}].pageHandle`);
    if (route.path !== manifestRoute.path) recoveryBindingFailure("RECOVERY_ROUTE_PATH_MISMATCH", `sitemap.routes[${index}].path`);
    const routeFields = omitRecoveryFields(route, ["routeHandle", "pageHandle", "parentPageHandle"]);
    const parent = route.parentPageHandle === null ? undefined : bindRecoveryRouteHandle(route.parentPageHandle, routesByPageHandle, `sitemap.routes[${index}].parentPageHandle`);
    return { ...routeFields, id: manifestRoute.routeId, path: route.path, parentId: parent?.routeId };
  });
  const normalizedPaths = normalizedRoutes.map((route) => route.path).sort();
  const expectedPaths = [...routePaths].sort();
  if (normalizedPaths.some((path, index) => path !== expectedPaths[index])) recoveryBindingFailure("RECOVERY_ROUTE_SET_MISMATCH", "sitemap.routes");

  if (boundValue.pages.pages.length !== requiredRoutes.length) recoveryBindingFailure("RECOVERY_PAGE_CARDINALITY", "pages.pages");
  const normalizedPages = boundValue.pages.pages.map((page, index) => {
    const manifestRoute = bindRecoveryRouteHandle(page.routeHandle, routesByHandle, `pages.pages[${index}].routeHandle`);
    const manifestPage = routesByPageHandle.get(page.pageHandle);
    if (!manifestPage) recoveryBindingFailure("UNKNOWN_RECOVERY_PAGE_HANDLE", `pages.pages[${index}].pageHandle`);
    if (manifestPage.routeHandle !== manifestRoute.routeHandle) recoveryBindingFailure("RECOVERY_PAGE_ROUTE_HANDLE_MISMATCH", `pages.pages[${index}].routeHandle`);
    const pageFields = omitRecoveryFields(page, ["pageHandle", "routeHandle"]);
    return { ...pageFields, id: manifestPage.planningPageId, routeId: manifestRoute.routeId };
  });

  const normalizeRouteHandles = (handles: readonly string[], fieldPath: string) => handles.map((handle, index) => bindRecoveryRouteHandle(handle, routesByHandle, `${fieldPath}[${index}]`).routeId);
  const normalizedNavigation = {
    ...boundValue.navigation,
    primary: normalizeRouteHandles(boundValue.navigation.primary, "navigation.primary"),
    secondary: normalizeRouteHandles(boundValue.navigation.secondary, "navigation.secondary"),
    footer: normalizeRouteHandles(boundValue.navigation.footer, "navigation.footer"),
    contextual: normalizeRouteHandles(boundValue.navigation.contextual, "navigation.contextual"),
    protected: normalizeRouteHandles(boundValue.navigation.protected, "navigation.protected"),
    routeReferences: normalizeRouteHandles(boundValue.navigation.routeReferences, "navigation.routeReferences"),
  };
  const normalizedFlows = boundValue.userFlows.flows.map((flow, index) => {
    const startRoute = bindRecoveryRouteHandle(flow.startRouteHandle, routesByHandle, `userFlows.flows[${index}].startRouteHandle`);
    const flowFields = omitRecoveryFields(flow, ["startRouteHandle"]);
    return {
      ...flowFields,
      startRoute: startRoute.path,
      steps: flow.steps.map((step, stepIndex) => {
        const stepFields = omitRecoveryFields(step, ["routeHandle"]);
        return { ...stepFields, routeId: step.routeHandle === null ? null : bindRecoveryRouteHandle(step.routeHandle, routesByHandle, `userFlows.flows[${index}].steps[${stepIndex}].routeHandle`).routeId };
      }),
    };
  });
  const normalizedForms = boundValue.forms.forms.map((form, index) => {
    const route = bindRecoveryRouteHandle(form.routeHandle, routesByHandle, `forms.forms[${index}].routeHandle`);
    const formFields = omitRecoveryFields(form, ["routeHandle"]);
    return { ...formFields, route: route.path };
  });
  const normalizedArchitecture = {
    ...boundValue.architecture,
    routes: boundValue.architecture.routes.map((route, index) => ({
      responsibility: route.responsibility,
      path: bindRecoveryRouteHandle(route.routeHandle, routesByHandle, `architecture.routes[${index}].routeHandle`).path,
    })),
  };
  if (normalizedArchitecture.routes.length !== requiredRoutes.length || normalizedArchitecture.routes.map((route) => route.path).sort().some((path, index) => path !== expectedPaths[index])) recoveryBindingFailure("RECOVERY_ARCHITECTURE_ROUTE_SET_MISMATCH", "architecture.routes");
  for (const form of normalizedForms) if (!routePaths.has(form.route)) recoveryBindingFailure("RECOVERY_FORM_ROUTE_MISMATCH", "forms.forms.route");

  const { requirementAccounting, ...planningPackageValue } = boundValue;
  const normalized = injectRecoveryHostMetadata({
    ...planningPackageValue,
    profile: boundValue.profile,
    productScope: boundValue.productScope,
    sitemap: { ...boundValue.sitemap, routes: normalizedRoutes },
    navigation: normalizedNavigation,
    pages: { ...boundValue.pages, pages: normalizedPages },
    userFlows: { ...boundValue.userFlows, flows: normalizedFlows },
    forms: { ...boundValue.forms, forms: normalizedForms },
    architecture: normalizedArchitecture,
  }, host.timestamp) as z.infer<typeof PlanningPackageStructuredOutputSchema>;
  return { planningPackage: normalizePlanningPackage(normalized, host, approvedBrief), requirementAccounting };
}
function omitNull<T extends Record<string, unknown>>(value: T, keys: string[]) {
  const result = { ...value };
  for (const key of keys) if (result[key] === null) delete result[key];
  return result;
}
const plannerTraceabilityDecisionId = (entry: Record<string, unknown>) => {
  const digest = createHash("sha256").update(`planner-trace:${String(entry.category)}:${JSON.stringify(entry.requirementReferences)}:${String(entry.rationale)}`).digest("hex");
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
};
function stampPlannerTraceability(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stampPlannerTraceability);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, stampPlannerTraceability(child)]));
  if (typeof result.category === "string" && typeof result.rationale === "string" && Array.isArray(result.requirementReferences)) result.decisionId = plannerTraceabilityDecisionId(result);
  return result;
}
export const isPlaceholderImageApprovalBlocker = (text: string) =>
  /(?:image|imagery|placeholder).*(?:approval|approved)|(?:approval|approved).*(?:image|imagery|placeholder)/i.test(
    text,
  );
type PlannerBriefNormalizationInput = {
  imageSourceDecision?: string;
  forms?: unknown[];
  features?: string[];
  formBehaviorRequirements?: RequirementSpecification["formBehaviorRequirements"];
  backendRequirements?: string[];
  supabaseRequirements?: string[];
  emailDecision?: RequirementSpecification["emailDecision"];
  storageDecision?: RequirementSpecification["storageDecision"];
  authenticationDecision?: RequirementSpecification["authenticationDecision"];
  administrationDecision?: RequirementSpecification["administrationDecision"];
  userRoles?: string[];
  protectedFunctionalityRequired?: boolean;
};
function normalizePlanningPackage(
  value: z.infer<typeof PlanningPackageStructuredOutputSchema>,
  host: { projectId: string; projectVersion: number; approvedBriefChecksum: string },
  approvedBrief?: PlannerBriefNormalizationInput,
): PlanningPackage {
  const routeIdsByPath = new Map(
    value.sitemap.routes.flatMap((route) => [
      [route.path, route.id],
      [route.id, route.id],
      [`sitemap.${route.id.replace(/^route-/, "")}`, route.id],
      [route.id.replace(/^route-/, ""), route.id],
    ]),
  );
  const normalizeRouteReferences = (references: string[]) =>
    references.map((reference) => routeIdsByPath.get(reference) ?? reference);
  const normalized = bindProjectIdentity({
    ...value,
    ...(value.databaseRecommendation === null ? { databaseRecommendation: undefined } : {}),
    blockers: value.blockers.filter(
      (blocker) =>
        !/design[- ]direction selection.*(pending|existing design stage|not select|defer)/i.test(
          blocker,
        ),
    ),
    productScope: {
      ...value.productScope,
      traceability: value.productScope.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    sitemap: {
      ...value.sitemap,
      routes: value.sitemap.routes.map((route) =>
        omitNull(route, ["primaryCta", "parentId"]),
      ),
      traceability: value.sitemap.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    navigation: {
      ...value.navigation,
      primary: normalizeRouteReferences(value.navigation.primary),
      secondary: normalizeRouteReferences(value.navigation.secondary),
      footer: normalizeRouteReferences(value.navigation.footer),
      contextual: normalizeRouteReferences(value.navigation.contextual),
      protected: normalizeRouteReferences(value.navigation.protected),
      routeReferences: normalizeRouteReferences(
        value.navigation.routeReferences,
      ),
      traceability: value.navigation.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    pages: {
      ...value.pages,
      traceability: value.pages.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    userFlows: {
      ...value.userFlows,
      flows: value.userFlows.flows.map((flow) => ({
        ...flow,
        steps: flow.steps.map((step) =>
          omitNull(step, ["routeId", "decision"]),
        ),
      })),
      traceability: value.userFlows.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    forms: {
      ...value.forms,
      forms: approvedBrief && isClientOnlyFormBrief(approvedBrief)
        ? value.forms.forms.map((form) => ({
            ...form,
            submissionMechanism: "client-only" as const,
            databaseWrite: "No database write; local client state only.",
            emailBehavior: "No email and no external provider.",
            successState: "Show simulated local success, then reset.",
            rateLimitRequired: false,
            spamProtectionRequired: false,
          }))
        : value.forms.forms,
      traceability: value.forms.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    dataModel: {
      ...value.dataModel,
      traceability: value.dataModel.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    authentication: {
      ...value.authentication,
      traceability: value.authentication.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    supabase: {
      ...value.supabase,
      traceability: value.supabase.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    email: {
      ...value.email,
      traceability: value.email.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    storage: {
      ...value.storage,
      traceability: value.storage.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    administration: {
      ...value.administration,
      traceability: value.administration.traceability.map((entry) =>
        omitNull(entry, ["unresolvedDependency"]),
      ),
    },
    architecture: {
      ...value.architecture,
      acceptance: { accepted: false },
    },
    assets: {
      ...value.assets,
      entries: value.assets.entries.map((entry) =>
        omitNull(entry, ["consistencyGroup"]),
      ),
    },
    traceability: value.traceability.map((entry) =>
      omitNull(entry, ["unresolvedDependency"]),
    ),
  }, host) as unknown as z.infer<typeof PlanningPackageSchema>;
  (normalized as unknown as { blockers: string[] }).blockers =
    value.blockers.filter(
      (blocker) =>
        !(
          /design[- ]direction selection.*(pending|existing design stage|not select|defer)/i.test(
            blocker,
          ) ||
          /design direction (?:is|remains) unselected.*(exactly three|design stage|later user selection)/i.test(
            blocker,
          ) ||
          /design direction has not (?:yet )?been selected.*(design stage|planner|implementation)/i.test(
            blocker,
          ) ||
          /no design direction has been selected.*(design stage|planner|implementation)/i.test(
            blocker,
          ) ||
          /design direction .*must be selected after planner/i.test(blocker) ||
          /user must select one of exactly three.*before implementation.*non-blocking for planning/i.test(
            blocker,
          ) ||
          /after design selection/i.test(blocker) ||
          /specific visual details.*design[- ]stage directions.*non-blocking/i.test(
            blocker,
          ) ||
          /no supplied brand, logo, contact, legal, or operational facts.*unsupported claims/i.test(
            blocker,
          ) ||
          /supplied brand information and logo are missing.*no logo.*brand-specific visual claims/i.test(
            blocker,
          ) ||
          /no final planning-package acceptance checksum.*pending design selection/i.test(
            blocker,
          ) ||
          /design selection is pending.*prepared after planner/i.test(
            blocker,
          ) ||
          /approved brief.*deferring selection.*design directions.*no direction is selected/i.test(
            blocker,
          ) ||
          /planning acceptance has not been recorded/i.test(blocker) ||
          /design.*(?:direction|selection).*(?:pending|defer|not selected|no direction)/i.test(
            blocker,
          ) ||
          (approvedBrief?.imageSourceDecision === "placeholders" &&
            isPlaceholderImageApprovalBlocker(blocker))
        ),
    );
  delete (normalized as unknown as { approvedBriefChecksum?: unknown })
    .approvedBriefChecksum;
  delete (normalized as unknown as { acceptedPlanningChecksum?: unknown })
    .acceptedPlanningChecksum;
  delete (normalized as unknown as { directionSetChecksum?: unknown })
    .directionSetChecksum;
  delete (normalized as unknown as { supersedesSetId?: unknown })
    .supersedesSetId;
  delete (normalized as unknown as { supersededAt?: unknown }).supersededAt;
  (
    normalized as unknown as { approvedBriefChecksum: string }
  ).approvedBriefChecksum = host.approvedBriefChecksum;
  (normalized as unknown as { accepted: boolean }).accepted = false;
  (normalized as unknown as { acceptance: Record<string, never> }).acceptance = {};
  const noBackend = approvedBrief ? isNoBackendBrief(approvedBrief) : false;
  (
    normalized as unknown as {
      architecture: {
        backendPriority: Array<"server-actions" | "route-handlers" | "supabase-services">;
      };
    }
  ).architecture.backendPriority = noBackend ? [] : [
    "server-actions",
    "route-handlers",
    "supabase-services",
  ];
  (
    normalized as unknown as {
      architecture: { npmScripts: Record<string, string> };
    }
  ).architecture.npmScripts = Object.fromEntries(
    value.architecture.npmScripts.map((script) => [
      script.name,
      script.command,
    ]),
  );
  return PlanningPackageSchema.parse(stampPlannerTraceability(normalized));
}
const DESIGN_OPTIONAL_KEYS = [
  "shortName",
  "businessRationale",
  "audienceFit",
  "visualPersonality",
  "gridStrategy",
  "navigationCharacter",
  "cardPolicy",
  "formCharacter",
  "ctaCharacter",
  "logoUsageRules",
  "iconographyDirection",
  "decorativeLanguage",
  "mobileCharacter",
  "contentDensity",
  "whitespaceStrategy",
  "imageSourceDecision",
  "implementationComplexity",
  "suitabilitySummary",
  "prohibitedInterpretations",
  "approvedRequirementReferences",
  "planningReferences",
  "colorRoles",
  "imageArtDirectionDetails",
  "motionDetails",
  "responsiveDetails",
  "genericTemplateRisk",
  "canonicalServiceConflictRefs",
];
function normalizeDesignDirectionSet(
  value: z.infer<typeof DesignDirectionStructuredOutputSchema>,
  host: { projectId: string; projectVersion: number },
  provider: { requestId: string; model: string; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; diagnostic?: ProviderDiagnostic },
): DesignDirectionSet {
  const generatedAt = new Date().toISOString();
  try {
    return DesignDirectionSetSchema.parse({
      schemaVersion: 1,
      documentType: "design-directions",
      projectId: host.projectId,
      projectVersion: host.projectVersion,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      setId: randomUUID(),
      directions: value.directions.map((direction) => ({
        ...omitNull(direction, DESIGN_OPTIONAL_KEYS),
        id: randomUUID(),
      })),
      generatedAt,
      generatedBy: "openai-design-provider",
      readyForSelection: true,
      provider: {
        name: "openai",
        used: true,
        model: provider.model,
        requestId: provider.requestId,
        ...(provider.diagnostic?.responseReceived === undefined ? {} : { responseReceived: provider.diagnostic.responseReceived }),
        ...(provider.diagnostic?.finishReason === undefined ? {} : { finishReason: provider.diagnostic.finishReason }),
        ...(provider.diagnostic?.refusalPresent === undefined ? {} : { refusalPresent: provider.diagnostic.refusalPresent }),
        ...(provider.diagnostic?.parsedPresent === undefined ? {} : { parsedPresent: provider.diagnostic.parsedPresent }),
        ...(provider.usage.inputTokens === undefined ? {} : { inputTokens: provider.usage.inputTokens }),
        ...(provider.usage.outputTokens === undefined ? {} : { outputTokens: provider.usage.outputTokens }),
        ...(provider.usage.totalTokens === undefined ? {} : { totalTokens: provider.usage.totalTokens }),
        ...(provider.diagnostic?.rawContentBytes === undefined ? {} : { rawContentBytes: provider.diagnostic.rawContentBytes }),
        ...(provider.diagnostic?.rawContentChecksum === undefined ? {} : { rawContentChecksum: provider.diagnostic.rawContentChecksum }),
      },
    });
  } catch (error) {
    throw new AiProviderError("AI_OUTPUT_INVALID", "Provider output could not be normalized into the Design direction contract.", undefined, {
      ...provider.diagnostic,
      stage: "provider_normalization",
      outputStage: "HOST_MAPPING_FAILED",
      requestAttempted: provider.diagnostic?.requestAttempted ?? true,
      apiResponseReceived: provider.diagnostic?.apiResponseReceived ?? true,
      responseReceived: provider.diagnostic?.responseReceived ?? true,
      outputComplete: provider.diagnostic?.outputComplete ?? true,
      schemaName: provider.diagnostic?.schemaName ?? "design-direction-set",
      issueCode: zodIssueCode(error),
      fieldPath: zodIssuePaths(error)?.[0],
      issueCount: zodIssueCount(error),
      domainValidationIssuePaths: zodIssuePaths(error),
    });
  }
}

export class OpenAiLeadProvider implements LeadAnalysisProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async analyzePrompt(
    input: Parameters<LeadAnalysisProvider["analyzePrompt"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<LeadAgentAnalysis> {
    const output = await this.call<LeadAnalysisProviderOutput>(
      "lead",
      input,
      LeadAnalysisProviderOutputSchema,
      "lead-analysis",
      "lead-analysis",
      approvedSkills,
      skillContextIdentity,
    );
    const { languageObservation, ...providerFields } = output;
    return LeadAgentAnalysisSchema.parse({
      ...providerFields,
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      originalPromptChecksum: checksumPersistedDocument(input.originalPrompt.replace(/\r\n?/g, "\n").trim()),
      operatorLanguage: input.operatorLanguage,
      siteLanguage: input.siteLanguage,
      ...(input.languageResolution ? { languageResolution: input.languageResolution } : {}),
      ...(languageObservation === null ? {} : { languageObservation }),
    });
  }
  async proposeClarifications(
    input: Parameters<LeadAnalysisProvider["proposeClarifications"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<ClarificationPlan> {
    const output = await this.call<ClarificationPlanProviderOutput>(
      "lead",
      input,
      ClarificationPlanProviderOutputSchema,
      "clarification-plan",
      "lead-clarifications",
      approvedSkills,
      skillContextIdentity,
    );
    return ClarificationPlanSchema.parse({
      ...output,
      projectId: input.analysis.projectId,
      projectVersion: input.analysis.projectVersion,
      operatorLanguage: input.operatorLanguage,
    });
  }
  async assembleBriefDraft(
    input: Parameters<LeadAnalysisProvider["assembleBriefDraft"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<BriefDraft> {
    const prompt = rolePrompt("lead", input, false, approvedSkills);
    const result = await this.ai.request<
      z.infer<typeof BriefDraftStructuredOutputSchema>
    >({
      ...prompt,
      role: "lead",
      schema: BriefDraftStructuredOutputSchema,
      schemaName: "brief-draft",
      idempotencyKey: `lead-brief:${skillContextIdentity}`,
    });
    return normalizeBriefDraft(result.value, { projectId: input.analysis.projectId, projectVersion: input.analysis.projectVersion, operatorLanguage: input.analysis.operatorLanguage, siteLanguage: input.analysis.siteLanguage, originalPromptChecksum: input.analysis.originalPromptChecksum }, result.diagnostic) as BriefDraft;
  }
  private async call<T>(
    role: "lead",
    input: unknown,
    schema:
      | typeof LeadAgentAnalysisSchema
      | typeof LeadAnalysisProviderOutputSchema
      | typeof ClarificationPlanSchema
      | typeof ClarificationPlanProviderOutputSchema
      | typeof BriefDraftSchema,
    schemaName: string,
    idempotencyKey: string,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[],
    skillContextIdentity: string,
  ): Promise<T> {
    const prompt = rolePrompt(role, input, false, approvedSkills);
    return (
      await this.ai.request<T>({
        ...prompt,
        role,
        schema: schema as never,
        schemaName,
        idempotencyKey: `${idempotencyKey}:${skillContextIdentity}`,
      })
    ).value;
  }
}
/**
 * Build the smallest lossless recovery prompt context. Planning-owned
 * requirement prose is carried once in the ordered host manifest; pages and
 * route handles are carried once in the route manifest. Persistence checksums,
 * the legacy planner projection, and duplicate full manifests stay host-side.
 */
export function createPlanningRecoveryPromptContext(input: PlanningRecoveryProviderInput) {
  const planningRequirementIds = new Set(input.planningRequirementManifest.requirements.map((entry) => entry.requirementId));
  const requirements = input.canonicalBrief.requirements;
  const decisions = input.canonicalBrief.decisions;
  const seo = input.canonicalBrief.seo;
  const briefWithoutDuplicatePlanningData = Object.fromEntries(Object.entries(input.canonicalBrief).filter(([key]) => !["pages", "requirements", "decisions", "seo"].includes(key)));
  const compactBrief = {
    ...briefWithoutDuplicatePlanningData,
    requirements: requirements.filter((entry) => !planningRequirementIds.has(entry.id)),
    decisions: { ...decisions, form: { ...decisions.form, interactionStates: decisions.form.interactionStates.filter((entry) => !planningRequirementIds.has(entry.id)) } },
    seo: { ...seo, locationTargeting: seo.locationTargeting.filter((entry) => !planningRequirementIds.has(entry.id)) },
  };
  return {
    task: "planning-recovery-full-package",
    authority: input.authority,
    mode: input.mode,
    recoveryPlan: { recoveryReason: input.plan.recoveryReason, routePolicy: input.plan.routePolicy },
    projectVersion: input.plannerInput.projectVersion,
    currentWorkflowState: input.plannerInput.currentWorkflowState,
    operatorLanguage: input.plannerInput.approvedBrief.operatorLanguage ?? "en",
    siteLanguage: input.canonicalBrief.localization.defaultLocale,
    canonicalBrief: compactBrief,
    canonicalRouteManifest: {
      schemaVersion: input.canonicalRouteManifest.schemaVersion,
      routePolicy: input.canonicalRouteManifest.routePolicy,
      routes: input.canonicalRouteManifest.routes.map((route) => ({
        routeHandle: route.routeHandle,
        pageHandle: route.pageHandle,
        pageId: route.pageId,
        path: route.path,
        pagePurpose: route.pagePurpose,
        pageRole: route.pageRole,
        legal: route.legal,
        required: route.required,
        parentPageId: route.parentPageId,
        navigation: route.navigation,
        seo: route.seo,
        pageSourceRefs: input.canonicalBrief.pages.find((page) => page.id === route.pageId)?.sourceRefs ?? [],
      })),
    },
    planningTargetCatalog: {
      schemaVersion: input.planningTargetCatalog.schemaVersion,
      targets: input.planningTargetCatalog.targets,
    },
    planningRequirementManifest: {
      schemaVersion: input.planningRequirementManifest.schemaVersion,
      requirements: input.planningRequirementManifest.requirements.map((entry, position) => ({
        position,
        requirementHandle: entry.requirementHandle,
        category: entry.category,
        statement: entry.statement,
        sourceRefs: entry.sourceRefs,
        origin: entry.origin,
      })),
    },
    currentPlanningEvidence: input.currentPlanningEvidence.structuralSummary,
    outputPolicy: {
      schemaVersion: input.outputPolicy.schemaVersion,
      maxEstimatedTokens: input.outputPolicy.maxEstimatedTokens,
      complete: input.outputPolicy.complete,
      truncation: input.outputPolicy.truncation,
    },
  };
}

/**
 * Keep canonical IDs, checksums, lifecycle data, and historical requirement
 * machinery entirely host-side. The compatibility Brief and token summaries
 * retain the Planning semantics the provider needs.
 */
export function plannerProviderPromptInput(input: Parameters<PlannerArchitectureProvider["plan"]>[0], table: PlannerReferenceTable) {
  const redact = (value: unknown, key?: string): unknown => {
    if (key && (/(?:^|_)(?:id|checksum|hash|history|approval|currentness)(?:$|_)/i.test(key) || ["projectid", "projectversion", "briefchecksum", "approvedrequirementschecksum", "requirementhistory", "canonicalbrief", "plannerauthority", "plannerreferencetable", "existingdecisions"].includes(key.toLowerCase()))) return undefined;
    if (typeof value === "string" && /(?:REQUIREMENT:)?v3-[a-f0-9]{32,}/i.test(value)) return "[host-issued Planner token]";
    if (Array.isArray(value)) return value.map((entry) => redact(entry));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .flatMap(([entryKey, entryValue]) => {
        const redacted = redact(entryValue, entryKey);
        return redacted === undefined ? [] : [[entryKey, redacted]];
      }));
  };
  return {
    approvedBrief: redact(input.approvedBrief),
    plannerReferenceProtocol: plannerProviderReferenceProtocol(table),
    documentationExcerpts: input.documentationExcerpts ?? [],
  };
}

export class OpenAiPlannerProvider implements PlannerArchitectureProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  preflightPlanRecovery(input: Pick<PlanningRecoveryProviderInput, "planningRequirementManifest">): void {
    const wireSchema = createPlanningRecoveryProviderWireSchema(input.planningRequirementManifest);
    buildProductionResponseFormat(wireSchema, "planning-recovery-package", { schemaDefinitions: PlanningRecoveryProviderSchemaDefinitions });
  }
  async plan(
    input: Parameters<PlannerArchitectureProvider["plan"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<PlanningPackage> {
    const referenceTable = input.plannerReferenceTable;
    const providerInput = referenceTable
      ? plannerProviderPromptInput(input, referenceTable)
      : input;
    const prompt = rolePrompt("planner", providerInput, false, approvedSkills);
    const languageInstruction = `The generated website locale is the approved Brief localization.defaultLocale: ${input.approvedBrief.localization.defaultLocale}; planner summaries, rationale, and operator-facing explanations must use approved Brief operatorLanguage=${input.approvedBrief.operatorLanguage}. For every planned form field, output an explicit English machine fieldId independent of that locale and a separate user-facing label in the requested locale. Never derive fieldId from label.`;
    const dependencyInstruction = `Generated-project direct dependency authority is host-owned. You may express only a project DependencyPlan using this bounded catalog: ${dependencyCatalogPromptContext()}. Do not invent package names, versions, package sources, or package managers; the host validates and owns the resulting manifest.`;
    const formInstruction = `Form behavior authority: when the approved Brief's formBehaviorRequirements explicitly says formPresent=true, successUx=SIMULATED, dataTransmission=NONE, persistence=NONE, and thirdParty=NONE, every matching form must use submissionMechanism=client-only. Do not reopen that decision as pending-decision, server-action, or route-handler, and do not add database, email, external-provider, authentication, or server-boundary work for that form. The host will deterministically normalize and validate this boundary.`;
    const schema = referenceTable
      ? createTokenizedPlanningProviderWireSchema(referenceTable)
      : PlanningPackageStructuredOutputSchema;
    const result = await this.ai.request<z.infer<typeof schema>>({
      ...prompt,
      system: `${prompt.system}\n${languageInstruction}\n${dependencyInstruction}\n${formInstruction}`,
      role: "planner",
      schema,
      schemaName: referenceTable ? "planning-package-v4" : "planning-package",
      idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      retryPolicy: { maxRetries: 0, corrections: 0 },
    });
    if (referenceTable)
      return normalizeTokenizedPlanningPackage(
        result.value as TokenizedPlanningProviderWire,
        { projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.approvedBriefChecksum },
        input.approvedBrief,
        referenceTable,
      );
    return normalizePlanningPackage(
      result.value as z.infer<typeof PlanningPackageStructuredOutputSchema>,
      { projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.approvedBriefChecksum },
      input.approvedBrief,
    );
  }

  async planRecovery(
    input: PlanningRecoveryProviderInput,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
    hostTimestamp?: string,
  ): Promise<PlanningRecoveryProviderResult> {
    const promptInput = createPlanningRecoveryPromptContext(input);
    const prompt = rolePrompt("planner", promptInput, false, approvedSkills);
    const instruction = [
      "This is an explicitly authorized host Planning recovery.",
      "Return exactly one complete PlanningPackage using the full canonical Brief as the sole semantic authority.",
      "Preserve every canonical Planning-owned requirement and do not summarize, omit, or reinterpret canonical requirements.",
      "Emit every required route manifest entry exactly once using its exact routeHandle, pageHandle, and canonical path; emit every required page exactly once using its exact handles.",
      "Use only exact host-issued planning requirement handles from planningRequirementManifest for PlanningPackage requirementReferences and traceability entries; the host maps those handles to canonical V3 IDs. Preserve page and asset references only when present in the supplied host manifests; do not use legacy IDs, canonical Planning IDs, or invented references.",
      "Return all required routes in sitemap and architecture, use route handles for navigation, flow starts/steps, and forms, and include complete semantic and traceability coverage for every manifest requirement.",
      "For every exact requirementHandle key in planningRequirementManifest, emit exactly one requirementAccounting object property with that same key; do not add, omit, rename, or reorder keys. Each accounting value contains one explicit disposition, zero or more additional planningTargetRefs, and concise non-empty semanticEvidence. Each target ref is only {targetHandle}, selected from the host-issued planningTargetCatalog; do not emit routeHandle, pageHandle, section, requirementId, requirementDomain, or any other identity field. Host-prebound target relationships, when supplied by the host manifest, are added by the host and need not be rediscovered.",
      "Do not use keyword matching as a substitute for semantic reasoning; semanticEvidence must explain the actual Planning treatment of the canonical requirement.",
      "The output policy is complete=true with truncation=REJECT; never truncate or return a partial package.",
      "Do not mutate persistence, the project, workflow state, approvals, checksums, timestamps, or decision identities.",
      "Do not invent requirement IDs, target handles, pages, assets, business facts, providers, backend capabilities, or user decisions.",
      "The host will bind identity, route policy, timestamps, decision IDs, acceptance, and checksum policy and will reject unsupported facts or incomplete coverage.",
    ].join(" ");
    const wireSchema = createPlanningRecoveryProviderWireSchema(input.planningRequirementManifest);
    const result = await this.ai.request<z.infer<typeof wireSchema>>({
      ...prompt,
      system: `${prompt.system}\n${instruction}`,
      role: "planner",
      schema: wireSchema,
      schemaDefinitions: PlanningRecoveryProviderSchemaDefinitions,
      schemaName: "planning-recovery-package",
      idempotencyKey: `${input.plannerInput.idempotencyKey}:${skillContextIdentity}`,
      maxCompletionTokens: input.outputPolicy.maxEstimatedTokens,
      retryPolicy: { maxRetries: 0, corrections: 0 },
      parseStrategy: "manual",
    });
    if (!hostTimestamp) throw new AiProviderError("AI_OUTPUT_INVALID", "Host recovery timestamp was not supplied for provider normalization.");
    return normalizeRecoveryPlanningPackage(
      result.value,
      { projectId: input.plannerInput.projectId, projectVersion: input.plannerInput.projectVersion, approvedBriefChecksum: input.plannerInput.approvedBriefChecksum, timestamp: IsoDateTimeSchema.parse(hostTimestamp) },
      input.plannerInput.approvedBrief,
      input.canonicalRouteManifest,
      input.planningRequirementManifest,
    );
  }
  async proposeChangeSet(
    input: PlannerRefreshProviderInput,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<PlanningChangeSetProviderOutput> {
    const prompt = rolePrompt("planner", {
      ...input,
      task: "planning-refresh-changeset",
      currentPlanningPackage: input.currentPlanningPackage,
      briefDelta: input.briefDelta,
      authorizationScopeChecksum: input.authorizationScopeChecksum,
    }, false, approvedSkills);
    const instruction = [
      "This is a Planning refresh, not initial planning.",
      "Return only the bounded typed changes array required by the planning-change-set schema.",
      "Do not return a PlanningPackage or any project identity, version, checksum, approval, timestamp, decisionId, or persistence metadata.",
      "Preserve every current requirement and unrelated Planning domain. Propose only changes causally supported by the supplied BriefDelta and authorization scope.",
      "Do not use legacy-v1 references, invented requirement IDs, or raw provider-specific references.",
    ].join(" ");
    const result = await this.ai.request<z.infer<typeof PlanningChangeSetProviderOutputSchema>>({
      ...prompt,
      system: `${prompt.system}\n${instruction}`,
      role: "planner",
      schema: PlanningChangeSetProviderOutputSchema,
      schemaName: "planning-change-set",
      idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
    });
    return PlanningChangeSetProviderOutputSchema.parse(result.value);
  }
}
export class OpenAiDesignProvider implements DesignDirectionProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  preflight() {
    buildProductionResponseFormat(DesignDirectionStructuredOutputSchema, "design-direction-set");
  }
  async proposeDesignDirections(
    input: Parameters<DesignDirectionProvider["proposeDesignDirections"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<DesignDirectionSet> {
    const prompt = rolePrompt("design", input, false, approvedSkills);
    const logoPolicy = resolveLogoPolicy(input.approvedBrief);
    const logoInstruction =
      logoPolicy.mode === "TEXT_WORDMARK"
        ? `Use the text wordmark "${logoPolicy.wordmarkText}" as text; do not create, redraw, or substitute a logo file.`
        : logoPolicy.mode === "NO_LOGO"
          ? "No logo treatment is required; do not create, redraw, or substitute a logo file."
          : "Use only the supplied user logo and never redraw or replace it.";
    const result = await this.ai.request<
      z.infer<typeof DesignDirectionStructuredOutputSchema>
    >({
      ...prompt,
      system: `${prompt.system}\nLogo policy: ${logoInstruction}`,
      role: "design",
      schema: DesignDirectionStructuredOutputSchema,
      schemaName: "design-direction-set",
      idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      retryPolicy: { maxRetries: 0, corrections: 0 },
      parseStrategy: "manual",
    });
    return normalizeDesignDirectionSet(result.value, { projectId: input.projectId, projectVersion: input.projectVersion }, { requestId: result.requestId, model: result.usage.model, usage: result.usage, diagnostic: result.diagnostic });
  }
}
export class OpenAiImplementationProvider implements ImplementationProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async proposeTaskChanges(
    context: ImplementationContext,
    signal?: AbortSignal,
  ): Promise<ImplementationChangeProposal> {
    const promptContext = {
      ...context,
      skills: (context.skills ?? []).map(({ skillId, approvedChecksum, coverageKeys }) => ({ skillId, approvedChecksum, coverageKeys })),
      context7Excerpts: context.context7Excerpts?.map((excerpt) => {
        const slice = sliceDocumentationExcerpt(excerpt, context.task.objective.split(/\W+/).filter((term) => term.length >= 4).slice(0, 8), 8_000);
        return { ...excerpt, content: slice.content, checksum: slice.checksum, truncationState: slice.selectedBytes < slice.candidateBytes ? "excerpt-truncated" as const : excerpt.truncationState };
      }),
    };
    const prompt = rolePrompt(
      "implementation",
      promptContext,
      false,
      (context.skills ?? []).map((skill) => ({
        skillId: skill.skillId,
        approvedChecksum: skill.approvedChecksum ?? "0".repeat(64),
        coverageKeys: skill.coverageKeys ?? [],
        skillMarkdown: skill.markdown,
        references: skill.references,
      })),
    );
    const foundationInstruction =
      context.task.taskType === "implement-project-foundation"
        ? "For foundation, create package.json using only the supplied Foundation required-artifact policy, required npm scripts, approved stack, and authorized scopes. Do not create package-lock.json; the Factory prepares it with a fixed npm command after package.json is accepted. For foundation, also create eslint.config.mjs as the approved ESLint 9 flat config importing defineConfig/globalIgnores from eslint/config and nextVitals from eslint-config-next/core-web-vitals, with only the approved ignore directories. Also create next.config.mjs with the approved Turbopack root setting `{ turbopack: { root: process.cwd() } }`. Do not execute npm or any shell command."
        : "Do not execute npm or any shell command.";
    const approvedFormFields = context.formPlan?.forms.flatMap((form) => form.fields.map((field) => `${form.id}:${field.fieldId}${field.required ? " (required)" : ""}`)) ?? [];
    const formRetryInstruction =
      context.task.taskType === "implement-form" &&
      context.task.safeFailureCode === "FORM_FIELD_UNAPPROVED"
        ? `This is a bounded retry after FORM_FIELD_UNAPPROVED. Use the accepted FormPlan as the complete product-field allowlist: ${approvedFormFields.join(", ") || "the fields in the accepted FormPlan"}. Do not add any other product field. Stable HTML name keys may use only explicit validator aliases; preserve the approved submission behavior and exact writable scope. Do not return raw prior provider output.`
        : "";
    const formRepairInstruction =
      context.task.taskType === "repair-targeted-failure" &&
      context.formPlan?.forms.length
        ? `For a form repair, the accepted FormPlan is authoritative. Preserve exactly its form id, submission mechanism, and fieldIds: ${approvedFormFields.join(", ")}. Remove every input, select, or textarea whose name is not an approved fieldId or explicit validator alias, including any phone, address, appointment-date, or consent field not present in that FormPlan. Emit one data-qa-field per approved fieldId, using either the fieldId value or exactly the canonical formId:fieldId namespace, and emit the exact data-qa-form id. For client-only forms, keep validation and success local with no network, persistence, server action, route handler, or external provider.`
        : "";
    const testArtifactInstruction =
      context.task.taskType === "write-unit-tests"
        ? "For write-unit-tests, you MUST return at least one create-file or replace-file operation under src/**/*.test.ts or src/**/*.test.tsx. The file must test approved application behavior using real imports or public contracts; never return an empty operations array, never use src/**/*.spec.* and never use expect(true) filler."
        : "";
    const repairInstruction =
      context.task.taskType === "repair-targeted-failure"
        ? "This is a targeted repair. You MUST return at least one create-file, replace-file, or patch-text operation that directly corrects the reported failure. Every operation MUST remain within the task's canonical writable fileScopes; do not return an empty or no-op proposal, do not rewrite an unrelated parent page, and do not modify tests when the scope is production source. If the required route file is absent, create it at the exact route path indicated by fileScopes. Preserve approved facts, routes, and existing behavior. For QA_FORM_VALIDATION_FAILURE, use the accepted FormPlan in context as the complete form contract: preserve its form id, submission mechanism, approved fieldIds, validation, selectors, and success behavior; do not invent fields, persistence, or external delivery."
        : "";
    const responseSchema = context.allowedEditStrategies?.includes("AST_PATCH_EXISTING")
      ? ImplementationChangeProposalStructuredOutputSchema
      : ImplementationChangeProposalWithoutAstStructuredOutputSchema;
    const result = await this.ai.request<
      z.infer<typeof ImplementationChangeProposalStructuredOutputSchema> | z.infer<typeof ImplementationChangeProposalWithoutAstStructuredOutputSchema>
    >({
      ...prompt,
      system: `${prompt.system}\n${foundationInstruction}\n${formRetryInstruction}\n${formRepairInstruction}\n${testArtifactInstruction}\n${repairInstruction}\nFor every create-file or replace-file operation, expectedResultChecksum must be the lowercase SHA-256 checksum of the exact UTF-8 content string. For patch-text, checksum the exact resulting UTF-8 file content. AST_PATCH_EXISTING is allowed only when the context advertises it: use one typed structural selector against an existing .ts/.tsx file, include the current expectedFileChecksum and the exact expectedResultChecksum, and do not emit project, task, attempt, TaskContract, or TaskGraph identity fields because those are host-owned and stamped after transport validation. AST patches must be narrow, parse-valid, dependency-authorized, and must never contain executable callbacks, shell instructions, or raw source outside the bounded payload. Preserve authorized relative paths and do not invent Factory metadata paths.`,
      role: "implementation",
      schema: responseSchema,
      schemaName: "implementation-change-proposal",
      signal,
      idempotencyKey: `${context.task.id}:${context.contextChecksum}:${context.skillContextIdentity ?? "none"}`,
    });
    const hostPhase7cBinding = context.task.phase7c
      ? {
          taskContractId: context.task.phase7c.taskContractId,
          taskContractChecksum: context.task.phase7c.taskContractChecksum,
          dataContractIds: context.task.phase7c.dataContractIds,
          ...(context.task.phase7c.databaseDecisionId
            ? { databaseDecisionId: context.task.phase7c.databaseDecisionId }
            : {}),
          ...(context.task.phase7c.databaseDecisionChecksum
            ? {
                databaseDecisionChecksum:
                  context.task.phase7c.databaseDecisionChecksum,
              }
            : {}),
          ...(context.task.phase7c.dependencyProposalId
            ? { dependencyProposalId: context.task.phase7c.dependencyProposalId }
            : {}),
        }
      : undefined;
    const normalized = {
      ...result.value,
      operations: result.value.operations.map((operation) => {
        if (operation.type === "ast-patch") {
          const normalizedAst = normalizeAstTransportOperation(operation as unknown as Record<string, unknown>);
          return {
            ...normalizedAst,
            projectId: context.task.projectId,
            projectVersion: context.task.projectVersion,
            taskId: context.task.id,
            taskContractId: context.task.phase7c?.taskContractId,
            taskContractChecksum: context.task.phase7c?.taskContractChecksum,
            taskGraphChecksum: context.taskGraphChecksum,
          };
        }
        const { expectedPriorChecksum, ...rest } = operation;
        const expectedResultChecksum = rest.type === "create-file" || rest.type === "replace-file" ? checksumText(rest.content) : rest.type === "patch-text" ? checksumTextPatchResult(rest, context.files) : rest.expectedResultChecksum;
        return { ...rest, expectedResultChecksum, ...(expectedPriorChecksum === null ? {} : { expectedPriorChecksum }) };
      }),
      ...(hostPhase7cBinding
        ? { phase7c: hostPhase7cBinding }
        : result.value.phase7c
          ? {
              phase7c: (() => {
                const {
                  databaseDecisionId,
                  databaseDecisionChecksum,
                  dependencyProposalId,
                  ...binding
                } = result.value.phase7c;
                return {
                  ...binding,
                  ...(databaseDecisionId === null ? {} : { databaseDecisionId }),
                  ...(databaseDecisionChecksum === null
                    ? {}
                    : { databaseDecisionChecksum }),
                  ...(dependencyProposalId === null
                    ? {}
                    : { dependencyProposalId }),
                };
              })(),
            }
          : {}),
      providerMetadata: {
        provider: result.value.providerMetadata.provider,
        ...(result.value.providerMetadata.inputTokens === null
          ? {}
          : { inputTokens: result.value.providerMetadata.inputTokens }),
        ...(result.value.providerMetadata.outputTokens === null
          ? {}
          : { outputTokens: result.value.providerMetadata.outputTokens }),
      },
      projectId: context.task.projectId,
      projectVersion: context.task.projectVersion,
      taskId: context.task.id,
      taskAttempt: context.task.attempt,
    };
    return ImplementationChangeProposalSchema.parse(normalized);
  }
}
export class OpenAiOrchestrationProvider implements OrchestrationPlanningProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async plan(input: unknown, signal?: AbortSignal) {
    const prompt = rolePrompt("orchestrator", input);
    return (
      await this.ai.request({
        ...prompt,
        role: "orchestrator",
        schema: OrchestrationPlanSchema,
        schemaName: "orchestration-plan",
        signal,
      })
    ).value as { tasks: unknown[] };
  }
}
export class OpenAiArchitectureReviewerProvider implements ArchitectureReviewProvider {
  readonly promptVersion = "architecture-reviewer.v2";
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async review(
    input: ArchitectureReviewInput,
    signal?: AbortSignal,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<ArchitectureReviewProviderOutput> {
    const prompt = rolePrompt(
      "architecture-reviewer",
      input,
      false,
      approvedSkills,
    );
    return (
      await this.ai.request({
        ...prompt,
        role: "architecture-reviewer",
        schema: ArchitectureReviewProviderOutputSchema,
        schemaName: "architecture-review-result",
        signal,
        idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      })
    ).value as ArchitectureReviewProviderOutput;
  }
}
export class OpenAiContractAuditorProvider implements ContractAuditProvider {
  readonly promptVersion = CONTRACT_AUDIT_PROMPT_VERSION;
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async review(
    input: ContractAuditInput,
    signal?: AbortSignal,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<ContractAuditProviderOutput> {
    const prompt = rolePrompt("contract-auditor", input, false, approvedSkills);
    return (
      await this.ai.request({
        ...prompt,
        role: "contract-auditor",
        schema: ContractAuditProviderOutputSchema,
        schemaName: "contract-audit-result",
        signal,
        idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      })
    ).value as ContractAuditProviderOutput;
  }
}
export class OpenAiCodeIntegrationReviewProvider implements CodeIntegrationReviewProvider {
  readonly promptVersion = "code-integration-reviewer.v1";
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async review(
    input: CodeIntegrationReviewInput,
    signal?: AbortSignal,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<CodeIntegrationReviewProviderOutput> {
    const prompt = rolePrompt(
      "code-integration-reviewer",
      input,
      false,
      approvedSkills,
    );
    return (
      await this.ai.request({
        ...prompt,
        role: "code-integration-reviewer",
        schema: CodeIntegrationReviewProviderOutputSchema,
        schemaName: "code-integration-review-result",
        signal,
        idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      })
    ).value as CodeIntegrationReviewProviderOutput;
  }
}
export class OpenAiSecurityReviewProvider implements SecurityReviewProvider {
  readonly promptVersion = "security-reviewer.v1";
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async review(
    input: SecurityReviewInput,
    signal?: AbortSignal,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<SecurityReviewProviderOutput> {
    const prompt = rolePrompt(
      "security-reviewer",
      input,
      false,
      approvedSkills,
    );
    return (
      await this.ai.request({
        ...prompt,
        role: "security-reviewer",
        schema: SecurityReviewProviderOutputSchema,
        schemaName: "security-review-result",
        signal,
        idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      })
    ).value as SecurityReviewProviderOutput;
  }
}
export class OpenAiTestQualityReviewProvider implements TestQualityReviewProvider {
  readonly promptVersion = "test-quality-reviewer.v1";
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async review(
    input: TestQualityReviewInput,
    signal?: AbortSignal,
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<TestQualityReviewProviderOutput> {
    const prompt = rolePrompt(
      "test-quality-reviewer",
      input,
      false,
      approvedSkills,
    );
    return (
      await this.ai.request({
        ...prompt,
        role: "test-quality-reviewer",
        schema: TestQualityReviewProviderOutputSchema,
        schemaName: "test-quality-review-result",
        signal,
        idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
      })
    ).value as TestQualityReviewProviderOutput;
  }
}
export function createProviderAdapters(ai: OpenAiStructuredClient) {
  return {
    lead: new OpenAiLeadProvider(ai),
    planner: new OpenAiPlannerProvider(ai),
    design: new OpenAiDesignProvider(ai),
    implementation: new OpenAiImplementationProvider(ai),
    architectureReviewer: new OpenAiArchitectureReviewerProvider(ai),
    contractAuditor: new OpenAiContractAuditorProvider(ai),
    codeIntegrationReviewer: new OpenAiCodeIntegrationReviewProvider(ai),
    securityReviewer: new OpenAiSecurityReviewProvider(ai),
    testQualityReviewer: new OpenAiTestQualityReviewProvider(ai),
    orchestrator: new OpenAiOrchestrationProvider(ai),
  };
}
export type { ProviderUsageSink };
