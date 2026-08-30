import { z } from "zod";
import { parseSourceHead } from "@/domain/shared/source-head";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeTokenSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const SafeMessageSchema = z.string().max(500);

export const PlanningRecoveryDiagnosticSummarySchema = z.object({
  totalBlockers: z.number().int().nonnegative(),
  returnedBlockers: z.number().int().nonnegative().max(64),
  truncated: z.boolean(),
  blockerCategoryCounts: z.object({
    route: z.number().int().nonnegative(),
    coverage: z.number().int().nonnegative(),
    decision: z.number().int().nonnegative(),
    identity: z.number().int().nonnegative(),
    unsupportedFact: z.number().int().nonnegative(),
    schema: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }).strict(),
  blockers: z.array(SafeTokenSchema).max(64),
}).strict().superRefine((value, context) => {
  if (value.returnedBlockers !== value.blockers.length) context.addIssue({ code: "custom", path: ["returnedBlockers"], message: "Returned blocker count must match the bounded blocker list." });
  if (!value.truncated && value.returnedBlockers !== value.totalBlockers) context.addIssue({ code: "custom", path: ["truncated"], message: "A non-truncated diagnostic must return every blocker." });
  if (value.truncated && value.returnedBlockers >= value.totalBlockers) context.addIssue({ code: "custom", path: ["truncated"], message: "A truncated diagnostic must omit at least one blocker." });
}).readonly();
export type PlanningRecoveryDiagnosticSummary = z.infer<typeof PlanningRecoveryDiagnosticSummarySchema>;

export const PLANNING_RECOVERY_RUN_LEASE_MS = 15 * 60 * 1000;
export const PLANNING_RECOVERY_RUN_RESULT_MAX_BYTES = 512_000;

export const PlanningRecoveryRunStateSchema = z.enum([
  "CREATED",
  "PROVIDER_CALL_STARTED",
  "PROVIDER_RETURNED",
  "ADMISSION_STARTED",
  "ADMISSION_PASSED",
  "PERSISTENCE_STARTED",
  "COMMITTED",
  "COMMITTED_RECONCILED",
  "PROVIDER_FAILED",
  "PROVIDER_SEMANTIC_FAILED",
  "ADMISSION_FAILED",
  "CURRENTNESS_FAILED",
  "PERSISTENCE_FAILED",
  "CANCELLED",
  "ABANDONED",
  "OUTCOME_INDETERMINATE",
]);
export type PlanningRecoveryRunState = z.infer<typeof PlanningRecoveryRunStateSchema>;

export const PlanningRecoveryRunProjectionStatusSchema = z.enum(["PENDING", "SYNCED", "FAILED"]);
export type PlanningRecoveryRunProjectionStatus = z.infer<typeof PlanningRecoveryRunProjectionStatusSchema>;

export const PlanningRecoveryRunTerminalOutcomeSchema = z.enum([
  "COMMITTED",
  "COMMITTED_RECONCILED",
  "PROVIDER_FAILED",
  "PROVIDER_SEMANTIC_FAILED",
  "ADMISSION_FAILED",
  "CURRENTNESS_FAILED",
  "PERSISTENCE_FAILED",
  "CANCELLED",
  "ABANDONED",
  "OUTCOME_INDETERMINATE",
]);
export type PlanningRecoveryRunTerminalOutcome = z.infer<typeof PlanningRecoveryRunTerminalOutcomeSchema>;

export const PlanningRecoveryRunSchema = z.object({
  runId: z.string().uuid(),
  operationKey: z.string().min(1).max(180),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  versionId: z.string().uuid(),
  expectedSourceHead: z.string().min(1).max(200).nullable(),
  recoveryPlanChecksum: HashSchema,
  recoveryPlan: z.record(z.string(), z.unknown()),
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  briefRowVersion: z.number().int().positive(),
  briefSemanticChecksum: HashSchema,
  briefDocumentChecksum: HashSchema,
  planningRowVersion: z.number().int().positive(),
  planningSemanticChecksum: HashSchema,
  planningDocumentChecksum: HashSchema,
  providerBudget: z.number().int().nonnegative(),
  providerAttemptCount: z.number().int().nonnegative(),
  state: PlanningRecoveryRunStateSchema,
  providerResultChecksum: HashSchema.nullable(),
  providerResult: z.record(z.string(), z.unknown()).nullable(),
  providerRequestId: SafeTokenSchema.nullable(),
  providerModel: SafeTokenSchema.nullable(),
  providerErrorClass: SafeTokenSchema.nullable(),
  providerErrorCode: SafeTokenSchema.nullable(),
  diagnosticStage: SafeTokenSchema.nullable(),
  diagnosticCode: SafeTokenSchema.nullable(),
  diagnosticMessage: SafeMessageSchema.nullable(),
  diagnosticSummary: PlanningRecoveryDiagnosticSummarySchema.nullable(),
  leaseOwner: SafeTokenSchema.nullable(),
  leaseExpiresAt: z.string().datetime({ offset: true }).nullable(),
  terminalOutcome: PlanningRecoveryRunTerminalOutcomeSchema.nullable(),
  committedEvidenceId: z.string().uuid().nullable(),
  projectMemoryStatus: PlanningRecoveryRunProjectionStatusSchema,
  projectMemoryFailureCode: SafeTokenSchema.nullable(),
  projectMemoryFailureMessage: SafeMessageSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type PlanningRecoveryRunRow = z.infer<typeof PlanningRecoveryRunSchema>;

const PLANNING_RECOVERY_RUN_IMMUTABLE_FIELDS = new Set([
  "runId", "operationKey", "projectId", "projectVersion", "versionId", "expectedSourceHead", "recoveryPlanChecksum", "recoveryPlan",
  "projectRowVersion", "projectVersionRowVersion", "briefRowVersion", "briefSemanticChecksum", "briefDocumentChecksum", "planningRowVersion", "planningSemanticChecksum", "planningDocumentChecksum", "providerBudget",
]);

export function hasPlanningRecoveryRunImmutablePatch(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return Object.keys(input).some((key) => PLANNING_RECOVERY_RUN_IMMUTABLE_FIELDS.has(key));
}

export function hasValidNewPlanningRecoveryRunSourceBinding(input: Pick<PlanningRecoveryRunRow, "expectedSourceHead" | "recoveryPlan">) {
  if (!input.expectedSourceHead) return false;
  const plan = input.recoveryPlan as { sourceHead?: unknown };
  try { return parseSourceHead(input.expectedSourceHead) === parseSourceHead(plan.sourceHead); }
  catch { return false; }
}

export const PLANNING_RECOVERY_RUN_TERMINAL_STATES = new Set<PlanningRecoveryRunState>([
  "COMMITTED",
  "COMMITTED_RECONCILED",
  "PROVIDER_FAILED",
  "PROVIDER_SEMANTIC_FAILED",
  "ADMISSION_FAILED",
  "CURRENTNESS_FAILED",
  "PERSISTENCE_FAILED",
  "CANCELLED",
  "ABANDONED",
  "OUTCOME_INDETERMINATE",
]);

const ALLOWED_TRANSITIONS: Record<PlanningRecoveryRunState, readonly PlanningRecoveryRunState[]> = {
  CREATED: ["PROVIDER_CALL_STARTED", "CURRENTNESS_FAILED", "CANCELLED", "ABANDONED"],
  PROVIDER_CALL_STARTED: ["PROVIDER_RETURNED", "PROVIDER_FAILED", "PROVIDER_SEMANTIC_FAILED", "OUTCOME_INDETERMINATE"],
  PROVIDER_RETURNED: ["ADMISSION_STARTED", "ADMISSION_FAILED", "CURRENTNESS_FAILED"],
  ADMISSION_STARTED: ["ADMISSION_PASSED", "ADMISSION_FAILED", "CURRENTNESS_FAILED"],
  ADMISSION_PASSED: ["PERSISTENCE_STARTED", "CURRENTNESS_FAILED", "PERSISTENCE_FAILED"],
  PERSISTENCE_STARTED: ["COMMITTED", "COMMITTED_RECONCILED", "CURRENTNESS_FAILED", "PERSISTENCE_FAILED"],
  COMMITTED: [],
  COMMITTED_RECONCILED: [],
  PROVIDER_FAILED: [],
  PROVIDER_SEMANTIC_FAILED: [],
  ADMISSION_FAILED: [],
  CURRENTNESS_FAILED: [],
  PERSISTENCE_FAILED: [],
  CANCELLED: [],
  ABANDONED: [],
  OUTCOME_INDETERMINATE: [],
};

export function isPlanningRecoveryRunTerminal(state: PlanningRecoveryRunState) {
  return PLANNING_RECOVERY_RUN_TERMINAL_STATES.has(state);
}

export function assertPlanningRecoveryRunTransition(from: PlanningRecoveryRunState, to: PlanningRecoveryRunState) {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new Error(`PLANNING_RECOVERY_RUN_INVALID_TRANSITION:${from}->${to}`);
}

export type PlanningRecoveryRunClaimOutcome =
  | "PROVIDER_STARTED"
  | "RESUMED"
  | "RUN_ALREADY_ACTIVE"
  | "PROVIDER_ATTEMPT_ALREADY_CONSUMED"
  | "COMMITTED_REPLAY"
  | "TERMINAL_FAILURE_REPLAY";

export type PlanningRecoveryRunClaim = {
  outcome: PlanningRecoveryRunClaimOutcome;
  row: PlanningRecoveryRunRow;
};

export type PlanningRecoveryRunTransition = {
  runId: string;
  operationKey: string;
  from: PlanningRecoveryRunState;
  to: PlanningRecoveryRunState;
  now: string;
  owner?: string;
  patch?: Partial<Pick<PlanningRecoveryRunRow,
    | "providerResultChecksum"
    | "providerResult"
    | "providerRequestId"
    | "providerModel"
    | "providerErrorClass"
    | "providerErrorCode"
    | "diagnosticStage"
    | "diagnosticCode"
    | "diagnosticMessage"
    | "diagnosticSummary"
    | "leaseOwner"
    | "leaseExpiresAt"
    | "terminalOutcome"
    | "committedEvidenceId"
    | "projectMemoryStatus"
    | "projectMemoryFailureCode"
    | "projectMemoryFailureMessage"
  >>;
};

export function isLeaseActive(row: Pick<PlanningRecoveryRunRow, "leaseExpiresAt">, now: string) {
  return Boolean(row.leaseExpiresAt && Date.parse(row.leaseExpiresAt) > Date.parse(now));
}

export function terminalOutcomeFor(state: PlanningRecoveryRunState): PlanningRecoveryRunTerminalOutcome | null {
  return isPlanningRecoveryRunTerminal(state) ? state as PlanningRecoveryRunTerminalOutcome : null;
}
