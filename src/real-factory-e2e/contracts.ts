import { z } from "zod";

export const RealFactoryE2EStatusSchema = z.enum(["pending", "running", "passed", "failed"]);
export const RealFactoryE2EStageStatusSchema = z.enum(["not-run", "passed", "failed", "blocked"]);
export const RealFactoryE2EIntegrationStatusSchema = z.enum(["configured", "not-needed", "blocked", "not-configured"]);

export const RealFactoryE2EStageSchema = z.object({
  name: z.string().min(1).max(80), status: RealFactoryE2EStageStatusSchema,
  startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional(),
  safeFailureCode: z.string().regex(/^[A-Z0-9_]+$/).optional(), summary: z.string().max(500),
}).strict();

export const RealFactoryE2EReportSchema = z.object({
  schemaVersion: z.literal(1), reportType: z.literal("real-factory-e2e"), smokeId: z.string().uuid(),
  projectId: z.string().uuid().optional(), projectVersion: z.number().int().positive().optional(),
  projectPathReference: z.string().max(500).optional(), startedAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
  overallStatus: RealFactoryE2EStatusSchema, optIn: z.boolean(), preflightPassed: z.boolean(),
  stages: z.array(RealFactoryE2EStageSchema).max(30), provider: z.object({ status: RealFactoryE2EIntegrationStatusSchema, modelLabel: z.string().max(100).optional(), requestCount: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
  context7: z.object({ status: RealFactoryE2EIntegrationStatusSchema, requestCount: z.number().int().nonnegative() }).strict(),
  shadcn: z.object({ status: RealFactoryE2EIntegrationStatusSchema, requestCount: z.number().int().nonnegative() }).strict(),
  npm: z.object({ status: RealFactoryE2EIntegrationStatusSchema, commands: z.array(z.string()).max(10), passedCount: z.number().int().nonnegative(), failedCount: z.number().int().nonnegative() }).strict(),
  playwright: z.object({ status: RealFactoryE2EIntegrationStatusSchema, scenarios: z.number().int().nonnegative(), passedCount: z.number().int().nonnegative(), failedCount: z.number().int().nonnegative(), unexpectedExternalRequests: z.number().int().nonnegative() }).strict(),
  taskGraph: z.object({ taskCount: z.number().int().nonnegative(), passedCount: z.number().int().nonnegative(), failedCount: z.number().int().nonnegative(), repairCount: z.number().int().nonnegative() }).strict(),
  generatedFiles: z.object({ createdCount: z.number().int().nonnegative(), changedCount: z.number().int().nonnegative(), checksumVerified: z.boolean() }).strict(),
  blockers: z.array(z.string().max(300)).max(20), warnings: z.array(z.string().max(300)).max(20),
  releaseEligible: z.boolean(), prohibitedActions: z.object({ deployment: z.boolean(), gitMutation: z.boolean(), customerDatabaseMigration: z.boolean(), customerDataAccess: z.boolean(), arbitraryBrowsing: z.boolean(), screenshots: z.boolean() }).strict(),
}).strict();
export type RealFactoryE2EReport = z.infer<typeof RealFactoryE2EReportSchema>;

