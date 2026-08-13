import { randomUUID } from "node:crypto";
import { z } from "zod";

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
  "APPROVE_PLANNING",
  "REQUEST_PLANNING_CHANGES",
  "DATABASE_DECISION",
  "DEPENDENCY_APPROVAL",
  "DESIGN_SELECTION",
  "START_IMPLEMENTATION",
  "WORKBENCH_REQUEST",
]);
export type WorkbenchOperation = z.infer<typeof WorkbenchOperationSchema>;

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
  })
  .strict();
export type WorkbenchErrorResponse = z.infer<typeof WorkbenchErrorResponseSchema>;

export type WorkbenchDiagnosticContext = {
  action?: string;
  projectId?: string;
  workflowState?: string;
  operation?: WorkbenchOperation;
};

export type WorkbenchErrorProjection = WorkbenchErrorResponse & {
  httpStatus: number;
  subsystem: WorkbenchSubsystem;
  errorClass: string;
};

export type WorkbenchDiagnosticEvent = {
  type: "workbench.operation.failed";
  timestamp: string;
  correlationId: string;
  operation: WorkbenchOperation;
  projectId?: string;
  workflowState?: string;
  code: string;
  category: WorkbenchErrorCategory;
  subsystem: WorkbenchSubsystem;
  errorClass: string;
  recoverable: boolean;
};

const CONFLICT_CODES = new Set([
  "WORKBENCH_ACTION_NOT_AVAILABLE",
  "PLANNING_UPSTREAM_MISSING",
  "PLANNING_NOT_READY",
  "ARCHITECTURE_REVIEW_BLOCKED",
  "DESIGN_SET_NOT_READY",
  "DESIGN_DIRECTION_NOT_FOUND",
  "IMPLEMENTATION_START_BLOCKED",
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
]);

const NOT_FOUND_CODES = new Set([
  "PROJECT_NOT_FOUND",
  "TRIAL_ENTRY_PROJECT_NOT_FOUND",
  "TRIAL_ENTRY_CLARIFICATION_NOT_FOUND",
  "CLARIFICATION_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "PERSISTENCE_NOT_FOUND",
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
  "TRIAL_ENTRY_AI_NOT_CONFIGURED",
]);

const PERSISTENCE_CODES = new Set([
  "PERSISTENCE_PROVIDER_ERROR",
  "PERSISTENCE_DATABASE_URL_MISSING",
  "PERSISTENCE_DATABASE_URL_INVALID",
  "PERSISTENCE_CONFIGURATION_INVALID",
  "PERSISTENCE_UNSUPPORTED",
]);

const SAFE_ERROR_CLASSES = new Set([
  "AiProviderError",
  "DomainError",
  "Error",
  "LeadError",
  "PersistenceConfigurationError",
  "PersistenceError",
  "WorkbenchActionError",
  "ZodError",
]);

function operationForAction(action?: string): WorkbenchOperation {
  switch (action) {
    case "create": return "SUBMIT_TO_LEAD";
    case "respond": return "ANSWER_LEAD_CLARIFICATIONS";
    case "refresh-clarifications": return "REFRESH_LEAD_CLARIFICATIONS";
    case "status": return "READ_WORKBENCH_STATUS";
    case "list": return "LIST_WORKBENCH_PROJECTS";
    case "approve-brief": return "APPROVE_BRIEF";
    case "request-brief-changes": return "REQUEST_BRIEF_CHANGES";
    case "approve-planning": return "APPROVE_PLANNING";
    case "request-planning-changes": return "REQUEST_PLANNING_CHANGES";
    case "database-decision": return "DATABASE_DECISION";
    case "dependency-approval": return "DEPENDENCY_APPROVAL";
    case "design-selection": return "DESIGN_SELECTION";
    case "start-implementation": return "START_IMPLEMENTATION";
    default: return "WORKBENCH_REQUEST";
  }
}

function errorClass(error: unknown) {
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

function providerStatus(code: string) {
  if (["AI_AUTHENTICATION_FAILED", "AI_CONFIGURATION_INVALID", "AI_MODEL_ACCESS_FAILED"].includes(code)) return { httpStatus: 503, recoverable: false };
  if (["AI_REQUEST_INVALID", "AI_REQUEST_SCHEMA_INVALID", "AI_REQUEST_PARAMETER_UNSUPPORTED"].includes(code)) return { httpStatus: 502, recoverable: false };
  if (["AI_OUTPUT_INVALID", "AI_OUTPUT_TRUNCATED", "AI_OUTPUT_REFUSED", "AI_OUTPUT_SCHEMA_MISMATCH", "AI_OUTPUT_NO_PARSED_OUTPUT", "AI_OUTPUT_DOMAIN_INVALID", "AI_STRUCTURED_PARSE_FAILED"].includes(code)) return { httpStatus: 502, recoverable: false };
  return { httpStatus: 503, recoverable: true };
}

function definitionFor(code: string, error: unknown): Omit<WorkbenchErrorProjection, "ok" | "code" | "correlationId" | "operation"> {
  if (code === "WORKBENCH_REQUEST_TOO_LARGE") return { error: "The request is too large.", httpStatus: 413, recoverable: false, category: "VALIDATION", subsystem: "ROUTE", errorClass: errorClass(error) };
  if (code === "WORKBENCH_REQUEST_INVALID") return { error: "The request could not be validated.", httpStatus: 400, recoverable: false, category: "VALIDATION", subsystem: "ROUTE", errorClass: errorClass(error) };
  if (code === "LEAD_CLARIFICATION_LANGUAGE_INVALID") return { error: "Lead refresh output did not match the Factory operator language. The project was not changed.", httpStatus: 422, recoverable: true, category: "VALIDATION", subsystem: "LEAD", errorClass: errorClass(error) };
  if (code === "WORKBENCH_ADVANCED_RUNTIME_UNAVAILABLE") return { error: "The workflow runtime is temporarily unavailable. The project was not changed.", httpStatus: 503, recoverable: true, category: "INTERNAL", subsystem: "WORKBENCH_APPLICATION", errorClass: errorClass(error) };
  if (NOT_FOUND_CODES.has(code)) return { error: "The requested project or workflow resource was not found.", httpStatus: 404, recoverable: false, category: "VALIDATION", subsystem: code === "PROJECT_NOT_FOUND" ? "WORKBENCH_APPLICATION" : code.startsWith("PERSISTENCE_") || code === "DOCUMENT_NOT_FOUND" ? "PERSISTENCE" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  if (CONFLICT_CODES.has(code)) return { error: "The project changed or the requested workflow action is no longer current.", httpStatus: 409, recoverable: true, category: "WORKFLOW_CONFLICT", subsystem: code.startsWith("WORKBENCH_") ? "WORKBENCH_APPLICATION" : code.startsWith("PERSISTENCE_") || code === "IDEMPOTENCY_CONFLICT" ? "PERSISTENCE" : code.startsWith("AI_") ? "PROVIDER" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  if (PROVIDER_CODES.has(code)) {
    const status = providerStatus(code);
    return { error: "The Lead service could not complete this request. The project was not changed.", ...status, category: "PROVIDER", subsystem: "PROVIDER", errorClass: errorClass(error) };
  }
  if (PERSISTENCE_CODES.has(code)) return { error: "The project could not be saved safely. The project was not changed.", httpStatus: 503, recoverable: true, category: "PERSISTENCE", subsystem: "PERSISTENCE", errorClass: errorClass(error) };
  if (VALIDATION_CODES.has(code)) return { error: "The request could not be completed because its workflow data was invalid.", httpStatus: 422, recoverable: false, category: "VALIDATION", subsystem: code.startsWith("PERSISTENCE_") ? "PERSISTENCE" : code.startsWith("LEAD_") ? "LEAD" : code.startsWith("INITIAL_") ? "ROUTE" : "TRIAL_ENTRY", errorClass: errorClass(error) };
  return { error: "We couldn't complete this request. The project was not changed.", httpStatus: 500, recoverable: false, category: "INTERNAL", subsystem: "ROUTE", errorClass: errorClass(error) };
}

export function normalizeWorkbenchError(error: unknown, context: WorkbenchDiagnosticContext = {}): WorkbenchErrorProjection {
  const code = error instanceof z.ZodError ? "WORKBENCH_REQUEST_INVALID" : codeOf(error);
  const knownCode = code && (CONFLICT_CODES.has(code) || NOT_FOUND_CODES.has(code) || VALIDATION_CODES.has(code) || PROVIDER_CODES.has(code) || PERSISTENCE_CODES.has(code) || code === "WORKBENCH_REQUEST_INVALID" || code === "WORKBENCH_REQUEST_TOO_LARGE" || code === "WORKBENCH_ADVANCED_RUNTIME_UNAVAILABLE") ? code : undefined;
  const projection = definitionFor(knownCode ?? "WORKBENCH_INTERNAL_ERROR", error);
  const operation = context.operation ?? operationForAction(context.action);
  return {
    ok: false,
    code: knownCode ?? "WORKBENCH_INTERNAL_ERROR",
    correlationId: randomUUID(),
    operation,
    ...projection,
  };
}

export function diagnosticEventFor(projection: WorkbenchErrorProjection, context: WorkbenchDiagnosticContext = {}): WorkbenchDiagnosticEvent {
  return {
    type: "workbench.operation.failed",
    timestamp: new Date().toISOString(),
    correlationId: projection.correlationId,
    operation: projection.operation,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.workflowState ? { workflowState: context.workflowState } : {}),
    code: projection.code,
    category: projection.category,
    subsystem: projection.subsystem,
    errorClass: projection.errorClass,
    recoverable: projection.recoverable,
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
  const projection = normalizeWorkbenchError(error, context);
  emitWorkbenchDiagnostic(diagnosticEventFor(projection, context));
  const response = WorkbenchErrorResponseSchema.parse({
    ok: projection.ok,
    error: projection.error,
    code: projection.code,
    correlationId: projection.correlationId,
    operation: projection.operation,
    recoverable: projection.recoverable,
    category: projection.category,
  });
  return { response, status: projection.httpStatus };
}
