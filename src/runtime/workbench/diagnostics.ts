import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAiProviderError, type AiProviderError } from "@/integrations/openai/errors";
import { PROVIDER_OUTPUT_STAGES, ProviderTerminationMetadataSchema, type ProviderDiagnostic, type ProviderOutputStage, type ProviderTerminationMetadata } from "@/integrations/openai/usage";
import { isStagedPlanningFailure, StagedPlanningFailureClassSchema, StagedPlanningOperationSummarySchema, StagedPlanningStageSchema, type StagedPlanningOperationSummary, type StagedPlanningStage } from "@/agents/planner/staged-failures";
import { PlannerCoverageDiagnosticsSchema, PlannerDecompositionKindDomainDiagnosticsSchema, type PlannerCoverageDiagnostics, type PlannerDecompositionKindDomainDiagnostics } from "@/agents/planner/coverage-contract";
import { PlanningGraphCycleDiagnosticsSchema, type PlanningGraphCycleDiagnostics } from "@/agents/planner/staged-contracts";
import { DecompositionMinimumDiagnosticsSchema, type DecompositionMinimumDiagnostics } from "@/agents/planner/decomposition-minimum";
import { CoverageRepresentabilityAnchorDiagnosticsSchema, type CoverageRepresentabilityAnchorDiagnostics } from "@/agents/planner/coverage-representability";
import { PlanningAdmissionBoundarySchema, PlanningFinalAdmissionDiagnosticsSchema, type PlanningAdmissionBoundary, type PlanningFinalAdmissionDiagnostics } from "@/agents/planner/final-admission-diagnostics";
import { isWorkbenchOperationFailure, type WorkbenchOperationFailure } from "./operation-context";
import { WORKBENCH_OPERATION_STAGES, type WorkbenchOperationStage } from "./operation-context";
import { safeOperationFingerprint } from "./operation-ledger";
import { ProviderFailureDiagnosticSchema, type ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";
import { providerFailureDiagnosticFromError } from "@/integrations/openai/failure-diagnostics";
import { PlanningAdmissionDiagnosticEnvelopeSchema, type PlanningAdmissionDiagnosticEnvelope } from "@/agents/planner/staged-admission-diagnostics";
import { currentRuntimeProvenance, RuntimeProvenanceSchema, WorkbenchAttemptReadbackSchema, WorkbenchResponseOriginSchema, type RuntimeProvenance, type WorkbenchResponseOrigin } from "./observability";
import { DesignAdmissionDiagnosticSchema, type DesignAdmissionDiagnostic } from "@/agents/design/contracts";
import { OrchestratorError } from "@/orchestration/orchestrator/errors";

export const WorkbenchErrorCategorySchema = z.enum([
  "VALIDATION",
  "WORKFLOW_CONFLICT",
  "PROVIDER",
  "PERSISTENCE",
  "INTERNAL",
]);
export type WorkbenchErrorCategory = z.infer<typeof WorkbenchErrorCategorySchema>;

export const WorkbenchOperationSchema = z.enum([
  "SUBMIT_TO_LEAD",
  "ANSWER_LEAD_CLARIFICATIONS",
  "REFRESH_LEAD_CLARIFICATIONS",
  "READ_WORKBENCH_STATUS",
  "LIST_WORKBENCH_PROJECTS",
  "APPROVE_BRIEF",
  "REQUEST_BRIEF_CHANGES",
  "GENERATE_PLANNING",
  "APPROVE_PLANNING",
  "REQUEST_PLANNING_CHANGES",
  "GENERATE_ARCHITECTURE_REVIEW",
  "GENERATE_DESIGN",
  "DATABASE_DECISION",
  "DEPENDENCY_APPROVAL",
  "RUN_CONTRACT_AUDIT",
  "RECOVER_CONTRACT_AUDIT",
  "CORRECT_CONTRACT_AUDIT",
  "REASSESS_CONTRACT_AUDIT",
  "APPROVE_PHASE7C",
  "DESIGN_SELECTION",
  "START_IMPLEMENTATION",
  "WORKBENCH_REQUEST",
]);
export type WorkbenchOperation = z.infer<typeof WorkbenchOperationSchema>;

const WorkbenchOperationStageSchema = z.enum(WORKBENCH_OPERATION_STAGES);
const WorkbenchFailureClassSchema = z.union([StagedPlanningFailureClassSchema, z.enum(["UNEXPECTED_EXCEPTION", "KNOWN_WORKFLOW_FAILURE"])]);
export const WorkbenchProviderCallCountersSchema = z.object({ attempted: z.number().int().nonnegative(), started: z.number().int().nonnegative(), responseReceived: z.number().int().nonnegative(), structuredParsePassed: z.number().int().nonnegative(), semanticAdmissionPassed: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }).strict();
const WorkbenchProviderCallsByStageSchema = z.union([
  z.object({ decomposition: WorkbenchProviderCallCountersSchema, coverage: WorkbenchProviderCallCountersSchema }).strict(),
  z.object({ decomposition: WorkbenchProviderCallCountersSchema, coverage: WorkbenchProviderCallCountersSchema, "architecture-review": WorkbenchProviderCallCountersSchema }).strict(),
  z.object({ decomposition: WorkbenchProviderCallCountersSchema, coverage: WorkbenchProviderCallCountersSchema, "contract-audit": WorkbenchProviderCallCountersSchema }).strict(),
]);
const SafeOperationIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/);
const SafeFingerprintSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}@[A-Z_]+:[a-f0-9]{16}$/);
const SafeTopLevelFieldSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const WorkbenchRequestTransportDiagnosticsSchema = z.object({
  clientBodyByteLength: z.number().int().nonnegative().optional(),
  clientBodySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  clientTopLevelFields: z.array(SafeTopLevelFieldSchema).max(32).optional(),
  routeBodyByteLength: z.number().int().nonnegative(),
  routeBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  parsedTopLevelFields: z.array(SafeTopLevelFieldSchema).max(32),
  byteLengthMatch: z.boolean().optional(),
  sha256Match: z.boolean().optional(),
}).strict();
export type WorkbenchRequestTransportDiagnostics = z.infer<typeof WorkbenchRequestTransportDiagnosticsSchema>;
const SafeProviderDiagnosticSchema = ProviderFailureDiagnosticSchema.omit({ safeProviderMessage: true }).partial().strict();
const SafePersistenceDiagnosticSchema = z.object({
  stage: z.string().regex(/^[A-Za-z][A-Za-z0-9._:/-]{0,63}$/),
  operation: z.string().regex(/^[A-Za-z][A-Za-z0-9._:/-]{0,63}$/),
  sqlState: z.string().regex(/^[A-Za-z0-9._:/-]{1,32}$/),
  table: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/),
  constraint: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/),
  errorClass: z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/),
}).strict();
type SafePersistenceDiagnostic = z.infer<typeof SafePersistenceDiagnosticSchema>;

export const WorkbenchSubsystemSchema = z.enum([
  "ROUTE",
  "WORKBENCH_APPLICATION",
  "TRIAL_ENTRY",
  "LEAD",
  "PROVIDER",
  "PERSISTENCE",
]);
export type WorkbenchSubsystem = z.infer<typeof WorkbenchSubsystemSchema>;

export const WorkbenchErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    correlationId: z.string().uuid(),
    operation: WorkbenchOperationSchema,
    recoverable: z.boolean(),
    category: WorkbenchErrorCategorySchema,
    validationStage: z.enum(["REQUEST_SCHEMA", "ANALYSIS_SCHEMA", "ANALYSIS_SEMANTIC", "CLARIFICATION_MAPPING"]).optional(),
    issueCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
    fieldPath: z.string().regex(/^[A-Za-z][A-Za-z0-9_.\[\]]*$/).optional(),
    expectedShape: z.string().min(1).max(160).optional(),
    validationIssues: z.array(z.object({ path: z.string().regex(/^[A-Za-z][A-Za-z0-9_.\[\]]*$/), issueCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/), expectedShape: z.string().min(1).max(160) }).strict()).max(5).optional(),
    operationId: SafeOperationIdSchema.optional(),
    attemptId: z.string().uuid().optional(),
    operationKind: z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/).optional(),
    projectId: z.string().uuid().optional(),
    phase: z.enum(["PLANNING", "ARCHITECTURE_REVIEW"]).optional(),
    operationStage: WorkbenchOperationStageSchema.optional(),
    failureClass: WorkbenchFailureClassSchema.optional(),
    stage: z.union([StagedPlanningStageSchema, WorkbenchOperationStageSchema]).optional(),
    outerCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
    boundary: PlanningAdmissionBoundarySchema.optional(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
    safeToken: z.string().regex(/^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/).max(32).optional(),
    kindDomainDiagnostics: PlannerDecompositionKindDomainDiagnosticsSchema.optional(),
    minimumDiagnostics: DecompositionMinimumDiagnosticsSchema.optional(),
    graphCycleDiagnostics: PlanningGraphCycleDiagnosticsSchema.optional(),
    coverageDiagnostics: PlannerCoverageDiagnosticsSchema.optional(),
    representabilityAnchorDiagnostics: CoverageRepresentabilityAnchorDiagnosticsSchema.optional(),
    finalAdmissionDiagnostics: PlanningFinalAdmissionDiagnosticsSchema.optional(),
    admissionDiagnostics: PlanningAdmissionDiagnosticEnvelopeSchema.optional(),
    providerTermination: ProviderTerminationMetadataSchema.optional(),
    safeErrorFingerprint: SafeFingerprintSchema.optional(),
    requestTransport: WorkbenchRequestTransportDiagnosticsSchema.optional(),
    providerContract: z.string().regex(/^[a-z0-9-]{1,100}$/).optional(),
    providerDiagnostic: SafeProviderDiagnosticSchema.optional(),
    designAdmissionDiagnostic: DesignAdmissionDiagnosticSchema.optional(),
    persistenceDiagnostic: SafePersistenceDiagnosticSchema.optional(),
    sourceCurrentness: z.object({ disallowedPathCount: z.number().int().nonnegative(), paths: z.array(z.string().min(1).max(240)).max(8) }).strict().optional(),
    providerCallsTotal: z.number().int().nonnegative().optional(),
    providerCallsByStage: WorkbenchProviderCallsByStageSchema.optional(),
    providerInvocationState: z.enum(["RESERVED", "ATTEMPTING", "TRANSPORT_STARTED", "RESPONSE_RECEIVED", "PARSE_PASSED", "ADMISSION_PASSED", "FAILED"]).optional(),
    canonicalPlanningPersisted: z.boolean().optional(),
    canonicalArchitecturePersisted: z.boolean().optional(),
    lifecycleMutated: z.boolean().optional(),
    providerRequestCountExact: z.boolean().optional(),
    providerRequestCount: z.number().int().nonnegative().optional(),
    internalClassification: z.literal("UNEXPECTED_EXCEPTION").optional(),
    stagedOperation: StagedPlanningOperationSummarySchema.optional(),
    responseOrigin: WorkbenchResponseOriginSchema,
    attemptCreated: z.boolean(),
    attemptStatus: z.enum(["IN_PROGRESS", "SUCCEEDED", "FAILED"]).optional(),
    runtimeProvenance: RuntimeProvenanceSchema,
    attemptHistory: z.array(WorkbenchAttemptReadbackSchema).max(8).optional(),
  })
  .strict();
export type WorkbenchErrorResponse = z.infer<typeof WorkbenchErrorResponseSchema>;

export type WorkbenchDiagnosticContext = {
  action?: string;
  projectId?: string;
  workflowState?: string;
  operation?: WorkbenchOperation;
  correlationId?: string;
  runtimeProvenance?: RuntimeProvenance;
  responseMetadata?: import("./observability").WorkbenchResponseMetadata;
  requestTransport?: WorkbenchRequestTransportDiagnostics;
};

type SafeValidationProjection = {
  validationStage?: "REQUEST_SCHEMA" | "ANALYSIS_SCHEMA" | "ANALYSIS_SEMANTIC" | "CLARIFICATION_MAPPING";
  issueCode?: string;
  fieldPath?: string;
  expectedShape?: string;
  validationIssues?: Array<{ path: string; issueCode: string; expectedShape: string }>;
};

export type WorkbenchErrorProjection = Omit<WorkbenchErrorResponse, "responseOrigin" | "attemptCreated" | "attemptStatus" | "runtimeProvenance" | "attemptHistory"> & {
  httpStatus: number;
  subsystem: WorkbenchSubsystem;
  errorClass: string;
  providerDiagnostic?: SafeProviderDiagnostic;
  designAdmissionDiagnostic?: DesignAdmissionDiagnostic;
  persistenceDiagnostic?: SafePersistenceDiagnostic;
  sourceCurrentness?: { disallowedPathCount: number; paths: string[] };
  requestTransport?: WorkbenchRequestTransportDiagnostics;
  stagedOperation?: StagedPlanningOperationSummary;
  kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics;
  minimumDiagnostics?: DecompositionMinimumDiagnostics;
  graphCycleDiagnostics?: PlanningGraphCycleDiagnostics;
  coverageDiagnostics?: PlannerCoverageDiagnostics;
  representabilityAnchorDiagnostics?: CoverageRepresentabilityAnchorDiagnostics;
  boundary?: PlanningAdmissionBoundary;
  finalAdmissionDiagnostics?: PlanningFinalAdmissionDiagnostics;
  admissionDiagnostics?: PlanningAdmissionDiagnosticEnvelope;
  providerTermination?: ProviderTerminationMetadata;
  responseOrigin?: WorkbenchResponseOrigin;
  attemptCreated?: boolean;
  attemptStatus?: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  runtimeProvenance?: RuntimeProvenance;
  attemptHistory?: z.infer<typeof WorkbenchAttemptReadbackSchema>[];
};

type SafeProviderDiagnostic = {
  outputStage?: ProviderOutputStage;
  schemaName?: string;
  issueCode?: string;
  fieldPath?: string;
  responseReceived?: boolean;
  outputComplete?: boolean;
  tokenExhaustion?: boolean;
  requestId?: string;
  finishReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  maxCompletionTokens?: number;
  issueCount?: number;
  version?: 1;
  category?: ProviderFailureDiagnostic["category"];
  stage?: ProviderFailureDiagnostic["stage"];
  requestAttempted?: boolean;
  structuredParsingReached?: boolean;
  retryabilityHint?: boolean;
  provider?: string;
  model?: string;
  httpStatus?: number;
  sdkErrorClass?: string;
  providerErrorCode?: string;
  providerErrorType?: string;
  providerErrorParam?: string;
  errorCode?: string;
  transportPhase?: ProviderFailureDiagnostic["transportPhase"];
  transportFailureClass?: ProviderFailureDiagnostic["transportFailureClass"];
  transportCauseCode?: ProviderFailureDiagnostic["transportCauseCode"];
  endpointClass?: string;
  timeoutConfiguredMs?: number;
  configuredMaxRetries?: number;
  elapsedBucket?: ProviderFailureDiagnostic["elapsedBucket"];
  requestSizeBytes?: number;
  inputBytes?: number;
  schemaSizeBytes?: number;
  rawContentBytes?: number;
  rawContentChecksum?: string;
};

export type WorkbenchDiagnosticEvent = {
  type: "workbench.operation.failed";
  timestamp: string;
  correlationId: string;
  operation: WorkbenchOperation;
  projectId?: string;
  operationId?: string;
  attemptId?: string;
  operationKind?: string;
  phase?: "PLANNING" | "ARCHITECTURE_REVIEW";
  operationStage?: WorkbenchOperationStage;
  workflowState?: string;
  code: string;
  category: WorkbenchErrorCategory;
  subsystem: WorkbenchSubsystem;
  errorClass: string;
  recoverable: boolean;
  validationStage?: SafeValidationProjection["validationStage"];
  issueCode?: string;
  fieldPath?: string;
  expectedShape?: string;
  outputStage?: ProviderOutputStage;
  schemaName?: string;
  providerIssueCode?: string;
  providerFieldPath?: string;
  responseReceived?: boolean;
  outputComplete?: boolean;
  tokenExhaustion?: boolean;
  providerRequestId?: string;
  finishReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  maxCompletionTokens?: number;
  providerIssueCount?: number;
  providerDiagnostic?: SafeProviderDiagnostic;
  designAdmissionDiagnostic?: DesignAdmissionDiagnostic;
  persistenceDiagnostic?: SafePersistenceDiagnostic;
  sourceCurrentness?: { disallowedPathCount: number; paths: string[] };
  requestTransport?: WorkbenchRequestTransportDiagnostics;
  failureClass?: z.infer<typeof WorkbenchFailureClassSchema>;
  stage?: StagedPlanningStage | WorkbenchOperationStage;
  outerCode?: string;
  boundary?: PlanningAdmissionBoundary;
  reasonCode?: string;
  safeToken?: string;
  finalAdmissionDiagnostics?: PlanningFinalAdmissionDiagnostics;
  kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics;
  minimumDiagnostics?: DecompositionMinimumDiagnostics;
  graphCycleDiagnostics?: PlanningGraphCycleDiagnostics;
  coverageDiagnostics?: PlannerCoverageDiagnostics;
  admissionDiagnostics?: PlanningAdmissionDiagnosticEnvelope;
  providerTermination?: ProviderTerminationMetadata;
  safeErrorFingerprint?: string;
  providerContract?: string;
  providerCallsTotal?: number;
  providerCallsByStage?: z.infer<typeof WorkbenchProviderCallsByStageSchema>;
  providerInvocationState?: string;
  canonicalPlanningPersisted?: boolean;
  canonicalArchitecturePersisted?: boolean;
  lifecycleMutated?: boolean;
  providerRequestCountExact?: boolean;
  providerRequestCount?: number;
  internalClassification?: "UNEXPECTED_EXCEPTION";
  stagedOperation?: StagedPlanningOperationSummary;
  responseOrigin?: WorkbenchResponseOrigin;
  attemptCreated?: boolean;
  attemptStatus?: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  runtimeProvenance?: RuntimeProvenance;
  attemptHistory?: z.infer<typeof WorkbenchAttemptReadbackSchema>[];
};

const CONFLICT_CODES = new Set([
  "WORKBENCH_OPERATION_IN_PROGRESS",
  "WORKBENCH_OPERATION_REPLAY",
  "WORKBENCH_ACTION_NOT_AVAILABLE",
  "PLANNING_UPSTREAM_MISSING",
  "PLANNING_NOT_READY",
  "ARCHITECTURE_REVIEW_BLOCKED",
  "DESIGN_SET_NOT_READY",
  "DESIGN_DIRECTION_NOT_FOUND",
  "DESIGN_RECONCILIATION_STALE",
  "DESIGN_OUTCOME_UNKNOWN_REQUIRES_AUTHORIZATION",
  "DESIGN_OUTCOME_UNKNOWN",
  "IMPLEMENTATION_START_BLOCKED",
  "CONTRACT_AUDIT_PREREQUISITE_BLOCKED",
  "CONTRACT_AUDIT_RECOVERY_BLOCKED",
  "CONTRACT_AUDIT_STALE",
  "CONTRACT_AUDIT_WORKFLOW_INVALID",
  "CONTRACT_AUDIT_IDEMPOTENCY_CONFLICT",
  "CONTRACT_AUDIT_CORRECTION_BLOCKED",
  "CONTRACT_AUDIT_REASSESSMENT_BLOCKED",
  "PHASE7C_APPROVAL_BLOCKED",
  "PERSISTENCE_IMMUTABLE",
  "TRIAL_ENTRY_NOT_AWAITING_CLARIFICATION",
  "TRIAL_ENTRY_NOT_AWAITING_BRIEF_APPROVAL",
  "TRIAL_ENTRY_CLARIFICATIONS_REMAIN",
  "CLARIFICATION_REQUIRED",
  "CLARIFICATION_ALREADY_RESOLVED",
  "BLOCKING_CLARIFICATIONS_REMAIN",
  "BRIEF_CHECKSUM_MISMATCH",
  "BRIEF_NOT_READY",
  "BRIEF_NOT_APPROVED",
  "BRIEF_APPROVAL_STALE",
  "BRIEF_REVISION_REQUIRED",
  "WORKFLOW_STATE_INVALID",
  "UNAPPROVED_REQUIREMENT_CHANGE",
  "WORKFLOW_TRANSITION_INVALID",
  "REQUIREMENTS_NOT_APPROVED",
  "REQUIREMENTS_CHECKSUM_MISMATCH",
  "DESIGN_NOT_SELECTED",
  "DESIGN_CHECKSUM_MISMATCH",
  "ARCHITECTURE_NOT_ACCEPTED",
  "QUALITY_GATES_INCOMPLETE",
  "KNOWN_ERRORS_REMAIN",
  "TASK_GRAPH_INVALID",
  "PROJECT_VERSION_IMMUTABLE",
  "PERSISTENCE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "AI_IDEMPOTENCY_CONFLICT",
  "PLANNING_STALE",
  "PLANNER_WORKFLOW_STATE_INVALID",
  "ARCHITECTURE_REVIEW_WORKFLOW_INVALID",
  "ARCHITECTURE_REVIEW_STALE",
  "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT",
  "ARCHITECTURE_REVIEW_EXHAUSTED",
  "ARCHITECTURE_REVIEW_ALREADY_EXISTS",
  "STALE_BEFORE_PROVIDER",
  "STALE_BEFORE_COMMIT",
  "IN_PROGRESS_DUPLICATE",
  "COMMITTED_REPLAY",
  "REJECTED_STALE",
  "ASSET_VERSION_STALE",
  "ASSET_CHECKSUM_MISMATCH",
  "ASSET_NOT_CURRENT",
  "DESIGN_CONTRACT_STALE",
]);

const NOT_FOUND_CODES = new Set([
  "PROJECT_NOT_FOUND",
  "TRIAL_ENTRY_PROJECT_NOT_FOUND",
  "TRIAL_ENTRY_CLARIFICATION_NOT_FOUND",
  "CLARIFICATION_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "PERSISTENCE_NOT_FOUND",
  "ASSET_NOT_FOUND",
]);

const VALIDATION_CODES = new Set([
  "WORKBENCH_REQUEST_INVALID",
  "WORKBENCH_REQUEST_TOO_LARGE",
  "INITIAL_REQUEST_TYPE_INVALID",
  "INITIAL_REQUEST_EMPTY",
  "INITIAL_REQUEST_ENCODING_INVALID",
  "INITIAL_REQUEST_TOO_LARGE",
  "TRIAL_ENTRY_ANSWERS_EMPTY",
  "TRIAL_ENTRY_QUESTION_NOT_FOUND",
  "TRIAL_ENTRY_INPUT_INVALID",
  "LEAD_INPUT_INVALID",
  "LEAD_ANALYSIS_INVALID",
  "LEAD_CLARIFICATION_LANGUAGE_INVALID",
  "DESIGN_INPUT_INVALID",
  "DESIGN_ADMISSION_FAILED",
  "IMAGE_SOURCE_PENDING",
  "AUTH_DECISION_PENDING",
  "DESIGN_DIRECTIONS_INVALID",
  "REQUIREMENT_CONTRADICTION",
  "REQUIRED_BUSINESS_DATA_MISSING",
  "UNSUPPORTED_BUSINESS_FACT",
  "USER_CONFIRMATION_REQUIRED",
  "PLACEHOLDER_NOT_APPROVED",
  "VALIDATION_FAILED",
  "PERSISTENCE_VALIDATION_FAILED",
  "DOCUMENT_UNKNOWN",
  "ABSOLUTE_PATH_REJECTED",
  "PATH_TRAVERSAL_REJECTED",
  "SCHEMA_VERSION_MISMATCH",
  "INTEGRITY_CHECK_FAILED",
  "RELEASE_INVALID",
  "PLANNING_PACKAGE_INVALID",
  "ARCHITECTURE_REVIEW_INPUT_INVALID",
  "ARCHITECTURE_REVIEW_BLOCKED",
  "ARCHITECTURE_REVIEW_CHANGES_REQUIRED",
  "CONTRACT_AUDIT_INPUT_INVALID",
  "CONTRACT_AUDIT_BLOCKED",
  "CONTRACT_AUDIT_CHANGES_REQUIRED",
  "CONTRACT_AUDIT_PREREQUISITE_REJECTED",
  "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED",
  "DATABASE_DECISION_MISSING",
  "DATABASE_NOT_APPROVED",
  "DATABASE_DECISION_STALE",
  "DATABASE_CONNECTION_MISSING",
  "DATABASE_CONNECTION_INVALID",
  "DATABASE_REQUIRED_BY_DATA_CONTRACT",
  "UNAPPROVED_DATABASE_DEPENDENCY",
  "PLANNING_ACCEPTANCE_STALE",
  "TASK_CONTRACT_MISSING",
  "TASK_CONTRACT_STALE",
  "TASK_CONTRACT_ESCALATION",
  "CONTRACT_PACKAGE_STALE",
  "CONTRACT_PACKAGE_INVALID",
  "ARCHITECTURE_BLOCKED",
  "CHANGESET_INVALID",
  "REDUCTION_FAILED",
  "INVARIANT_FAILED",
  "MIGRATION_AMBIGUOUS",
  "REJECTED_INVALID",
  "ASSET_BINDING_INVALID",
  "ASSET_CATEGORY_INVALID",
  "BRIEF_V3_SCHEMA_INVALID",
  "BRIEF_V3_INVARIANT_VIOLATION",
  "BRIEF_V3_CHANGESET_INVALID",
  "BRIEF_V3_UNKNOWN_TARGET",
  "BRIEF_V3_UNSUPPORTED_VALUE",
  "BRIEF_V3_INVALID_COMBINATION",
  "BRIEF_V3_DUPLICATE_TARGET",
  "BRIEF_V3_REDUCTION_INVALID",
  "BRIEF_V3_MIGRATION_INVALID",
  "BRIEF_V3_MIGRATION_AMBIGUOUS",
  "BRIEF_V3_IDENTITY_INVALID",
  "BRIEF_V3_IDENTITY_AMBIGUOUS",
]);

const PROVIDER_CODES = new Set([
  "LEAD_PROVIDER_FAILED",
  "LEAD_PROVIDER_TIMEOUT",
  "AI_OUTPUT_INVALID",
  "AI_OUTPUT_TRUNCATED",
  "AI_OUTPUT_REFUSED",
  "AI_OUTPUT_SCHEMA_MISMATCH",
  "AI_OUTPUT_NO_PARSED_OUTPUT",
  "AI_OUTPUT_DOMAIN_INVALID",
  "AI_STRUCTURED_PARSE_FAILED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_REQUEST_TIMEOUT",
  "AI_AUTHENTICATION_FAILED",
  "AI_MODEL_ACCESS_FAILED",
  "AI_CONFIGURATION_INVALID",
  "AI_REQUEST_INVALID",
  "AI_REQUEST_SCHEMA_INVALID",
  "AI_REQUEST_PARAMETER_UNSUPPORTED",
  "AI_NETWORK_ERROR",
  "AI_RETRY_EXHAUSTED",
  "AI_REQUEST_CANCELLED",
  "AI_CONCURRENCY_LIMIT_REACHED",
  "DESIGN_CONTEXT_CAPACITY_EXCEEDED",
  "TRIAL_ENTRY_AI_NOT_CONFIGURED",
  "PLANNER_PROVIDER_FAILED",
  "PLANNER_PROVIDER_TIMEOUT",
  "ARCHITECTURE_REVIEW_PROVIDER_FAILED",
  "CONTRACT_AUDIT_PROVIDER_FAILED",
  "CONTRACT_AUDIT_OUTPUT_INVALID",
  "CONTRACT_AUDIT_FINDING_CONTRADICTS_HOST_EVIDENCE",
  "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
  "PROVIDER_FAILED",
  "PROVIDER_REFUSED",
  "PROVIDER_INVALID_OUTPUT",
  "TRIAL_ENTRY_BRIEF_REVISION_V3_UNAVAILABLE",
  "ASSET_BINDING_SERVICE_UNAVAILABLE",
]);

const PERSISTENCE_CODES = new Set([
  "PERSISTENCE_PROVIDER_ERROR",
  "PERSISTENCE_DATABASE_URL_MISSING",
  "PERSISTENCE_DATABASE_URL_INVALID",
  "PERSISTENCE_CONFIGURATION_INVALID",
  "PERSISTENCE_UNSUPPORTED",
  "PERSISTENCE_COMMIT_AMBIGUOUS",
  "PLANNING_PERSISTENCE_FAILED",
  "PLANNING_LIFECYCLE_TRANSITION_FAILED",
  "ARCHITECTURE_REVIEW_PROJECTION_FAILED",
  "PERSISTENCE_FAILED",
  "ASSET_METADATA_READ_FAILED",
  "ASSET_METADATA_PERSIST_FAILED",
  "ASSET_STORAGE_FAILED",
]);

const SAFE_ERROR_CLASSES = new Set([
  "AiProviderError",
  "DomainError",
  "Error",
  "LeadError",
  "PersistenceConfigurationError",
  "PersistenceError",
  "WorkbenchActionError",
  "WorkbenchOperationFailure",
  "ArchitectureReviewError",
  "WorkbenchRequestValidationError",
  "ZodError",
  "StagedPlanningFailure",
  "BriefV3TransactionError",
  "BriefV3Error",
  "BriefV3ProviderError",
  "AssetIntakeError",
  "DesignError",
  "ContractAuditError",
  "Phase7CContractError",
  "OrchestratorError",
]);

export class WorkbenchRequestValidationError extends Error {
  name = "WorkbenchRequestValidationError";
  constructor(readonly zodError: z.ZodError, readonly unknownArrayFieldPaths: string[] = [], readonly action?: string) {
    super("WORKBENCH_REQUEST_INVALID: The request did not match the Workbench request contract.");
  }
}

/** Return only structural paths for unknown arrays; never retain field values. */
export function safeUnknownArrayFieldPaths(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const candidate = body as Record<string, unknown>;
  const allowedArrays = new Map<string, Set<string>>([
    ["respond", new Set(["answers"])],
    ["request-brief-changes", new Set(["requirementKeys", "assetBindings"])],
  ]);
  const allowed = allowedArrays.get(typeof candidate.action === "string" ? candidate.action : "") ?? new Set<string>();
  const paths: string[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    if (allowed.has(key) || !Array.isArray(value)) continue;
    for (let index = 0; index < Math.min(value.length, 5); index += 1) paths.push(`${key}[${index}]`);
  }
  return paths;
}

/** @deprecated Use safeUnknownArrayFieldPaths; retained for callers outside the route boundary. */
export const safeUnknownRespondArrayFieldPaths = safeUnknownArrayFieldPaths;

function operationForAction(action?: string): WorkbenchOperation {
  switch (action) {
    case "create": return "SUBMIT_TO_LEAD";
    case "respond": return "ANSWER_LEAD_CLARIFICATIONS";
    case "refresh-clarifications": return "REFRESH_LEAD_CLARIFICATIONS";
    case "status": return "READ_WORKBENCH_STATUS";
    case "list": return "LIST_WORKBENCH_PROJECTS";
    case "approve-brief": return "APPROVE_BRIEF";
    case "request-brief-changes": return "REQUEST_BRIEF_CHANGES";
    case "generate-planning": return "GENERATE_PLANNING";
    case "approve-planning": return "APPROVE_PLANNING";
    case "request-planning-changes": return "REQUEST_PLANNING_CHANGES";
    case "generate-architecture-review": return "GENERATE_ARCHITECTURE_REVIEW";
    case "generate-design": return "GENERATE_DESIGN";
    case "database-decision": return "DATABASE_DECISION";
    case "dependency-approval": return "DEPENDENCY_APPROVAL";
    case "run-contract-audit": return "RUN_CONTRACT_AUDIT";
    case "recover-contract-audit": return "RECOVER_CONTRACT_AUDIT";
    case "correct-contract-audit": return "CORRECT_CONTRACT_AUDIT";
    case "reassess-contract-audit": return "REASSESS_CONTRACT_AUDIT";
    case "approve-phase7c": return "APPROVE_PHASE7C";
    case "design-selection": return "DESIGN_SELECTION";
    case "start-implementation": return "START_IMPLEMENTATION";
    default: return "WORKBENCH_REQUEST";
  }
}

function errorClass(error: unknown) {
  if (error instanceof WorkbenchRequestValidationError) return "ZodError";
  const name = error instanceof Error ? error.name : "UnknownError";
  return SAFE_ERROR_CLASSES.has(name) ? name : "UnknownError";
}

function codeOf(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error) {
    const candidate = error.message.split(":", 1)[0];
    if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  return undefined;
}

function safePlanningAdmissionReason(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/\b(PLANNING_[A-Z0-9_]+)\b/);
  return match?.[1];
}

function providerStatus(code: string) {
  if (["AI_AUTHENTICATION_FAILED", "AI_CONFIGURATION_INVALID", "AI_MODEL_ACCESS_FAILED"].includes(code)) return { httpStatus: 503, recoverable: false };
  if (["AI_REQUEST_INVALID", "AI_REQUEST_SCHEMA_INVALID", "AI_REQUEST_PARAMETER_UNSUPPORTED"].includes(code)) return { httpStatus: 502, recoverable: false };
  if (["AI_OUTPUT_INVALID", "AI_OUTPUT_TRUNCATED", "AI_OUTPUT_REFUSED", "AI_OUTPUT_SCHEMA_MISMATCH", "AI_OUTPUT_NO_PARSED_OUTPUT", "AI_OUTPUT_DOMAIN_INVALID", "AI_STRUCTURED_PARSE_FAILED"].includes(code)) return { httpStatus: 502, recoverable: false };
  return { httpStatus: 503, recoverable: true };
}

function nestedAiProviderError(error: unknown, depth = 0): AiProviderError | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  if (isAiProviderError(error)) return error;
  return "cause" in error ? nestedAiProviderError(error.cause, depth + 1) : undefined;
}

function safeProviderDiagnosticValue(value: unknown): SafeProviderDiagnostic | undefined {
  const parsed = ProviderFailureDiagnosticSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const safe = { ...parsed.data };
  delete safe.safeProviderMessage;
  return SafeProviderDiagnosticSchema.safeParse(safe).success ? safe : undefined;
}

function safeProviderDiagnostic(error: unknown): SafeProviderDiagnostic | undefined {
  const durable = providerFailureDiagnosticFromError(error);
  if (durable) {
    return safeProviderDiagnosticValue(durable);
  }
  const nestedProviderError = nestedAiProviderError(error);
  const diagnostic: ProviderDiagnostic | undefined = nestedProviderError
    ? nestedProviderError.diagnostic
    : error && typeof error === "object" && "details" in error && error.details && typeof error.details === "object"
      ? {
          stage: "provider_normalization",
          requestAttempted: true,
          apiResponseReceived: true,
          outputStage: PROVIDER_OUTPUT_STAGES.includes((error.details as Record<string, unknown>).outputStage as ProviderOutputStage) ? (error.details as Record<string, unknown>).outputStage as ProviderOutputStage : undefined,
          schemaName: typeof (error.details as Record<string, unknown>).schemaName === "string" ? (error.details as Record<string, unknown>).schemaName as string : undefined,
          issueCode: typeof (error.details as Record<string, unknown>).issueCode === "string" ? (error.details as Record<string, unknown>).issueCode as string : undefined,
          fieldPath: typeof (error.details as Record<string, unknown>).fieldPath === "string" ? (error.details as Record<string, unknown>).fieldPath as string : undefined,
        }
      : undefined;
  if (!diagnostic) return undefined;
  const fieldPath = diagnostic.fieldPath && /^[A-Za-z][A-Za-z0-9_.\[\]]*$/.test(diagnostic.fieldPath) ? diagnostic.fieldPath : undefined;
  const issueCode = diagnostic.issueCode && /^[A-Z][A-Z0-9_]+$/.test(diagnostic.issueCode) ? diagnostic.issueCode : undefined;
  const schemaName = diagnostic.schemaName && /^[a-z0-9-]{1,100}$/.test(diagnostic.schemaName) ? diagnostic.schemaName : undefined;
  const outputStage = diagnostic.outputStage && PROVIDER_OUTPUT_STAGES.includes(diagnostic.outputStage) ? diagnostic.outputStage : undefined;
  const requestId = diagnostic.requestId && /^[A-Za-z0-9_-]{1,160}$/.test(diagnostic.requestId) ? diagnostic.requestId : undefined;
  const finishReason = diagnostic.finishReason === null || diagnostic.finishReason === undefined || /^[a-z_]{1,64}$/.test(diagnostic.finishReason) ? diagnostic.finishReason : undefined;
  return {
    ...(outputStage ? { outputStage } : {}),
    ...(schemaName ? { schemaName } : {}),
    ...(issueCode ? { issueCode } : {}),
    ...(fieldPath ? { fieldPath } : {}),
    ...(diagnostic.responseReceived !== undefined ? { responseReceived: diagnostic.responseReceived } : {}),
    ...(diagnostic.outputComplete !== undefined ? { outputComplete: diagnostic.outputComplete } : {}),
    ...(diagnostic.tokenExhaustion !== undefined ? { tokenExhaustion: diagnostic.tokenExhaustion } : {}),
    ...(requestId ? { requestId } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(diagnostic.inputTokens !== undefined && diagnostic.inputTokens >= 0 ? { inputTokens: diagnostic.inputTokens } : {}),
    ...(diagnostic.outputTokens !== undefined && diagnostic.outputTokens >= 0 ? { outputTokens: diagnostic.outputTokens } : {}),
    ...(diagnostic.maxCompletionTokens !== undefined && diagnostic.maxCompletionTokens >= 0 ? { maxCompletionTokens: diagnostic.maxCompletionTokens } : {}),
    ...(diagnostic.issueCount !== undefined ? { issueCount: Math.min(diagnostic.issueCount, 20) } : {}),
    ...(diagnostic.transportPhase ? { transportPhase: diagnostic.transportPhase } : {}),
    ...(diagnostic.transportFailureClass ? { transportFailureClass: diagnostic.transportFailureClass } : {}),
    ...(diagnostic.transportCauseCode ? { transportCauseCode: diagnostic.transportCauseCode } : {}),
    ...(diagnostic.endpointClass ? { endpointClass: diagnostic.endpointClass } : {}),
    ...(diagnostic.timeoutConfiguredMs !== undefined ? { timeoutConfiguredMs: diagnostic.timeoutConfiguredMs } : {}),
    ...(diagnostic.configuredMaxRetries !== undefined ? { configuredMaxRetries: diagnostic.configuredMaxRetries } : {}),
    ...(diagnostic.elapsedBucket ? { elapsedBucket: diagnostic.elapsedBucket } : {}),
    ...(diagnostic.requestSizeBytes !== undefined ? { requestSizeBytes: diagnostic.requestSizeBytes } : {}),
    ...(diagnostic.inputBytes !== undefined ? { inputBytes: diagnostic.inputBytes } : {}),
    ...(diagnostic.schemaSizeBytes !== undefined ? { schemaSizeBytes: diagnostic.schemaSizeBytes } : {}),
  };
}

function safeDesignAdmissionDiagnostic(error: unknown): DesignAdmissionDiagnostic | undefined {
  if (!error || typeof error !== "object" || !("admissionDiagnostic" in error)) return undefined;
  const parsed = DesignAdmissionDiagnosticSchema.safeParse((error as { admissionDiagnostic?: unknown }).admissionDiagnostic);
  return parsed.success ? parsed.data : undefined;
}

function safePersistenceDiagnostic(error: unknown, depth = 0): SafePersistenceDiagnostic | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const parsed = SafePersistenceDiagnosticSchema.safeParse((error as { diagnostic?: unknown }).diagnostic);
  if (parsed.success) return parsed.data;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : safePersistenceDiagnostic(cause, depth + 1);
}

function safeSourceCurrentness(error: unknown) {
  if (!error || typeof error !== "object" || !("diagnostic" in error)) return undefined;
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || !("sourceCurrentness" in diagnostic)) return undefined;
  const source = (diagnostic as { sourceCurrentness?: unknown }).sourceCurrentness;
  if (!source || typeof source !== "object") return undefined;
  const count = (source as { disallowedPathCount?: unknown }).disallowedPathCount;
  const paths = (source as { paths?: unknown }).paths;
  if (!Number.isInteger(count) || (count as number) < 0 || !Array.isArray(paths)) return undefined;
  const safePaths = paths.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\r\n\0]/.test(value)).slice(0, 8);
  return { disallowedPathCount: count as number, paths: safePaths };
}

const safeValidationPath = (path: PropertyKey[]) => path.map((segment) => typeof segment === "number" ? `[${segment}]` : String(segment)).join(".").replaceAll(".[", "[") || "request";
const safeRequestIssueCode = (issue: z.ZodIssue) => {
  if (issue.code === "custom" && issue.params && typeof issue.params === "object" && "issueCode" in issue.params && typeof issue.params.issueCode === "string") return issue.params.issueCode;
  if (issue.code === "custom") return issue.path.at(-1) === "questionId" ? "DUPLICATE_CLARIFICATION_ID" : "ANSWER_REQUIRED";
  if (issue.code === "invalid_type") return "INVALID_TYPE";
  if (issue.code === "invalid_format") return issue.path.at(-1) === "questionId" ? "INVALID_CLARIFICATION_ID" : "INVALID_FORMAT";
  if (issue.code === "too_small") return "TOO_FEW_ITEMS";
  if (issue.code === "too_big") return "VALUE_TOO_LARGE";
  if (issue.code === "unrecognized_keys") return "UNKNOWN_FIELD";
  if (issue.code === "invalid_value") return "INVALID_ENUM_OR_LITERAL";
  return "INVALID_FIELD";
};
const safeRequestExpectedShape = (issue: z.ZodIssue, action?: string) => {
  const path = safeValidationPath(issue.path);
  if (path === "answers") return "an array containing 1 to 40 answer objects";
  if (path.endsWith(".questionId")) return "a canonical clarification question ID in UUID format";
  if (path.endsWith(".answer")) return "non-whitespace text of at most 32768 characters when status is answered";
  if (path === "reason" && action === "request-brief-changes") return "a complete canonical Brief revision instruction of at most 131072 UTF-8 bytes";
  if (path === "reason" && action === "request-planning-changes") return "a planning revision reason of at most 4000 characters";
  if (path === "reason") return "a bounded reason appropriate to the requested workflow action";
  if (path === "projectId") return "a project ID in UUID format";
  if (path === "action") return "the literal action respond";
  if (issue.code === "unrecognized_keys") return "only fields defined by the Workbench request contract";
  return "the Workbench respond request contract";
};
const safeRequestValidationProjection = (error: z.ZodError, unknownArrayFieldPaths: string[] = [], action?: string): SafeValidationProjection => {
  const hintedIssues = unknownArrayFieldPaths.map((path) => ({ path, issueCode: "UNKNOWN_FIELD", expectedShape: "only fields defined by the Workbench request contract" }));
  const structuralIssues = error.issues
    .filter((issue) => !(issue.code === "unrecognized_keys" && unknownArrayFieldPaths.length))
    .map((issue) => ({ path: safeValidationPath(issue.path), issueCode: safeRequestIssueCode(issue), expectedShape: safeRequestExpectedShape(issue, action) }));
  const validationIssues = [...hintedIssues, ...structuralIssues].filter((issue, index, all) => all.findIndex((candidate) => candidate.path === issue.path && candidate.issueCode === issue.issueCode) === index).slice(0, 5);
  const first = validationIssues[0];
  return { validationStage: "REQUEST_SCHEMA", ...(first ? { issueCode: first.issueCode, fieldPath: first.path, expectedShape: first.expectedShape } : {}), validationIssues };
};

function safeValidationProjection(error: unknown): SafeValidationProjection {
  if (error instanceof WorkbenchRequestValidationError) return safeRequestValidationProjection(error.zodError, error.unknownArrayFieldPaths, error.action);
  if (error instanceof z.ZodError) return safeRequestValidationProjection(error);
  if (!error || typeof error !== "object" || !("details" in error)) return {};
  const details = error.details;
  if (!details || typeof details !== "object") return {};
  const safeDetails = details as Record<string, unknown>;
  const stage = safeDetails.validationStage;
  const issueCode = safeDetails.issueCode;
  const fieldPath = safeDetails.fieldPath;
  const expectedShape = safeDetails.expectedShape;
  return {
    ...(stage === "REQUEST_SCHEMA" || stage === "ANALYSIS_SCHEMA" || stage === "ANALYSIS_SEMANTIC" || stage === "CLARIFICATION_MAPPING" ? { validationStage: stage } : {}),
    ...(typeof issueCode === "string" && /^[A-Z][A-Z0-9_]+$/.test(issueCode) ? { issueCode } : {}),
    ...(typeof fieldPath === "string" && /^[A-Za-z][A-Za-z0-9_.\[\]]*$/.test(fieldPath) ? { fieldPath } : {}),
    ...(typeof expectedShape === "string" && expectedShape.length <= 160 ? { expectedShape } : {}),
  };
}

function stagedFailureProjection(error: unknown): Omit<WorkbenchErrorProjection, "ok" | "code" | "correlationId" | "operation"> | undefined {
  if (!isStagedPlanningFailure(error)) return undefined;
  const operationParsed = StagedPlanningOperationSummarySchema.safeParse(error.details.operation);
  const operation = operationParsed.success ? operationParsed.data : undefined;
  const providerFailure = ["PROVIDER_SCHEMA_ADHERENCE_FAILURE", "PROVIDER_STRUCTURED_OUTPUT_FAILURE", "PROVIDER_TRANSPORT_FAILURE"].includes(error.details.failureClass);
  const currentnessFailure = error.details.failureClass === "STAGED_CURRENTNESS_FAILURE";
  const persistenceFailure = error.details.failureClass === "RUNTIME_PERSISTENCE_FAILURE";
  const status = persistenceFailure ? 503 : currentnessFailure ? 409 : providerFailure ? (error.details.failureClass === "PROVIDER_TRANSPORT_FAILURE" ? 503 : 502) : 422;
  const category = persistenceFailure ? "PERSISTENCE" as const : currentnessFailure ? "WORKFLOW_CONFLICT" as const : providerFailure ? "PROVIDER" as const : "VALIDATION" as const;
  const subsystem = persistenceFailure ? "PERSISTENCE" as const : providerFailure ? "PROVIDER" as const : "WORKBENCH_APPLICATION" as const;
  return {
    error: "Staged Planning could not be completed. The project was not changed.",
    httpStatus: status,
    recoverable: currentnessFailure || error.details.failureClass === "PROVIDER_TRANSPORT_FAILURE",
    category,
    subsystem,
    errorClass: errorClass(error),
    failureClass: error.details.failureClass,
    stage: error.details.stage,
    ...(error.details.boundary ? { boundary: error.details.boundary } : {}),
    ...(error.details.reasonCode ? { reasonCode: error.details.reasonCode } : {}),
    ...(error.details.safeToken ? { safeToken: error.details.safeToken } : {}),
    ...(error.details.kindDomainDiagnostics ? { kindDomainDiagnostics: error.details.kindDomainDiagnostics } : {}),
    ...(error.details.minimumDiagnostics ? { minimumDiagnostics: error.details.minimumDiagnostics } : {}),
    ...(error.details.graphCycleDiagnostics ? { graphCycleDiagnostics: error.details.graphCycleDiagnostics } : {}),
    ...(error.details.coverageDiagnostics ? { coverageDiagnostics: error.details.coverageDiagnostics } : {}),
    ...(error.details.representabilityAnchorDiagnostics ? { representabilityAnchorDiagnostics: error.details.representabilityAnchorDiagnostics } : {}),
    ...(error.details.finalAdmissionDiagnostics ? { finalAdmissionDiagnostics: error.details.finalAdmissionDiagnostics } : {}),
    ...(error.details.admissionDiagnostics ? { admissionDiagnostics: error.details.admissionDiagnostics } : {}),
    ...(error.details.providerTermination ? { providerTermination: error.details.providerTermination } : {}),
    providerRequestCountExact: error.details.providerRequestCountExact,
    providerRequestCount: error.details.providerRequestCount,
    ...(operation ? { stagedOperation: operation } : {}),
    ...(safeProviderDiagnostic(error) ? { providerDiagnostic: safeProviderDiagnostic(error) } : {}),
  };
}

function operationFailureProjection(error: WorkbenchOperationFailure): Omit<WorkbenchErrorProjection, "ok" | "code" | "correlationId" | "operation"> {
  const details = error.details;
  const cause = error.cause;
  const staged = stagedFailureProjection(cause);
  const base = staged ?? definitionFor(details.outerCode, cause);
  const durableProviderDiagnostic = details.providerDiagnostic ? safeProviderDiagnosticValue(details.providerDiagnostic) : undefined;
  return {
    ...base,
    error: details.canonicalPlanningPersisted || details.canonicalArchitecturePersisted || details.lifecycleMutated ? error.message : base.error,
    errorClass: errorClass(cause),
    operationId: details.operationId,
    ...(details.attemptId ? { attemptId: details.attemptId } : {}),
    operationKind: details.operationKind,
    projectId: details.projectId,
    phase: details.phase,
    operationStage: details.operationStage,
    failureClass: staged?.failureClass ?? details.failureClass as WorkbenchErrorProjection["failureClass"],
    stage: staged?.stage ?? details.operationStage,
    outerCode: details.outerCode,
    ...(details.boundary ? { boundary: details.boundary } : {}),
    safeErrorFingerprint: details.safeErrorFingerprint,
    providerCallsTotal: details.providerCallsTotal,
    providerCallsByStage: details.providerCallsByStage as WorkbenchErrorProjection["providerCallsByStage"],
    providerRequestCountExact: true,
    providerRequestCount: details.providerCallsTotal,
    ...(details.providerContract ? { providerContract: details.providerContract } : {}),
    ...(durableProviderDiagnostic ? { providerDiagnostic: durableProviderDiagnostic } : {}),
    ...(safePersistenceDiagnostic(cause) ? { persistenceDiagnostic: safePersistenceDiagnostic(cause) } : {}),
    ...(details.providerInvocationState ? { providerInvocationState: details.providerInvocationState } : {}),
    canonicalPlanningPersisted: details.canonicalPlanningPersisted,
    ...(details.canonicalArchitecturePersisted !== undefined ? { canonicalArchitecturePersisted: details.canonicalArchitecturePersisted } : {}),
    lifecycleMutated: details.lifecycleMutated,
    ...(details.reasonCode ? { reasonCode: details.reasonCode } : {}),
    ...(details.kindDomainDiagnostics ? { kindDomainDiagnostics: details.kindDomainDiagnostics } : {}),
    ...(details.minimumDiagnostics ? { minimumDiagnostics: details.minimumDiagnostics } : {}),
    ...(details.graphCycleDiagnostics ? { graphCycleDiagnostics: details.graphCycleDiagnostics } : {}),
    ...(details.coverageDiagnostics ? { coverageDiagnostics: details.coverageDiagnostics } : {}),
    ...(details.representabilityAnchorDiagnostics ? { representabilityAnchorDiagnostics: details.representabilityAnchorDiagnostics } : {}),
    ...(details.finalAdmissionDiagnostics ? { finalAdmissionDiagnostics: details.finalAdmissionDiagnostics } : {}),
    ...(details.admissionDiagnostics ? { admissionDiagnostics: details.admissionDiagnostics } : {}),
    ...(details.providerTermination ? { providerTermination: details.providerTermination } : {}),
    internalClassification: details.internalClassification,
    ...(details.stagedOperation ? { stagedOperation: details.stagedOperation } : staged?.stagedOperation ? { stagedOperation: staged.stagedOperation } : {}),
    responseOrigin: details.responseOrigin,
    attemptCreated: details.attemptCreated,
    ...(details.attemptStatus ? { attemptStatus: details.attemptStatus } : {}),
    runtimeProvenance: details.runtimeProvenance,
    ...(details.attemptHistory ? { attemptHistory: details.attemptHistory } : {}),
  };
}

function definitionFor(code: string, error: unknown, action?: string): Omit<WorkbenchErrorProjection, "ok" | "code" | "correlationId" | "operation"> {
  const staged = stagedFailureProjection(error);
  if (staged) return staged;
  if (action === "correct-contract-audit" && error instanceof OrchestratorError && code === error.code) {
    const stale = code.endsWith("_STALE") || code.endsWith("_CHECKSUM_MISMATCH") || code === "ORCHESTRATOR_WORKFLOW_STATE_INVALID";
    return { error: "Contract Audit correction did not satisfy the current orchestration contract. The project was not changed.", httpStatus: stale ? 409 : 422, recoverable: false, category: stale ? "WORKFLOW_CONFLICT" : "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  }
  if (code === "WORKBENCH_REQUEST_TOO_LARGE") return { error: "The request is too large.", httpStatus: 413, recoverable: false, category: "VALIDATION", subsystem: "ROUTE", errorClass: errorClass(error) };
  if (code === "WORKBENCH_REQUEST_INVALID") {
    const validation = safeValidationProjection(error);
    const briefRevisionTooLarge = error instanceof WorkbenchRequestValidationError && error.action === "request-brief-changes" && validation.validationStage === "REQUEST_SCHEMA" && validation.fieldPath === "reason" && validation.issueCode === "VALUE_TOO_LARGE";
    return { error: briefRevisionTooLarge ? "The requested Brief changes are too long for one revision request." : "The request could not be validated.", httpStatus: 400, recoverable: false, category: "VALIDATION", subsystem: "ROUTE", errorClass: errorClass(error), ...validation };
  }
  if (code === "LEAD_CLARIFICATION_LANGUAGE_INVALID") return { error: "Lead refresh output did not match the Factory operator language. The project was not changed.", httpStatus: 422, recoverable: true, category: "VALIDATION", subsystem: "LEAD", errorClass: errorClass(error) };
  if (code === "LEAD_ANALYSIS_INVALID") return { error: "Lead analysis did not match the current project contract. The project was not changed.", httpStatus: 422, recoverable: Boolean(safeValidationProjection(error).validationStage), category: "VALIDATION", subsystem: "LEAD", errorClass: errorClass(error), ...safeValidationProjection(error) };
  if (code === "WORKBENCH_ADVANCED_RUNTIME_UNAVAILABLE") return { error: "The workflow runtime is temporarily unavailable. The project was not changed.", httpStatus: 503, recoverable: true, category: "INTERNAL", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  if (code === "DESIGN_CONTRACT_STALE") {
    const sourceCurrentness = safeSourceCurrentness(error);
    return { error: "The Design source or canonical contract is stale. The project was not changed.", httpStatus: 409, recoverable: true, category: "WORKFLOW_CONFLICT", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), ...(sourceCurrentness ? { reasonCode: "DESIGN_SOURCE_CURRENTNESS_FAILED", sourceCurrentness } : {}) };
  }
  if (code === "DESIGN_SETUP_FAILED") return { error: "Design setup failed before provider invocation. The project was not changed.", httpStatus: 503, recoverable: true, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: "DESIGN_PRE_PROVIDER_SETUP_FAILED" };
  if (code === "DESIGN_CONTEXT_CAPACITY_EXCEEDED") return { error: "The Design request exceeded its bounded context envelope before provider invocation. The project was not changed.", httpStatus: 422, recoverable: true, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: "AI_REQUEST_CONTEXT_CAPACITY_EXCEEDED", ...(safeProviderDiagnostic(error) ? { providerDiagnostic: safeProviderDiagnostic(error) } : {}) };
  if (code === "DESIGN_ADMISSION_FAILED") {
    const diagnostic = safeDesignAdmissionDiagnostic(error);
    return { error: "The Design provider response was received, but host-owned professional Design admission did not complete. The project was not changed.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: diagnostic?.innerPredicate ?? diagnostic?.code ?? "DESIGN_ADMISSION_FAILED", ...(diagnostic ? { designAdmissionDiagnostic: diagnostic } : {}) };
  }
  if (code === "DESIGN_OUTCOME_UNKNOWN_REQUIRES_AUTHORIZATION") return { error: "The previous Design provider outcome is unknown. Explicit fresh-attempt authority is required before another provider call.", httpStatus: 409, recoverable: false, category: "WORKFLOW_CONFLICT", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: "OUTCOME_UNKNOWN" };
  if (code === "DESIGN_OUTCOME_UNKNOWN") return { error: "The previous Design provider outcome is unknown and cannot be retried without explicit fresh-attempt authority. The project was not changed.", httpStatus: 409, recoverable: false, category: "WORKFLOW_CONFLICT", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: "OUTCOME_UNKNOWN" };
  if (code === "DESIGN_INPUT_INVALID") return { error: "The host-owned Design inputs did not match the current strict contract. The project was not changed.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  if (["CONTRACT_AUDIT_INPUT_INVALID", "CONTRACT_AUDIT_BLOCKED", "CONTRACT_AUDIT_CHANGES_REQUIRED", "CONTRACT_AUDIT_PREREQUISITE_REJECTED"].includes(code)) return { error: "The current Contract Audit evidence did not satisfy the guarded prerequisite contract. The project was not advanced to implementation.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  if (code === "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED") return { error: "The current Contract Audit requires an upstream artifact correction; TaskGraph correction is not eligible. The project was not changed.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), reasonCode: code };
  if (["CONTRACT_AUDIT_PROVIDER_FAILED", "CONTRACT_AUDIT_OUTPUT_INVALID", "CONTRACT_AUDIT_FINDING_CONTRADICTS_HOST_EVIDENCE"].includes(code)) {
    const diagnostic = safeProviderDiagnostic(error);
    const reasonCode = diagnostic?.errorCode ?? diagnostic?.providerErrorCode ?? (diagnostic?.requestAttempted === false ? "CONTRACT_AUDIT_PRE_PROVIDER_FAILURE" : undefined);
    return { error: "The Contract Audit provider could not complete this prerequisite. The project was not advanced to implementation.", httpStatus: code === "CONTRACT_AUDIT_PROVIDER_FAILED" ? 503 : 502, recoverable: false, category: "PROVIDER", subsystem: "PROVIDER", errorClass: errorClass(error), providerContract: "contract-audit", ...(reasonCode || code === "CONTRACT_AUDIT_FINDING_CONTRADICTS_HOST_EVIDENCE" ? { reasonCode: reasonCode ?? code } : {}), ...(diagnostic ? { providerDiagnostic: diagnostic } : {}) };
  }
  if (["ARCHITECTURE_REVIEW_PROVIDER_FAILED", "ARCHITECTURE_REVIEW_OUTPUT_INVALID"].includes(code)) {
    return { error: "The Architecture Review provider could not complete this request. The project was not changed.", httpStatus: code === "ARCHITECTURE_REVIEW_OUTPUT_INVALID" ? 502 : 503, recoverable: false, category: "PROVIDER", subsystem: "PROVIDER", errorClass: errorClass(error), ...(safeProviderDiagnostic(error) ? { providerDiagnostic: safeProviderDiagnostic(error) } : {}) };
  }
  if (["PROVIDER_FAILED", "PROVIDER_REFUSED", "PROVIDER_INVALID_OUTPUT", "TRIAL_ENTRY_BRIEF_REVISION_V3_UNAVAILABLE"].includes(code)) {
    const status = code === "PROVIDER_INVALID_OUTPUT" || code === "PROVIDER_REFUSED" ? 502 : 503;
    return { error: "The Brief revision provider could not complete this request. The project was not changed.", httpStatus: status, recoverable: code === "PROVIDER_FAILED" || code === "TRIAL_ENTRY_BRIEF_REVISION_V3_UNAVAILABLE", category: "PROVIDER", subsystem: "PROVIDER", errorClass: errorClass(error), providerContract: "brief-revision-v3", ...(safeProviderDiagnostic(error) ? { providerDiagnostic: safeProviderDiagnostic(error) } : {}) };
  }
  if (["ARCHITECTURE_REVIEW_INPUT_INVALID", "ARCHITECTURE_REVIEW_BLOCKED", "ARCHITECTURE_REVIEW_CHANGES_REQUIRED"].includes(code)) return { error: "The current Architecture Review evidence did not satisfy the canonical review contract. The project was not changed.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  if (code === "ARCHITECTURE_BLOCKED") return { error: "Planning approval is blocked by deterministic admission diagnostics. The project was not changed.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error), ...(safePlanningAdmissionReason(error) ? { reasonCode: safePlanningAdmissionReason(error) } : {}) };
  if (NOT_FOUND_CODES.has(code)) return { error: "The requested project or workflow resource was not found.", httpStatus: 404, recoverable: false, category: "VALIDATION", subsystem: code === "PROJECT_NOT_FOUND" ? "WORKBENCH_APPLICATION" : code.startsWith("PERSISTENCE_") || code === "DOCUMENT_NOT_FOUND" ? "PERSISTENCE" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  if (CONFLICT_CODES.has(code)) return { error: "The project changed or the requested workflow action is no longer current.", httpStatus: 409, recoverable: true, category: "WORKFLOW_CONFLICT", subsystem: code.startsWith("WORKBENCH_") ? "WORKBENCH_APPLICATION" : code.startsWith("PERSISTENCE_") || code === "IDEMPOTENCY_CONFLICT" ? "PERSISTENCE" : code.startsWith("AI_") ? "PROVIDER" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  if (PROVIDER_CODES.has(code)) {
    const status = providerStatus(code);
    return { error: "The Lead service could not complete this request. The project was not changed.", ...status, category: "PROVIDER", subsystem: "PROVIDER", errorClass: errorClass(error), ...(safeProviderDiagnostic(error) ? { providerDiagnostic: safeProviderDiagnostic(error) } : {}) };
  }
  if (code === "PERSISTENCE_COMMIT_AMBIGUOUS") return { error: "The database commit outcome could not be confirmed. Inspect the current project state before retrying.", httpStatus: 503, recoverable: true, category: "PERSISTENCE", subsystem: "PERSISTENCE", errorClass: errorClass(error), ...(safePersistenceDiagnostic(error) ? { persistenceDiagnostic: safePersistenceDiagnostic(error) } : {}) };
  if (PERSISTENCE_CODES.has(code)) return { error: "The project could not be saved safely. The project was not changed.", httpStatus: 503, recoverable: true, category: "PERSISTENCE", subsystem: "PERSISTENCE", errorClass: errorClass(error), ...(safePersistenceDiagnostic(error) ? { persistenceDiagnostic: safePersistenceDiagnostic(error) } : {}) };
  if (VALIDATION_CODES.has(code)) return { error: "The request could not be completed because its workflow data was invalid.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: code.startsWith("PERSISTENCE_") ? "PERSISTENCE" : code.startsWith("LEAD_") ? "LEAD" : code.startsWith("INITIAL_") ? "ROUTE" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  return { error: "We couldn't complete this request. The project was not changed.", httpStatus: 500, recoverable: false, category: "INTERNAL", subsystem: "ROUTE", errorClass: errorClass(error), internalClassification: "UNEXPECTED_EXCEPTION" };
}

export function normalizeWorkbenchError(error: unknown, context: WorkbenchDiagnosticContext = {}): WorkbenchErrorProjection {
  const runtimeProvenance = context.runtimeProvenance ?? currentRuntimeProvenance();
  if (isWorkbenchOperationFailure(error)) {
    const operationProjection = operationFailureProjection(error);
    return {
      ok: false,
      code: error.details.outerCode,
      correlationId: context.correlationId && z.string().uuid().safeParse(context.correlationId).success ? context.correlationId : error.details.correlationId,
      operation: context.operation ?? operationForAction(context.action),
      runtimeProvenance,
      ...operationProjection,
      ...(context.requestTransport ? { requestTransport: context.requestTransport } : {}),
    };
  }
  const code = error instanceof WorkbenchRequestValidationError || error instanceof z.ZodError ? "WORKBENCH_REQUEST_INVALID" : codeOf(error);
  const knownCode = code && ((context.action === "correct-contract-audit" && error instanceof OrchestratorError) || CONFLICT_CODES.has(code) || NOT_FOUND_CODES.has(code) || VALIDATION_CODES.has(code) || PROVIDER_CODES.has(code) || PERSISTENCE_CODES.has(code) || code === "WORKBENCH_REQUEST_INVALID" || code === "WORKBENCH_REQUEST_TOO_LARGE" || code === "WORKBENCH_ADVANCED_RUNTIME_UNAVAILABLE" || isStagedPlanningFailure(error)) ? code : undefined;
  const projection = definitionFor(knownCode ?? "WORKBENCH_INTERNAL_ERROR", error, context.action);
  const operation = context.operation ?? operationForAction(context.action);
  const errorCorrelationId = isStagedPlanningFailure(error) ? error.details.operation.correlationId : undefined;
  return {
    ok: false,
    code: knownCode ?? "WORKBENCH_INTERNAL_ERROR",
    correlationId: context.correlationId && z.string().uuid().safeParse(context.correlationId).success ? context.correlationId : errorCorrelationId ?? randomUUID(),
    operation,
    responseOrigin: context.responseMetadata?.responseOrigin ?? (code === "WORKBENCH_OPERATION_IN_PROGRESS" ? "IDEMPOTENT_ACTIVE" : code === "WORKBENCH_OPERATION_REPLAY" ? "IDEMPOTENT_SUCCESS" : "PREFLIGHT_REJECTION"),
    attemptCreated: context.responseMetadata?.attemptCreated ?? false,
    ...(context.responseMetadata?.operationId ? { operationId: context.responseMetadata.operationId } : {}),
    ...(context.responseMetadata?.attemptId ? { attemptId: context.responseMetadata.attemptId } : {}),
    ...(context.responseMetadata?.attemptStatus ? { attemptStatus: context.responseMetadata.attemptStatus } : {}),
    runtimeProvenance,
    ...projection,
    ...(context.requestTransport ? { requestTransport: context.requestTransport } : {}),
  };
}

export function diagnosticEventFor(projection: WorkbenchErrorProjection, context: WorkbenchDiagnosticContext = {}): WorkbenchDiagnosticEvent {
  return {
    type: "workbench.operation.failed",
    timestamp: new Date().toISOString(),
    correlationId: projection.correlationId,
    operation: projection.operation,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(projection.operationId ? { operationId: projection.operationId } : {}),
    ...(projection.attemptId ? { attemptId: projection.attemptId } : {}),
    ...(projection.operationKind ? { operationKind: projection.operationKind } : {}),
    ...(projection.phase ? { phase: projection.phase } : {}),
    ...(projection.operationStage ? { operationStage: projection.operationStage } : {}),
    ...(context.workflowState ? { workflowState: context.workflowState } : {}),
    code: projection.code,
    category: projection.category,
    subsystem: projection.subsystem,
    errorClass: projection.errorClass,
    recoverable: projection.recoverable,
    ...(projection.failureClass ? { failureClass: projection.failureClass } : {}),
    ...(projection.stage ? { stage: projection.stage } : {}),
    ...(projection.outerCode ? { outerCode: projection.outerCode } : {}),
    ...(projection.boundary ? { boundary: projection.boundary } : {}),
    ...(projection.reasonCode ? { reasonCode: projection.reasonCode } : {}),
    ...(projection.safeToken ? { safeToken: projection.safeToken } : {}),
    ...(projection.kindDomainDiagnostics ? { kindDomainDiagnostics: projection.kindDomainDiagnostics } : {}),
    ...(projection.minimumDiagnostics ? { minimumDiagnostics: projection.minimumDiagnostics } : {}),
    ...(projection.graphCycleDiagnostics ? { graphCycleDiagnostics: projection.graphCycleDiagnostics } : {}),
    ...(projection.coverageDiagnostics ? { coverageDiagnostics: projection.coverageDiagnostics } : {}),
    ...(projection.representabilityAnchorDiagnostics ? { representabilityAnchorDiagnostics: projection.representabilityAnchorDiagnostics } : {}),
    ...(projection.finalAdmissionDiagnostics ? { finalAdmissionDiagnostics: projection.finalAdmissionDiagnostics } : {}),
    ...(projection.admissionDiagnostics ? { admissionDiagnostics: projection.admissionDiagnostics } : {}),
    ...(projection.providerTermination ? { providerTermination: projection.providerTermination } : {}),
    ...(projection.safeErrorFingerprint ? { safeErrorFingerprint: projection.safeErrorFingerprint } : {}),
    ...(projection.requestTransport ? { requestTransport: projection.requestTransport } : {}),
    ...(projection.providerContract ? { providerContract: projection.providerContract } : {}),
    ...(projection.providerDiagnostic && SafeProviderDiagnosticSchema.safeParse(projection.providerDiagnostic).success ? { providerDiagnostic: projection.providerDiagnostic } : {}),
    ...(projection.designAdmissionDiagnostic && DesignAdmissionDiagnosticSchema.safeParse(projection.designAdmissionDiagnostic).success ? { designAdmissionDiagnostic: projection.designAdmissionDiagnostic } : {}),
    ...(projection.persistenceDiagnostic && SafePersistenceDiagnosticSchema.safeParse(projection.persistenceDiagnostic).success ? { persistenceDiagnostic: projection.persistenceDiagnostic } : {}),
    ...(projection.providerCallsTotal !== undefined ? { providerCallsTotal: projection.providerCallsTotal } : {}),
    ...(projection.providerCallsByStage ? { providerCallsByStage: projection.providerCallsByStage } : {}),
    ...(projection.providerInvocationState ? { providerInvocationState: projection.providerInvocationState } : {}),
    ...(projection.canonicalPlanningPersisted !== undefined ? { canonicalPlanningPersisted: projection.canonicalPlanningPersisted } : {}),
    ...(projection.canonicalArchitecturePersisted !== undefined ? { canonicalArchitecturePersisted: projection.canonicalArchitecturePersisted } : {}),
    ...(projection.lifecycleMutated !== undefined ? { lifecycleMutated: projection.lifecycleMutated } : {}),
    ...(projection.providerRequestCountExact !== undefined ? { providerRequestCountExact: projection.providerRequestCountExact } : {}),
    ...(projection.providerRequestCount !== undefined ? { providerRequestCount: projection.providerRequestCount } : {}),
    ...(projection.internalClassification ? { internalClassification: projection.internalClassification } : {}),
    ...(projection.stagedOperation ? {
      stagedOperation: projection.stagedOperation,
      projectId: projection.stagedOperation.projectId,
    } : {}),
    ...(projection.responseOrigin ? { responseOrigin: projection.responseOrigin } : {}),
    ...(projection.attemptCreated !== undefined ? { attemptCreated: projection.attemptCreated } : {}),
    ...(projection.attemptStatus ? { attemptStatus: projection.attemptStatus } : {}),
    ...(projection.runtimeProvenance ? { runtimeProvenance: projection.runtimeProvenance } : {}),
    ...(projection.validationStage ? { validationStage: projection.validationStage } : {}),
    ...(projection.issueCode ? { issueCode: projection.issueCode } : {}),
    ...(projection.fieldPath ? { fieldPath: projection.fieldPath } : {}),
    ...(projection.expectedShape ? { expectedShape: projection.expectedShape } : {}),
    ...(projection.validationIssues ? { validationIssues: projection.validationIssues } : {}),
    ...(projection.providerDiagnostic?.outputStage ? { outputStage: projection.providerDiagnostic.outputStage } : {}),
    ...(projection.providerDiagnostic?.schemaName ? { schemaName: projection.providerDiagnostic.schemaName } : {}),
    ...(projection.providerDiagnostic?.issueCode ? { providerIssueCode: projection.providerDiagnostic.issueCode } : {}),
    ...(projection.providerDiagnostic?.fieldPath ? { providerFieldPath: projection.providerDiagnostic.fieldPath } : {}),
    ...(projection.providerDiagnostic?.responseReceived !== undefined ? { responseReceived: projection.providerDiagnostic.responseReceived } : {}),
    ...(projection.providerDiagnostic?.outputComplete !== undefined ? { outputComplete: projection.providerDiagnostic.outputComplete } : {}),
    ...(projection.providerDiagnostic?.tokenExhaustion !== undefined ? { tokenExhaustion: projection.providerDiagnostic.tokenExhaustion } : {}),
    ...(projection.providerDiagnostic?.requestId ? { providerRequestId: projection.providerDiagnostic.requestId } : {}),
    ...(projection.providerDiagnostic?.finishReason !== undefined ? { finishReason: projection.providerDiagnostic.finishReason } : {}),
    ...(projection.providerDiagnostic?.inputTokens !== undefined ? { inputTokens: projection.providerDiagnostic.inputTokens } : {}),
    ...(projection.providerDiagnostic?.outputTokens !== undefined ? { outputTokens: projection.providerDiagnostic.outputTokens } : {}),
    ...(projection.providerDiagnostic?.maxCompletionTokens !== undefined ? { maxCompletionTokens: projection.providerDiagnostic.maxCompletionTokens } : {}),
    ...(projection.providerDiagnostic?.issueCount !== undefined ? { providerIssueCount: projection.providerDiagnostic.issueCount } : {}),
    ...(projection.providerDiagnostic ? { providerDiagnostic: projection.providerDiagnostic } : {}),
    ...(projection.designAdmissionDiagnostic ? { designAdmissionDiagnostic: projection.designAdmissionDiagnostic } : {}),
    ...(projection.persistenceDiagnostic ? { persistenceDiagnostic: projection.persistenceDiagnostic } : {}),
    ...(projection.sourceCurrentness ? { sourceCurrentness: projection.sourceCurrentness } : {}),
  };
}

const diagnosticEvents: WorkbenchDiagnosticEvent[] = [];
const MAX_DIAGNOSTIC_EVENTS = 100;

export function emitWorkbenchDiagnostic(event: WorkbenchDiagnosticEvent) {
  diagnosticEvents.push(event);
  if (diagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) diagnosticEvents.shift();
  console.error(`[workbench-diagnostic] ${JSON.stringify(event)}`);
}

export function getWorkbenchDiagnosticEvents() {
  return diagnosticEvents.map((event) => ({ ...event }));
}

export function clearWorkbenchDiagnosticEvents() {
  diagnosticEvents.length = 0;
}

export function workbenchFailureResponse(error: unknown, context: WorkbenchDiagnosticContext = {}) {
  let projection: WorkbenchErrorProjection;
  try {
    projection = normalizeWorkbenchError(error, context);
  } catch {
    projection = {
      ok: false,
      error: "We couldn't complete this request. The project was not changed.",
      code: "WORKBENCH_INTERNAL_ERROR",
      correlationId: context.correlationId && z.string().uuid().safeParse(context.correlationId).success ? context.correlationId : randomUUID(),
      operation: context.operation ?? operationForAction(context.action),
      recoverable: false,
      category: "INTERNAL",
      subsystem: "ROUTE",
      errorClass: "UnknownError",
      internalClassification: "UNEXPECTED_EXCEPTION",
      responseOrigin: "PREFLIGHT_REJECTION",
      attemptCreated: false,
      runtimeProvenance: context.runtimeProvenance ?? currentRuntimeProvenance(),
      httpStatus: 500,
    };
  }
  try { emitWorkbenchDiagnostic(diagnosticEventFor(projection, context)); } catch { /* diagnostics are best effort and never change the response */ }
  const responseInput = {
    ok: projection.ok,
    error: projection.error,
    code: projection.code,
    correlationId: projection.correlationId,
    operation: projection.operation,
    recoverable: projection.recoverable,
    category: projection.category,
    ...(projection.validationStage ? { validationStage: projection.validationStage } : {}),
    ...(projection.issueCode ? { issueCode: projection.issueCode } : {}),
    ...(projection.fieldPath ? { fieldPath: projection.fieldPath } : {}),
    ...(projection.expectedShape ? { expectedShape: projection.expectedShape } : {}),
    ...(projection.validationIssues ? { validationIssues: projection.validationIssues } : {}),
    ...(projection.operationId ? { operationId: projection.operationId } : {}),
    ...(projection.attemptId ? { attemptId: projection.attemptId } : {}),
    ...(projection.operationKind ? { operationKind: projection.operationKind } : {}),
    ...(projection.projectId ? { projectId: projection.projectId } : {}),
    ...(projection.phase ? { phase: projection.phase } : {}),
    ...(projection.operationStage ? { operationStage: projection.operationStage } : {}),
    ...(projection.failureClass ? { failureClass: projection.failureClass } : {}),
    ...(projection.stage ? { stage: projection.stage } : {}),
    ...(projection.outerCode ? { outerCode: projection.outerCode } : {}),
    ...(projection.boundary ? { boundary: projection.boundary } : {}),
    ...(projection.reasonCode ? { reasonCode: projection.reasonCode } : {}),
    ...(projection.safeToken ? { safeToken: projection.safeToken } : {}),
    ...(projection.kindDomainDiagnostics ? { kindDomainDiagnostics: projection.kindDomainDiagnostics } : {}),
    ...(projection.minimumDiagnostics ? { minimumDiagnostics: projection.minimumDiagnostics } : {}),
    ...(projection.graphCycleDiagnostics ? { graphCycleDiagnostics: projection.graphCycleDiagnostics } : {}),
    ...(projection.coverageDiagnostics ? { coverageDiagnostics: projection.coverageDiagnostics } : {}),
    ...(projection.representabilityAnchorDiagnostics ? { representabilityAnchorDiagnostics: projection.representabilityAnchorDiagnostics } : {}),
    ...(projection.finalAdmissionDiagnostics ? { finalAdmissionDiagnostics: projection.finalAdmissionDiagnostics } : {}),
    ...(projection.admissionDiagnostics ? { admissionDiagnostics: projection.admissionDiagnostics } : {}),
    ...(projection.providerTermination ? { providerTermination: projection.providerTermination } : {}),
    ...(projection.safeErrorFingerprint ? { safeErrorFingerprint: projection.safeErrorFingerprint } : {}),
    ...(projection.requestTransport ? { requestTransport: projection.requestTransport } : {}),
    ...(projection.providerContract ? { providerContract: projection.providerContract } : {}),
    ...(projection.providerDiagnostic ? { providerDiagnostic: projection.providerDiagnostic } : {}),
    ...(projection.designAdmissionDiagnostic ? { designAdmissionDiagnostic: projection.designAdmissionDiagnostic } : {}),
    ...(projection.persistenceDiagnostic ? { persistenceDiagnostic: projection.persistenceDiagnostic } : {}),
    ...(projection.sourceCurrentness ? { sourceCurrentness: projection.sourceCurrentness } : {}),
    ...(projection.providerCallsTotal !== undefined ? { providerCallsTotal: projection.providerCallsTotal } : {}),
    ...(projection.providerCallsByStage ? { providerCallsByStage: projection.providerCallsByStage } : {}),
    ...(projection.providerInvocationState ? { providerInvocationState: projection.providerInvocationState } : {}),
    ...(projection.canonicalPlanningPersisted !== undefined ? { canonicalPlanningPersisted: projection.canonicalPlanningPersisted } : {}),
    ...(projection.canonicalArchitecturePersisted !== undefined ? { canonicalArchitecturePersisted: projection.canonicalArchitecturePersisted } : {}),
    ...(projection.lifecycleMutated !== undefined ? { lifecycleMutated: projection.lifecycleMutated } : {}),
    ...(projection.providerRequestCountExact !== undefined ? { providerRequestCountExact: projection.providerRequestCountExact } : {}),
    ...(projection.providerRequestCount !== undefined ? { providerRequestCount: projection.providerRequestCount } : {}),
    ...(projection.internalClassification ? { internalClassification: projection.internalClassification } : {}),
    ...(projection.stagedOperation ? { stagedOperation: projection.stagedOperation } : {}),
    responseOrigin: projection.responseOrigin ?? "PREFLIGHT_REJECTION",
    attemptCreated: projection.attemptCreated ?? false,
    ...(projection.attemptStatus ? { attemptStatus: projection.attemptStatus } : {}),
    runtimeProvenance: projection.runtimeProvenance ?? currentRuntimeProvenance(),
    ...(projection.attemptHistory ? { attemptHistory: projection.attemptHistory } : {}),
  };
  let response: WorkbenchErrorResponse;
  try {
    response = WorkbenchErrorResponseSchema.parse(responseInput);
  } catch {
    const safeCorrelationId = z.string().uuid().safeParse(projection.correlationId).success ? projection.correlationId : randomUUID();
    const safeOperation = WorkbenchOperationSchema.safeParse(projection.operation).success ? projection.operation : "WORKBENCH_REQUEST";
    const safeProjectId = projection.projectId && z.string().uuid().safeParse(projection.projectId).success ? projection.projectId : undefined;
    const safeProviderState = ["RESERVED", "ATTEMPTING", "TRANSPORT_STARTED", "RESPONSE_RECEIVED", "PARSE_PASSED", "ADMISSION_PASSED", "FAILED"].includes(projection.providerInvocationState ?? "") ? projection.providerInvocationState : undefined;
    const safeProviderCallsTotal = typeof projection.providerCallsTotal === "number" && Number.isInteger(projection.providerCallsTotal) && projection.providerCallsTotal >= 0 ? projection.providerCallsTotal : undefined;
    const mutationReached = projection.canonicalPlanningPersisted === true || projection.canonicalArchitecturePersisted === true || projection.lifecycleMutated === true;
    const fallback: Record<string, unknown> = {
      ok: false,
      error: mutationReached ? "The operation reached a mutation boundary; inspect the current project state before retrying." : "We couldn't complete this request. The project was not changed.",
      code: "WORKBENCH_INTERNAL_ERROR",
      correlationId: safeCorrelationId,
      operation: safeOperation,
      recoverable: false,
      category: "INTERNAL" as const,
      operationStage: "RESPONSE_SERIALIZATION" as const,
      stage: "RESPONSE_SERIALIZATION" as const,
      failureClass: "UNEXPECTED_EXCEPTION" as const,
      outerCode: "WORKBENCH_INTERNAL_ERROR",
      safeErrorFingerprint: safeOperationFingerprint(error, "RESPONSE_SERIALIZATION"),
      internalClassification: "UNEXPECTED_EXCEPTION" as const,
    };
    if (projection.operationId && SafeOperationIdSchema.safeParse(projection.operationId).success) fallback.operationId = projection.operationId;
    if (projection.operationKind && /^[A-Z][A-Z0-9_]{1,80}$/.test(projection.operationKind)) fallback.operationKind = projection.operationKind;
    fallback.responseOrigin = projection.responseOrigin ?? "PREFLIGHT_REJECTION";
    fallback.attemptCreated = projection.attemptCreated === true;
    fallback.runtimeProvenance = RuntimeProvenanceSchema.parse(projection.runtimeProvenance ?? currentRuntimeProvenance());
    if (projection.attemptStatus) fallback.attemptStatus = projection.attemptStatus;
    if (projection.attemptHistory && z.array(WorkbenchAttemptReadbackSchema).max(8).safeParse(projection.attemptHistory).success) fallback.attemptHistory = projection.attemptHistory;
    if (projection.requestTransport && WorkbenchRequestTransportDiagnosticsSchema.safeParse(projection.requestTransport).success) fallback.requestTransport = projection.requestTransport;
    if (safeProjectId) fallback.projectId = safeProjectId;
    if (projection.phase === "PLANNING" || projection.phase === "ARCHITECTURE_REVIEW") fallback.phase = projection.phase;
    if (projection.providerCallsByStage && WorkbenchProviderCallsByStageSchema.safeParse(projection.providerCallsByStage).success) fallback.providerCallsByStage = projection.providerCallsByStage;
    if (projection.providerDiagnostic && SafeProviderDiagnosticSchema.safeParse(projection.providerDiagnostic).success) fallback.providerDiagnostic = projection.providerDiagnostic;
    if (projection.designAdmissionDiagnostic && DesignAdmissionDiagnosticSchema.safeParse(projection.designAdmissionDiagnostic).success) fallback.designAdmissionDiagnostic = projection.designAdmissionDiagnostic;
    if (projection.persistenceDiagnostic && SafePersistenceDiagnosticSchema.safeParse(projection.persistenceDiagnostic).success) fallback.persistenceDiagnostic = projection.persistenceDiagnostic;
    if (projection.admissionDiagnostics && PlanningAdmissionDiagnosticEnvelopeSchema.safeParse(projection.admissionDiagnostics).success) fallback.admissionDiagnostics = projection.admissionDiagnostics;
    if (projection.providerTermination && ProviderTerminationMetadataSchema.safeParse(projection.providerTermination).success) fallback.providerTermination = projection.providerTermination;
    if (safeProviderCallsTotal !== undefined) fallback.providerCallsTotal = safeProviderCallsTotal;
    if (safeProviderState) fallback.providerInvocationState = safeProviderState;
    if (typeof projection.canonicalPlanningPersisted === "boolean") fallback.canonicalPlanningPersisted = projection.canonicalPlanningPersisted;
    if (typeof projection.canonicalArchitecturePersisted === "boolean") fallback.canonicalArchitecturePersisted = projection.canonicalArchitecturePersisted;
    if (typeof projection.lifecycleMutated === "boolean") fallback.lifecycleMutated = projection.lifecycleMutated;
    response = WorkbenchErrorResponseSchema.parse(Object.fromEntries(Object.entries(fallback).filter(([, value]) => value !== undefined)));
  }
  return { response, status: response.code === "WORKBENCH_INTERNAL_ERROR" && response.stage === "RESPONSE_SERIALIZATION" ? 500 : projection.httpStatus };
}
