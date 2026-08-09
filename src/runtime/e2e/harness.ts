import { randomUUID } from "node:crypto";
import { RealFactoryE2EReportSchema, type RealFactoryE2EReport } from "./contracts";
import type { RealFactoryE2EPreflight } from "./preflight";
import { runProductionE2EStages, VELOFIX_SMOKE_SPECIFICATION } from "@/runtime/production-e2e-stage-runner";
import type { ProductionFactoryRuntime } from "@/runtime/production-factory-runtime";
import type { RealFactoryE2EResumeInput } from "@/runtime/production-e2e-stage-runner";
export { VELOFIX_WERKSTATT_PROMPT } from "./spec";


const productionIdentity = { leadProviderMode: "production", plannerProviderMode: "production", designProviderMode: "production", implementationProviderMode: "production", processRunnerMode: "real", browserRunnerMode: "real", executionStateMode: "production", taskExecutorMode: "production", repairerMode: "production", fullExecutorMode: "production" } as const;

export function assertRealDependencies(runtime: ProductionFactoryRuntime | undefined, preflight: RealFactoryE2EPreflight) { if (!runtime) throw new Error("REAL_E2E_PRODUCTION_RUNTIME_REQUIRED"); if (preflight.status !== "passed") throw new Error("REAL_E2E_PREFLIGHT_REQUIRED"); }

export async function runRealFactoryE2E(input: { preflight: RealFactoryE2EPreflight; generatedProjectsRoot: string; runtime?: ProductionFactoryRuntime; resume?: RealFactoryE2EResumeInput }): Promise<RealFactoryE2EReport> {
  const smokeId = input.resume?.smokeId ?? randomUUID(); const startedAt = new Date().toISOString();
  const base = { schemaVersion: 1 as const, reportType: "real-factory-e2e" as const, smokeId, startedAt, optIn: input.preflight.optIn, preflightPassed: input.preflight.status === "passed", adapterIdentity: productionIdentity, realStageEvidence: { leadRequest: false, plannerRequest: false, designRequest: false, implementationRequest: false, npmExecution: false, browserExecution: false }, stages: [], provider: { status: input.preflight.integrations.provider, requestCount: 0, inputTokens: 0, outputTokens: 0 }, context7: { status: input.preflight.integrations.context7, requestCount: 0 }, shadcn: { status: input.preflight.integrations.shadcn, requestCount: 0 }, npm: { status: "not-configured" as const, commands: ["npm ci", "npm run lint", "npm run typecheck", "npm test -- --run", "npm run build"], passedCount: 0, failedCount: 0 }, playwright: { status: "not-configured" as const, scenarios: 0, passedCount: 0, failedCount: 0, unexpectedExternalRequests: 0 }, taskGraph: { taskCount: 0, passedCount: 0, failedCount: 0, repairCount: 0 }, generatedFiles: { createdCount: 0, changedCount: 0, checksumVerified: false }, blockers: [...input.preflight.blockers], warnings: [...input.preflight.warnings], releaseEligible: false, prohibitedActions: { deployment: false, gitMutation: false, customerDatabaseMigration: false, customerDataAccess: false, arbitraryBrowsing: false, screenshots: false } };
  if (input.preflight.status !== "passed") return RealFactoryE2EReportSchema.parse({ ...base, overallStatus: input.preflight.status === "pending" ? "pending" : "failed", completedAt: new Date().toISOString() });
  assertRealDependencies(input.runtime, input.preflight);
  return runProductionE2EStages({ specification: VELOFIX_SMOKE_SPECIFICATION, runtime: input.runtime!, smokeId, signal: undefined, resume: input.resume });
}
