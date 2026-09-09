import { isAiProviderError } from "@/integrations/openai/errors";
import type { ProviderDiagnostic } from "@/integrations/openai/usage";
import { PlannerError, type PlannerErrorCode } from "./errors";
import { z } from "zod";
import { PlannerDecompositionKindDomainDiagnosticsSchema, type PlannerDecompositionKindDomainDiagnostics } from "./coverage-contract";

export const StagedPlanningStageSchema = z.enum([
  "PREFLIGHT",
  "DECOMPOSITION_PROVIDER",
  "DECOMPOSITION_PARSE",
  "DECOMPOSITION_ADMISSION",
  "PE_ASSIGNMENT",
  "GRAPH_ASSEMBLY",
  "GRAPH_ADMISSION",
  "COVERAGE_PROVIDER",
  "COVERAGE_PARSE",
  "COVERAGE_ADMISSION",
  "FINAL_ASSEMBLY",
  "FINAL_ADMISSION",
  "PERSISTENCE",
  "LIFECYCLE_TRANSITION",
]);
export type StagedPlanningStage = z.infer<typeof StagedPlanningStageSchema>;

export const StagedPlanningFailureClassSchema = z.enum([
  "STAGED_DECOMPOSITION_FAILURE",
  "STAGED_REFERENTIAL_INTEGRITY_FAILURE",
  "STAGED_COVERAGE_FAILURE",
  "STAGED_FINAL_ASSEMBLY_FAILURE",
  "STAGED_CURRENTNESS_FAILURE",
  "PROVIDER_SCHEMA_ADHERENCE_FAILURE",
  "PROVIDER_TRANSPORT_FAILURE",
  "PROVIDER_STRUCTURED_OUTPUT_FAILURE",
  "FACTORY_PROTOCOL_DEFECT",
  "RUNTIME_PERSISTENCE_FAILURE",
]);
export type StagedPlanningFailureClass = z.infer<typeof StagedPlanningFailureClassSchema>;

export const StagedPlanningProviderStageSchema = z.enum(["decomposition", "coverage"]);
export type StagedPlanningProviderStage = z.infer<typeof StagedPlanningProviderStageSchema>;

const SafeOpaqueTokenSchema = z.string().regex(/^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/).max(32);
const SafeOperationIdSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/);
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const StagedPlanningProviderCallCountersSchema = z.object({
  attempted: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  responseReceived: z.number().int().nonnegative(),
  structuredParsePassed: z.number().int().nonnegative(),
  semanticAdmissionPassed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict();
export type StagedPlanningProviderCallCounters = z.infer<typeof StagedPlanningProviderCallCountersSchema>;

export const StagedPlanningOperationSummarySchema = z.object({
  operationId: SafeOperationIdSchema,
  operationChecksum: ChecksumSchema,
  correlationId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefChecksum: ChecksumSchema,
  stageReached: StagedPlanningStageSchema,
  stageFailed: StagedPlanningStageSchema.nullable(),
  providerRequestCountExact: z.boolean(),
  providerRequestAttempted: z.boolean(),
  providerRequestCount: z.number().int().nonnegative(),
  providerCallsTotal: z.number().int().nonnegative(),
  providerCallsByStage: z.object({
    decomposition: StagedPlanningProviderCallCountersSchema,
    coverage: StagedPlanningProviderCallCountersSchema,
  }).strict(),
  canonicalPlanningPersisted: z.boolean(),
  lifecycleMutated: z.boolean(),
  outerCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).nullable(),
  failureClass: StagedPlanningFailureClassSchema.nullable(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).nullable(),
  safeToken: SafeOpaqueTokenSchema.nullable(),
  providerContract: z.string().regex(/^[a-z0-9-]{1,100}$/).nullable(),
  kindDomainDiagnostics: PlannerDecompositionKindDomainDiagnosticsSchema.optional(),
}).strict();
export type StagedPlanningOperationSummary = z.infer<typeof StagedPlanningOperationSummarySchema>;

export type StagedPlanningFailureDetails = {
  stage: StagedPlanningStage;
  failureClass: StagedPlanningFailureClass;
  outerCode: PlannerErrorCode;
  reasonCode?: string;
  safeToken?: string;
  kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics;
  providerContract?: string;
  providerRequestCountExact: boolean;
  providerRequestAttempted: boolean;
  providerRequestCount: number;
  operation: StagedPlanningOperationSummary;
};

export class StagedPlanningFailure extends PlannerError {
  constructor(
    readonly details: StagedPlanningFailureDetails,
    message: string,
    cause?: unknown,
  ) {
    super(details.outerCode, message, cause);
    this.name = "StagedPlanningFailure";
  }
}

export function isStagedPlanningFailure(error: unknown): error is StagedPlanningFailure {
  return error instanceof StagedPlanningFailure;
}

function emptyCounters(): StagedPlanningProviderCallCounters {
  return { attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 };
}

function nestedProviderDiagnostic(error: unknown, depth = 0): ProviderDiagnostic | undefined {
  if (depth > 5 || !error || typeof error !== "object") return undefined;
  if (isAiProviderError(error)) return error.diagnostic;
  return "cause" in error ? nestedProviderDiagnostic(error.cause, depth + 1) : undefined;
}

function safeOpaqueToken(value: unknown) {
  return typeof value === "string" && /^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/.test(value) ? value : undefined;
}

function safeOperationId(value: string) {
  return SafeOperationIdSchema.parse(value);
}

export class StagedPlanningOperationTelemetry {
  private readonly providerCalls = {
    decomposition: emptyCounters(),
    coverage: emptyCounters(),
  };
  private stageReached: StagedPlanningStage = "PREFLIGHT";
  private stageFailed: StagedPlanningStage | null = null;
  private canonicalPlanningPersisted = false;
  private lifecycleMutated = false;
  private providerContract: string | null = null;
  private providerRequestCountExact = true;
  private recorded = false;

  constructor(private readonly identity: {
    operationId: string;
    operationChecksum: string;
    correlationId: string;
    projectId: string;
    briefChecksum: string;
  }) {
    SafeOperationIdSchema.parse(identity.operationId);
  }

  enter(stage: StagedPlanningStage) {
    this.stageReached = stage;
  }

  get currentStage() {
    return this.stageReached;
  }

  get correlationId() {
    return this.identity.correlationId;
  }

  beginProvider(stage: StagedPlanningProviderStage, providerContract: string) {
    this.providerContract = providerContract;
    return { stage, providerContract };
  }

  providerSucceeded(handle: { stage: StagedPlanningProviderStage; providerContract: string }) {
    const counters = this.providerCalls[handle.stage];
    counters.attempted += 1;
    counters.started += 1;
    counters.responseReceived += 1;
    counters.structuredParsePassed += 1;
    counters.completed += 1;
  }

  providerFailed(handle: { stage: StagedPlanningProviderStage; providerContract: string }, error: unknown) {
    const counters = this.providerCalls[handle.stage];
    const diagnostic = nestedProviderDiagnostic(error);
    if (!diagnostic) {
      this.providerRequestCountExact = false;
      counters.failed += 1;
      return;
    }
    counters.attempted += diagnostic.requestAttempted ? 1 : 0;
    counters.started += diagnostic.requestAttempted ? 1 : 0;
    counters.responseReceived += (diagnostic.responseReceived ?? diagnostic.apiResponseReceived) ? 1 : 0;
    counters.failed += 1;
  }

  semanticAdmissionPassed(stage: StagedPlanningProviderStage) {
    this.providerCalls[stage].semanticAdmissionPassed += 1;
  }

  /** Replace in-memory counters with the durable host ledger when present. */
  syncProviderAccounting(snapshot: {
    providerCallsTotal: number;
    providerCallsByStage: Record<StagedPlanningProviderStage, StagedPlanningProviderCallCounters>;
  }) {
    this.providerCalls.decomposition = { ...snapshot.providerCallsByStage.decomposition };
    this.providerCalls.coverage = { ...snapshot.providerCallsByStage.coverage };
    this.providerRequestCountExact = true;
  }

  markCanonicalPlanningPersisted() {
    this.canonicalPlanningPersisted = true;
  }

  markLifecycleMutated() {
    this.lifecycleMutated = true;
  }

  private summary(input: {
    stageFailed: StagedPlanningStage | null;
    outerCode: string | null;
    failureClass: StagedPlanningFailureClass | null;
    reasonCode?: string;
    safeToken?: string;
    kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics;
  }): StagedPlanningOperationSummary {
    const providerCallsByStage = {
      decomposition: { ...this.providerCalls.decomposition },
      coverage: { ...this.providerCalls.coverage },
    };
    const providerCallsTotal = Object.values(providerCallsByStage).reduce((sum, counters) => sum + counters.attempted, 0);
    return StagedPlanningOperationSummarySchema.parse({
      operationId: safeOperationId(this.identity.operationId),
      operationChecksum: this.identity.operationChecksum,
      correlationId: this.identity.correlationId,
      projectId: this.identity.projectId,
      briefChecksum: this.identity.briefChecksum,
      stageReached: this.stageReached,
      stageFailed: input.stageFailed,
      providerRequestCountExact: this.providerRequestCountExact,
      providerRequestAttempted: providerCallsTotal > 0,
      providerRequestCount: providerCallsTotal,
      providerCallsTotal,
      providerCallsByStage,
      canonicalPlanningPersisted: this.canonicalPlanningPersisted,
      lifecycleMutated: this.lifecycleMutated,
      outerCode: input.outerCode,
      failureClass: input.failureClass,
      reasonCode: input.reasonCode ?? null,
      safeToken: input.safeToken ? safeOpaqueToken(input.safeToken) ?? null : null,
      providerContract: this.providerContract,
      ...(input.kindDomainDiagnostics ? { kindDomainDiagnostics: input.kindDomainDiagnostics } : {}),
    });
  }

  succeed() {
    if (this.recorded) return this.summary({ stageFailed: null, outerCode: null, failureClass: null });
    this.recorded = true;
    const summary = this.summary({ stageFailed: null, outerCode: null, failureClass: null });
    recordStagedPlanningOperation(summary);
    return summary;
  }

  fail(input: {
    stage: StagedPlanningStage;
    outerCode: PlannerErrorCode;
    failureClass: StagedPlanningFailureClass;
    reasonCode?: string;
    safeToken?: string;
    kindDomainDiagnostics?: PlannerDecompositionKindDomainDiagnostics;
    message: string;
    cause?: unknown;
  }) {
    this.stageFailed = input.stage;
    this.stageReached = input.stage;
    const summary = this.recorded
      ? this.summary({ stageFailed: input.stage, outerCode: input.outerCode, failureClass: input.failureClass, reasonCode: input.reasonCode, safeToken: input.safeToken, kindDomainDiagnostics: input.kindDomainDiagnostics })
      : this.summary({ stageFailed: input.stage, outerCode: input.outerCode, failureClass: input.failureClass, reasonCode: input.reasonCode, safeToken: input.safeToken, kindDomainDiagnostics: input.kindDomainDiagnostics });
    if (!this.recorded) {
      this.recorded = true;
      recordStagedPlanningOperation(summary);
    }
    return new StagedPlanningFailure({
      stage: input.stage,
      failureClass: input.failureClass,
      outerCode: input.outerCode,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(safeOpaqueToken(input.safeToken) ? { safeToken: safeOpaqueToken(input.safeToken) } : {}),
      ...(input.kindDomainDiagnostics ? { kindDomainDiagnostics: input.kindDomainDiagnostics } : {}),
      ...(this.providerContract ? { providerContract: this.providerContract } : {}),
      providerRequestCountExact: summary.providerRequestCountExact,
      providerRequestAttempted: summary.providerRequestAttempted,
      providerRequestCount: summary.providerRequestCount,
      operation: summary,
    }, input.message, input.cause);
  }
}

const stagedPlanningOperations: StagedPlanningOperationSummary[] = [];
const MAX_STAGED_PLANNING_OPERATIONS = 100;

export function recordStagedPlanningOperation(summary: StagedPlanningOperationSummary) {
  const parsed = StagedPlanningOperationSummarySchema.parse(summary);
  stagedPlanningOperations.push(parsed);
  if (stagedPlanningOperations.length > MAX_STAGED_PLANNING_OPERATIONS) stagedPlanningOperations.shift();
}

export function getStagedPlanningOperations() {
  return stagedPlanningOperations.map((summary) => ({
    ...summary,
    providerCallsByStage: {
      decomposition: { ...summary.providerCallsByStage.decomposition },
      coverage: { ...summary.providerCallsByStage.coverage },
    },
  }));
}

export function clearStagedPlanningOperations() {
  stagedPlanningOperations.length = 0;
}
