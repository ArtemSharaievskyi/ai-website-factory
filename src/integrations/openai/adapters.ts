import { createHash } from "node:crypto";
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
import type { PlannerArchitectureProvider } from "@/agents/planner/ports";
import { isClientOnlyFormBrief, isNoBackendBrief } from "@/agents/planner/deterministic";
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
import { OpenAiStructuredClient } from "./client";
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
import type { ContractAuditInput } from "@/agents/reviewers/contracts/contracts";
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
  IsoDateTimeSchema,
  NonEmptyStringSchema,
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
const dropNullFields = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== null));
const withoutProjectIdentity = <T extends Record<string, z.ZodTypeAny>>(shape: T) => {
  const result = { ...shape };
  delete result.projectId;
  delete result.projectVersion;
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
  const { artifactId, expectedTarget, selector, payload, ...rest } = operation;
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
  taskId: z.string().uuid(),
  taskContractId: z.string().uuid(),
  taskContractChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  taskGraphChecksum: z.string().regex(/^[a-f0-9]{64}$/),
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
  AstPatchStructuredSchema,
]);
const Phase7CStructuredBindingSchema = z.object({
  taskContractId: z.string().uuid(),
  taskContractChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  dataContractIds: z.array(z.string().uuid()),
  databaseDecisionId: z.string().uuid().nullable(),
  databaseDecisionChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  dependencyProposalId: z.string().uuid().nullable(),
}).strict();
export const ImplementationChangeProposalStructuredOutputSchema = z
  .object({
    proposalId: z.string().uuid(),
    taskId: z.string().uuid(),
    taskAttempt: z.number().int().nonnegative(),
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
const StrictDesignDirectionSchema = DesignDirectionSchema.omit({ professionalDesign: true }).required();
const StrictDesignProviderSchema = z
  .object({
    name: NonEmptyStringSchema,
    used: z.boolean(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  })
  .strict();
const { professionalCapability: _professionalCapability, ...DesignDirectionSetTransportShape } = withoutProjectIdentity(DesignDirectionSetSchema.shape);
void _professionalCapability;
export const DesignDirectionStructuredOutputSchema = z
  .object({
    ...DesignDirectionSetTransportShape,
    directions: z.array(StrictDesignDirectionSchema).length(3),
    approvedBriefChecksum: z.string().nullable(),
    acceptedPlanningChecksum: z.string().nullable(),
    blockingReasons: z.array(NonEmptyStringSchema),
    warnings: z.array(NonEmptyStringSchema),
    directionSetChecksum: z.string().nullable(),
    provider: StrictDesignProviderSchema,
    supersedesSetId: z.string().nullable(),
    supersededAt: z.string().nullable(),
  })
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

const StrictTraceabilitySchema = TraceabilitySchema.extend({
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
    ...withoutProjectIdentity(TechnicalArchitectureSchema.shape),
    backendPriority: z
      .array(z.enum(["server-actions", "route-handlers", "supabase-services"]))
      .max(3),
    npmScripts: z.array(
      z
        .object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema })
        .strict(),
    ),
    acceptance: z
      .object({
        accepted: z.boolean(),
        acceptedAt: IsoDateTimeSchema.nullable(),
        acceptedBy: NonEmptyStringSchema.nullable(),
      })
      .strict(),
  })
  .strict();
const StrictPlanningAcceptanceSchema = z
  .object({
    acceptedAt: IsoDateTimeSchema.nullable(),
    acceptedBy: NonEmptyStringSchema.nullable(),
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
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
  PlanningPackageSchema.omit({ projectId: true, projectVersion: true }).extend({
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
    acceptance: StrictPlanningAcceptanceSchema,
  });
function omitNull<T extends Record<string, unknown>>(value: T, keys: string[]) {
  const result = { ...value };
  for (const key of keys) if (result[key] === null) delete result[key];
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
      traceability: value.traceability.map((entry) =>
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
      acceptance: omitNull(value.architecture.acceptance, [
        "acceptedAt",
        "acceptedBy",
      ]),
    },
    acceptance: omitNull(value.acceptance, [
      "acceptedAt",
      "acceptedBy",
      "checksum",
    ]),
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
    normalized as unknown as { storage: { traceability: unknown[] } }
  ).storage.traceability = value.storage.traceability.map((entry) =>
    omitNull(entry, ["unresolvedDependency"]),
  );
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
  return PlanningPackageSchema.parse(normalized);
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
];
function normalizeDesignDirectionSet(
  value: z.infer<typeof DesignDirectionStructuredOutputSchema>,
  host: { projectId: string; projectVersion: number },
): DesignDirectionSet {
  const normalized = bindProjectIdentity({
    ...value,
    directions: value.directions.map((direction) =>
      omitNull(direction, DESIGN_OPTIONAL_KEYS),
    ),
    ...(value.approvedBriefChecksum === null
      ? {}
      : { approvedBriefChecksum: value.approvedBriefChecksum }),
    ...(value.acceptedPlanningChecksum === null
      ? {}
      : { acceptedPlanningChecksum: value.acceptedPlanningChecksum }),
    ...(value.directionSetChecksum === null
      ? {}
      : { directionSetChecksum: value.directionSetChecksum }),
    ...(value.supersedesSetId === null
      ? {}
      : { supersedesSetId: value.supersedesSetId }),
    ...(value.supersededAt === null
      ? {}
      : { supersededAt: value.supersededAt }),
  }, host) as DesignDirectionSet;
  delete (normalized as unknown as { approvedBriefChecksum?: unknown })
    .approvedBriefChecksum;
  delete (normalized as unknown as { acceptedPlanningChecksum?: unknown })
    .acceptedPlanningChecksum;
  delete (normalized as unknown as { directionSetChecksum?: unknown })
    .directionSetChecksum;
  delete (normalized as unknown as { supersedesSetId?: unknown })
    .supersedesSetId;
  delete (normalized as unknown as { supersededAt?: unknown }).supersededAt;
  return DesignDirectionSetSchema.parse(normalized);
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
export class OpenAiPlannerProvider implements PlannerArchitectureProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async plan(
    input: Parameters<PlannerArchitectureProvider["plan"]>[0],
    approvedSkills: readonly ApprovedProceduralSkillPromptContext[] = [],
    skillContextIdentity = "none",
  ): Promise<PlanningPackage> {
    const prompt = rolePrompt("planner", input, false, approvedSkills);
    const languageInstruction = `The generated website locale is the approved Brief localization.defaultLocale: ${input.approvedBrief.localization.defaultLocale}; planner summaries, rationale, and operator-facing explanations must use approved Brief operatorLanguage=${input.approvedBrief.operatorLanguage}. For every planned form field, output an explicit English machine fieldId independent of that locale and a separate user-facing label in the requested locale. Never derive fieldId from label.`;
    const dependencyInstruction = `Generated-project direct dependency authority is host-owned. You may express only a project DependencyPlan using this bounded catalog: ${dependencyCatalogPromptContext()}. Do not invent package names, versions, package sources, or package managers; the host validates and owns the resulting manifest.`;
    const formInstruction = `Form behavior authority: when the approved Brief's formBehaviorRequirements explicitly says formPresent=true, successUx=SIMULATED, dataTransmission=NONE, persistence=NONE, and thirdParty=NONE, every matching form must use submissionMechanism=client-only. Do not reopen that decision as pending-decision, server-action, or route-handler, and do not add database, email, external-provider, authentication, or server-boundary work for that form. The host will deterministically normalize and validate this boundary.`;
    const result = await this.ai.request<
      z.infer<typeof PlanningPackageStructuredOutputSchema>
    >({
      ...prompt,
      system: `${prompt.system}\n${languageInstruction}\n${dependencyInstruction}\n${formInstruction}`,
      role: "planner",
      schema: PlanningPackageStructuredOutputSchema,
      schemaName: "planning-package",
      idempotencyKey: `${input.idempotencyKey}:${skillContextIdentity}`,
    });
    return normalizePlanningPackage(
      result.value,
      { projectId: input.projectId, projectVersion: input.projectVersion, approvedBriefChecksum: input.approvedBriefChecksum },
      input.approvedBrief,
    );
  }
}
export class OpenAiDesignProvider implements DesignDirectionProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
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
    });
    return normalizeDesignDirectionSet(result.value, { projectId: input.projectId, projectVersion: input.projectVersion });
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
    const formRetryInstruction =
      context.task.taskType === "implement-form" &&
      context.task.safeFailureCode === "FORM_FIELD_UNAPPROVED"
        ? "This is a bounded retry after FORM_FIELD_UNAPPROVED. Use the accepted FormPlan as the complete product-field allowlist: Name, E-Mail, Fahrradtyp, and Beschreibung des Problems, all required. Do not add phone, address, appointment date, privacy consent, or any other product field. Stable HTML name keys may use only explicit validator aliases; preserve the approved submission behavior and exact writable scope. Do not return raw prior provider output."
        : "";
    const testArtifactInstruction =
      context.task.taskType === "write-unit-tests"
        ? "For write-unit-tests, you MUST return at least one create-file or replace-file operation under src/**/*.test.ts or src/**/*.test.tsx. The file must test approved application behavior using real imports or public contracts; never return an empty operations array, never use src/**/*.spec.* and never use expect(true) filler."
        : "";
    const repairInstruction =
      context.task.taskType === "repair-targeted-failure"
        ? "This is a targeted repair. You MUST return at least one create-file, replace-file, or patch-text operation that directly corrects the reported failure. Every operation MUST remain within the task's canonical writable fileScopes; do not return an empty or no-op proposal, do not rewrite an unrelated parent page, and do not modify tests when the scope is production source. If the required route file is absent, create it at the exact route path indicated by fileScopes. Preserve approved facts, routes, and existing behavior. For QA_FORM_VALIDATION_FAILURE on the approved appointment form, preserve the exact four approved fields and implement the existing QA contract: add data-qa-form to the form, data-qa-field matching each approved field name, submit handling, and a visible data-qa-state=success result after valid synthetic submission; keep client/server validation and do not invent persistence or external delivery."
        : "";
    const result = await this.ai.request<
      z.infer<typeof ImplementationChangeProposalStructuredOutputSchema>
    >({
      ...prompt,
      system: `${prompt.system}\n${foundationInstruction}\n${formRetryInstruction}\n${testArtifactInstruction}\n${repairInstruction}\nFor every create-file or replace-file operation, expectedResultChecksum must be the lowercase SHA-256 checksum of the exact UTF-8 content string. For patch-text, checksum the exact resulting UTF-8 file content. AST_PATCH_EXISTING is allowed only when the context advertises it: use one typed structural selector against an existing .ts/.tsx file, include the current expectedFileChecksum, current TaskContract/TaskGraph identity, and the exact expectedResultChecksum. AST patches must be narrow, parse-valid, dependency-authorized, and must never contain executable callbacks, shell instructions, or raw source outside the bounded payload. Preserve authorized relative paths and do not invent Factory metadata paths.`,
      role: "implementation",
      schema: ImplementationChangeProposalStructuredOutputSchema,
      schemaName: "implementation-change-proposal",
      signal,
      idempotencyKey: `${context.task.id}:${context.contextChecksum}:${context.skillContextIdentity ?? "none"}`,
    });
    const normalized = {
      ...result.value,
      operations: result.value.operations.map((operation) => {
        if (operation.type === "ast-patch") return { ...normalizeAstTransportOperation(operation as unknown as Record<string, unknown>), projectId: context.task.projectId, projectVersion: context.task.projectVersion };
        const { expectedPriorChecksum, ...rest } = operation;
        const expectedResultChecksum = rest.type === "create-file" || rest.type === "replace-file" ? checksumText(rest.content) : rest.expectedResultChecksum;
        return { ...rest, expectedResultChecksum, ...(expectedPriorChecksum === null ? {} : { expectedPriorChecksum }) };
      }),
      ...(result.value.phase7c ? { phase7c: (() => { const { databaseDecisionId, databaseDecisionChecksum, dependencyProposalId, ...binding } = result.value.phase7c; return { ...binding, ...(databaseDecisionId === null ? {} : { databaseDecisionId }), ...(databaseDecisionChecksum === null ? {} : { databaseDecisionChecksum }), ...(dependencyProposalId === null ? {} : { dependencyProposalId }) }; })() } : {}),
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
  readonly promptVersion = "architecture-reviewer.v1";
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
  readonly promptVersion = "contract-auditor.v1";
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
