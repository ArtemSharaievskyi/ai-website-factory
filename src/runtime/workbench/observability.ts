import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IsoDateTimeSchema } from "@/domain/shared/schemas";

export const WORKBENCH_OBSERVABILITY_SCHEMA_VERSION = 1 as const;
export const WORKBENCH_RUNTIME_CONTRACT_VERSION = "workbench-runtime-v1" as const;
export const WORKBENCH_RUNTIME_PROVENANCE_FILE = ".next/workbench-runtime-provenance.json";
export const MAX_WORKBENCH_ATTEMPT_TIMELINE_EVENTS = 64;
export const MAX_WORKBENCH_ATTEMPT_HISTORY = 8;

export const WorkbenchResponseOriginSchema = z.enum([
  "NEW_EXECUTION",
  "IDEMPOTENT_ACTIVE",
  "IDEMPOTENT_SUCCESS",
  "HISTORICAL_FAILED_READBACK",
  "REPLAY",
  "PREFLIGHT_REJECTION",
  "NO_EXECUTION",
]);
export type WorkbenchResponseOrigin = z.infer<typeof WorkbenchResponseOriginSchema>;

export const WorkbenchEnvironmentClassSchema = z.enum(["DEVELOPMENT", "TEST", "PRODUCTION"]);
export type WorkbenchEnvironmentClass = z.infer<typeof WorkbenchEnvironmentClassSchema>;

export const RuntimeProvenanceSchema = z.object({
  schemaVersion: z.literal(WORKBENCH_OBSERVABILITY_SCHEMA_VERSION),
  contractVersion: z.literal(WORKBENCH_RUNTIME_CONTRACT_VERSION),
  sourceCommitSha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  buildId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).nullable(),
  buildCreatedAt: IsoDateTimeSchema.nullable(),
  processGeneration: z.string().uuid(),
  processStartedAt: IsoDateTimeSchema,
  sourceDirty: z.boolean().nullable(),
  environmentClass: WorkbenchEnvironmentClassSchema,
  availability: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
}).strict();
export type RuntimeProvenance = z.infer<typeof RuntimeProvenanceSchema>;

export const RuntimeBuildProvenanceSchema = RuntimeProvenanceSchema.omit({ processGeneration: true, processStartedAt: true }).extend({
  buildId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  buildCreatedAt: IsoDateTimeSchema,
  environmentClass: z.literal("PRODUCTION"),
}).strict();
export type RuntimeBuildProvenance = z.infer<typeof RuntimeBuildProvenanceSchema>;

export const WorkbenchAttemptTimelineEventSchema = z.object({
  type: z.enum([
    "ATTEMPT_CREATED",
    "ATTEMPT_RESERVED",
    "EXECUTION_STARTED",
    "PROVIDER_STAGE_RESERVED",
    "PROVIDER_STAGE_STARTED",
    "PROVIDER_STAGE_RESPONSE_RECEIVED",
    "PROVIDER_STAGE_PARSE_PASSED",
    "PROVIDER_STAGE_ADMISSION_PASSED",
    "PROVIDER_STAGE_FAILED",
    "EXECUTION_SUCCEEDED",
    "EXECUTION_FAILED",
  ]),
  at: IsoDateTimeSchema,
  stage: z.enum(["decomposition", "coverage", "architecture-review"]).optional(),
  invocationId: z.string().uuid().optional(),
}).strict();
export type WorkbenchAttemptTimelineEvent = z.infer<typeof WorkbenchAttemptTimelineEventSchema>;

export const WorkbenchAttemptStatusSchema = z.enum(["IN_PROGRESS", "SUCCEEDED", "FAILED"]);
export type WorkbenchAttemptStatus = z.infer<typeof WorkbenchAttemptStatusSchema>;

export const WorkbenchAttemptReadbackSchema = z.object({
  operationId: z.string().min(1).max(256),
  attemptId: z.string().uuid(),
  correlationId: z.string().uuid(),
  status: WorkbenchAttemptStatusSchema,
  semanticIntentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  createdAt: IsoDateTimeSchema.nullable(),
  reservedAt: IsoDateTimeSchema.nullable(),
  executionStartedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  failedAt: IsoDateTimeSchema.nullable(),
  failureStage: z.string().min(1).max(80).nullable(),
  providerCallsTotal: z.number().int().nonnegative(),
  providerCallsByStage: z.record(z.string(), z.object({
    attempted: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    responseReceived: z.number().int().nonnegative(),
    structuredParsePassed: z.number().int().nonnegative(),
    semanticAdmissionPassed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }).strict()),
  timeline: z.array(WorkbenchAttemptTimelineEventSchema).max(MAX_WORKBENCH_ATTEMPT_TIMELINE_EVENTS),
  runtimeProvenance: RuntimeProvenanceSchema.nullable(),
  provenanceAvailability: z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]),
}).strict();
export type WorkbenchAttemptReadback = z.infer<typeof WorkbenchAttemptReadbackSchema>;

export const WorkbenchResponseMetadataSchema = z.object({
  schemaVersion: z.literal(WORKBENCH_OBSERVABILITY_SCHEMA_VERSION),
  responseOrigin: WorkbenchResponseOriginSchema,
  attemptCreated: z.boolean(),
  operationId: z.string().min(1).max(256).optional(),
  attemptId: z.string().uuid().optional(),
  correlationId: z.string().uuid(),
  semanticIntentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  attemptStatus: WorkbenchAttemptStatusSchema.optional(),
  runtimeProvenance: RuntimeProvenanceSchema,
  attemptHistory: z.array(WorkbenchAttemptReadbackSchema).max(MAX_WORKBENCH_ATTEMPT_HISTORY).optional(),
}).strict();
export type WorkbenchResponseMetadata = z.infer<typeof WorkbenchResponseMetadataSchema>;

type RuntimeProvenanceBase = Omit<RuntimeProvenance, "processGeneration" | "processStartedAt" | "availability">;

function validJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function processStartedAt(env: NodeJS.ProcessEnv) {
  const candidate = env.FACTORY_SERVER_STARTED_AT;
  return candidate && IsoDateTimeSchema.safeParse(candidate).success ? candidate : new Date().toISOString();
}

function environmentClass(env: NodeJS.ProcessEnv): WorkbenchEnvironmentClass {
  if (env.FACTORY_RUNTIME_ENVIRONMENT === "TEST" || env.NODE_ENV === "test") return "TEST";
  if (env.FACTORY_RUNTIME_ENVIRONMENT === "DEVELOPMENT" || env.NODE_ENV === "development") return "DEVELOPMENT";
  return "PRODUCTION";
}

function loadBase(env: NodeJS.ProcessEnv, cwd: string): Partial<RuntimeProvenanceBase> {
  const fromEnvironment = validJsonObject(env.FACTORY_RUNTIME_PROVENANCE);
  let fromBuild: Record<string, unknown> | undefined;
  try {
    fromBuild = validJsonObject(readFileSync(path.join(cwd, WORKBENCH_RUNTIME_PROVENANCE_FILE), "utf8"));
  } catch {
    fromBuild = undefined;
  }
  const raw = { ...(fromBuild ?? {}), ...(fromEnvironment ?? {}) };
  const parsed = RuntimeProvenanceSchema.partial().safeParse({
    schemaVersion: raw.schemaVersion,
    contractVersion: raw.contractVersion,
    sourceCommitSha: raw.sourceCommitSha,
    sourceFingerprint: raw.sourceFingerprint,
    buildId: raw.buildId,
    buildCreatedAt: raw.buildCreatedAt,
    processGeneration: randomUUID(),
    processStartedAt: new Date().toISOString(),
    sourceDirty: raw.sourceDirty,
    environmentClass: raw.environmentClass,
    availability: raw.availability,
  });
  if (!parsed.success) return {};
  const value = parsed.data;
  return {
    schemaVersion: value.schemaVersion,
    contractVersion: value.contractVersion,
    sourceCommitSha: value.sourceCommitSha,
    sourceFingerprint: value.sourceFingerprint,
    buildId: value.buildId,
    buildCreatedAt: value.buildCreatedAt,
    sourceDirty: value.sourceDirty,
  };
}

export function currentRuntimeProvenance(input: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): RuntimeProvenance {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const base = loadBase(env, cwd);
  const sourceCommitSha = base.sourceCommitSha ?? null;
  const sourceFingerprint = base.sourceFingerprint ?? null;
  const buildId = base.buildId ?? null;
  const buildCreatedAt = base.buildCreatedAt ?? null;
  const sourceDirty = base.sourceDirty ?? null;
  const hasSource = Boolean(sourceCommitSha && sourceFingerprint);
  const hasProcess = Boolean(env.FACTORY_SERVER_GENERATION && IsoDateTimeSchema.safeParse(processStartedAt(env)).success);
  return RuntimeProvenanceSchema.parse({
    schemaVersion: WORKBENCH_OBSERVABILITY_SCHEMA_VERSION,
    contractVersion: WORKBENCH_RUNTIME_CONTRACT_VERSION,
    sourceCommitSha,
    sourceFingerprint,
    buildId,
    buildCreatedAt,
    processGeneration: z.string().uuid().safeParse(env.FACTORY_SERVER_GENERATION).success ? env.FACTORY_SERVER_GENERATION : randomUUID(),
    processStartedAt: processStartedAt(env),
    sourceDirty,
    environmentClass: environmentClass(env),
    availability: hasSource && hasProcess ? "AVAILABLE" : hasSource || hasProcess ? "PARTIAL" : "UNAVAILABLE",
  });
}

export function runtimeProvenanceFromBuild(input: { build: RuntimeBuildProvenance; processGeneration: string; processStartedAt: string }): RuntimeProvenance {
  return RuntimeProvenanceSchema.parse({ ...input.build, processGeneration: input.processGeneration, processStartedAt: input.processStartedAt, availability: "AVAILABLE" });
}

export function unavailableRuntimeProvenance(): RuntimeProvenance {
  return currentRuntimeProvenance({ env: { NODE_ENV: "test" }, cwd: process.cwd() });
}

export function attemptReadbackFromResult(input: { operationId: string; status: WorkbenchAttemptStatus; result: unknown; createdAt?: string | null }): WorkbenchAttemptReadback | null {
  if (!input.result || typeof input.result !== "object" || Array.isArray(input.result)) return null;
  const value = input.result as Record<string, unknown>;
  const attemptId = typeof value.attemptId === "string" ? value.attemptId : undefined;
  const correlationId = typeof value.correlationId === "string" ? value.correlationId : undefined;
  if (!attemptId || !correlationId) return null;
  const zeroCounters = { attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 };
  const rawCounters = value.providerCallsByStage && typeof value.providerCallsByStage === "object" && !Array.isArray(value.providerCallsByStage) ? value.providerCallsByStage as Record<string, unknown> : {};
  const providerCallsByStage = Object.fromEntries(["decomposition", "coverage", "architecture-review"].map((stage) => {
    const counters = rawCounters[stage] && typeof rawCounters[stage] === "object" && !Array.isArray(rawCounters[stage]) ? rawCounters[stage] as Record<string, unknown> : {};
    return [stage, Object.fromEntries(Object.keys(zeroCounters).map((key) => [key, typeof counters[key] === "number" && Number.isInteger(counters[key]) && counters[key] >= 0 ? counters[key] : 0]))];
  }));
  const candidateCreatedAt = typeof value.attemptCreatedAt === "string" ? value.attemptCreatedAt : input.createdAt ?? null;
  const createdAt = candidateCreatedAt && IsoDateTimeSchema.safeParse(candidateCreatedAt).success ? candidateCreatedAt : null;
  const runtimeProvenance = value.runtimeProvenance && typeof value.runtimeProvenance === "object" ? RuntimeProvenanceSchema.safeParse(value.runtimeProvenance) : undefined;
  const parsed = WorkbenchAttemptReadbackSchema.safeParse({
    operationId: typeof value.operationId === "string" ? value.operationId : input.operationId,
    attemptId,
    correlationId,
    status: input.status,
    semanticIntentHash: typeof value.semanticIntentHash === "string" ? value.semanticIntentHash : null,
    createdAt,
    reservedAt: typeof value.reservedAt === "string" && IsoDateTimeSchema.safeParse(value.reservedAt).success ? value.reservedAt : null,
    executionStartedAt: typeof value.executionStartedAt === "string" && IsoDateTimeSchema.safeParse(value.executionStartedAt).success ? value.executionStartedAt : null,
    completedAt: typeof value.completedAt === "string" && IsoDateTimeSchema.safeParse(value.completedAt).success ? value.completedAt : null,
    failedAt: typeof value.failedAt === "string" && IsoDateTimeSchema.safeParse(value.failedAt).success ? value.failedAt : null,
    failureStage: typeof value.failureStage === "string" ? value.failureStage : null,
    providerCallsTotal: typeof value.providerCallsTotal === "number" ? value.providerCallsTotal : 0,
    providerCallsByStage,
    timeline: Array.isArray(value.attemptTimeline) ? value.attemptTimeline.filter((event) => WorkbenchAttemptTimelineEventSchema.safeParse(event).success).slice(-MAX_WORKBENCH_ATTEMPT_TIMELINE_EVENTS) : [],
    runtimeProvenance: runtimeProvenance?.success ? runtimeProvenance.data : null,
    provenanceAvailability: runtimeProvenance?.success ? runtimeProvenance.data.availability : "UNAVAILABLE",
  });
  return parsed.success ? parsed.data : null;
}
