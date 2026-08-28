import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "@/domain/shared/schemas";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const PlanningRefreshDiagnosticAttemptSchema = z.object({
  id: UuidSchema,
  operationKey: NonEmptyStringSchema,
  stage: z.enum(["BASE_VALIDATION", "PROVIDER", "CURRENTNESS", "ADMISSION", "PERSISTENCE"]),
  status: z.enum(["REJECTED_INVALID", "REJECTED_STALE", "FAILED"]),
  failureCode: NonEmptyStringSchema,
  basePlanningSemanticChecksum: Sha256Schema.optional(),
  baseBriefChecksum: Sha256Schema.optional(),
  targetBriefChecksum: Sha256Schema.optional(),
  changedDomains: z.array(NonEmptyStringSchema).max(32),
  operationKinds: z.array(NonEmptyStringSchema).max(64),
  recordedAt: IsoDateTimeSchema,
}).strict();
export type PlanningRefreshDiagnosticAttempt = z.infer<typeof PlanningRefreshDiagnosticAttemptSchema>;

export const PlanningRefreshDiagnosticsSchema = DocumentBaseSchema.extend({
  documentType: z.literal("planning-refresh-diagnostics"),
  attempts: z.array(PlanningRefreshDiagnosticAttemptSchema).max(64),
}).strict();
export type PlanningRefreshDiagnostics = z.infer<typeof PlanningRefreshDiagnosticsSchema>;

export function createPlanningRefreshDiagnostics(input: { projectId: string; projectVersion: number; timestamp: string; attempt: PlanningRefreshDiagnosticAttempt }): PlanningRefreshDiagnostics {
  return PlanningRefreshDiagnosticsSchema.parse({
    schemaVersion: 1,
    documentType: "planning-refresh-diagnostics",
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    attempts: [input.attempt],
  });
}

export function appendPlanningRefreshDiagnostic(existing: PlanningRefreshDiagnostics | null, input: { projectId: string; projectVersion: number; timestamp: string; attempt: PlanningRefreshDiagnosticAttempt }): PlanningRefreshDiagnostics {
  const next = existing
    ? { ...existing, updatedAt: input.timestamp, attempts: [...existing.attempts.filter((attempt) => attempt.operationKey !== input.attempt.operationKey), input.attempt].slice(-64) }
    : createPlanningRefreshDiagnostics(input);
  return PlanningRefreshDiagnosticsSchema.parse(next);
}

export function planningRefreshDiagnosticPayloadChecksum(value: unknown) {
  return checksumPersistedDocument(value);
}
