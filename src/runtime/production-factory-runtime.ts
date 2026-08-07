import "server-only";
import { createProductionProviderBundle } from "../ai-provider/server";
import { createLeadAgentService, type LeadAgentService } from "../lead/service";
import { LeadMemoryAdapter } from "../lead/memory";
import { createPlannerArchitectService, type PlannerArchitectService } from "../planner/service";
import { PlannerMemoryAdapter } from "../planner/memory";
import { createDesignAgentService, type DesignAgentService } from "../design-agent/service";
import { DesignMemoryAdapter } from "../design-agent/memory";
import { OrchestratorService, type OrchestratorMemoryPort } from "../orchestrator/service";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { WorkspaceManager } from "../workspace/manager";
import { ProjectMemoryStore } from "../project-memory/store";
import { versionDirectoryName } from "../workspace/schemas";
import { DecisionRepository, ProjectVersionRepository } from "../persistence/repositories";
import { createPostgresPool, PostgresPersistenceDatabase } from "../persistence/postgres";
import { GeneratedRuntimeValidator } from "../runtime-validation/service";
import { NodeRuntimeProcessRunner } from "../runtime-validation/runner";
import { FunctionalQaService } from "../playwright-functional-qa/service";
import { NodeLocalTestServer } from "../playwright-functional-qa/server";
import { PlaywrightBrowserRunner } from "../playwright-functional-qa/browser";
import { FullTaskGraphExecutor } from "../full-execution/service";
import { ProductionExecutionStateAdapter, ProductionTaskExecutorAdapter, createProductionRepairer, type ProductionExecutionContext } from "../full-execution/production-adapters";
import { ImplementationAgentService, type ImplementationMemoryPort } from "../implementation-agent/service";
import type { FullExecutionPolicy } from "../full-execution/contracts";
import type { PersistenceDatabase } from "../persistence/types";
import { readCodebaseMemoryConfig, CodebaseMemoryService } from "../codebase-memory";
import { createProcessTransport } from "../codebase-memory/transport";

export const RUNTIME_MODES = ["DETERMINISTIC_TEST", "REAL_E2E"] as const;
export type FactoryRuntimeMode = typeof RUNTIME_MODES[number];
export type ProductionAdapterIdentity = { mode: "production"; leadProviderMode: "production"; plannerProviderMode: "production"; designProviderMode: "production"; implementationProviderMode: "production"; processRunnerMode: "real"; browserRunnerMode: "real"; executionStateMode: "production"; taskExecutorMode: "production"; repairerMode: "production"; fullExecutorMode: "production"; context7: "configured" | "not-needed" | "blocked"; shadcn: "configured" | "not-needed" | "blocked"; codebaseMemory: "configured" | "not-needed" | "blocked" };
export type ProductionFactoryProjectScope = { database: PersistenceDatabase; lead: LeadAgentService; planner: PlannerArchitectService; design: DesignAgentService; orchestrator: OrchestratorService; implementation: ImplementationAgentService; workspace: WorkspaceManager; runtimeValidator: GeneratedRuntimeValidator; functionalQa: FunctionalQaService; codebaseMemory?: CodebaseMemoryService; createFullExecutor(input: ProductionExecutionContext & { policy?: FullExecutionPolicy }): FullTaskGraphExecutor };
export type ProductionFactoryRuntimeEvidence = { providerRequests: number; inputTokens: number; outputTokens: number; roles: Record<string, number> };
export type ProductionFactoryRuntime = { mode: "REAL_E2E"; identity: ProductionAdapterIdentity; database: PersistenceDatabase; ai: ReturnType<typeof createProductionProviderBundle>; evidence: ProductionFactoryRuntimeEvidence; generatedProjectsRoot?: string; createProjectScope(input: { workspaceRoot: string; slug: string }): ProductionFactoryProjectScope; close(): Promise<void> };

function assertRealMode(env: Record<string, string | undefined>) { if (env.ALLOW_REAL_FACTORY_E2E !== "true") throw new Error("REAL_E2E_OPT_IN_REQUIRED"); }
export function createProductionFactoryIdentity(options: { context7?: "configured" | "not-needed" | "blocked"; shadcn?: "configured" | "not-needed" | "blocked"; codebaseMemory?: "configured" | "not-needed" | "blocked" } = {}): ProductionAdapterIdentity { return { mode: "production", leadProviderMode: "production", plannerProviderMode: "production", designProviderMode: "production", implementationProviderMode: "production", processRunnerMode: "real", browserRunnerMode: "real", executionStateMode: "production", taskExecutorMode: "production", repairerMode: "production", fullExecutorMode: "production", context7: options.context7 ?? "not-needed", shadcn: options.shadcn ?? "not-needed", codebaseMemory: options.codebaseMemory ?? "not-needed" }; }

export function createProductionFactoryRuntime(options: { env?: Record<string, string | undefined>; context7?: "configured" | "not-needed" | "blocked"; shadcn?: "configured" | "not-needed" | "blocked"; generatedProjectsRoot?: string } = {}): ProductionFactoryRuntime {
  const env = options.env ?? process.env; assertRealMode(env);
  const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const evidence: ProductionFactoryRuntimeEvidence = { providerRequests: 0, inputTokens: 0, outputTokens: 0, roles: {} }; const ai = createProductionProviderBundle({ env, usageSink: async (usage) => { evidence.providerRequests += usage.requestCount; evidence.inputTokens += usage.inputTokens; evidence.outputTokens += usage.outputTokens; evidence.roles[usage.role] = (evidence.roles[usage.role] ?? 0) + usage.requestCount; } });
  const codebaseConfig = readCodebaseMemoryConfig(env); const identity = createProductionFactoryIdentity({ ...options, codebaseMemory: codebaseConfig.enabled ? "configured" : "not-needed" });
  return { mode: "REAL_E2E", identity, database, ai, evidence, generatedProjectsRoot: options.generatedProjectsRoot, createProjectScope: ({ workspaceRoot, slug }) => {
    const decisions = new DecisionRepository(database); const versions = new ProjectVersionRepository(database); const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug); const workspace = new WorkspaceManager({ root: workspaceRoot, versions });
    const memoryRoot = (version: number) => new ProjectMemoryStore(`${workspaceRoot}/${slug}/${versionDirectoryName(version)}/.factory`);
    const lead = createLeadAgentService({ database, provider: ai.lead, memory: new LeadMemoryAdapter(sync, decisions, workspaceRoot) });
    const planner = createPlannerArchitectService({ database, provider: ai.planner, memory: new PlannerMemoryAdapter(sync, decisions, workspaceRoot) });
    const design = createDesignAgentService({ database, provider: ai.design, memory: new DesignMemoryAdapter(sync, decisions, workspaceRoot) });
    const implementationMemory: ImplementationMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents) };
    const codebaseMemory = codebaseConfig.enabled ? new CodebaseMemoryService(createProcessTransport(codebaseConfig.executable ?? "codebase-memory-mcp", workspaceRoot, codebaseConfig.timeoutMs), codebaseConfig) : undefined;
    const implementation = new ImplementationAgentService(database, { provider: ai.implementation, memory: implementationMemory, codebaseMemory: codebaseMemory ? { port: codebaseMemory, scope: ({ projectId, projectVersion, stagingWorkspacePath }) => ({ projectId, projectVersion, workspacePath: stagingWorkspacePath, generatedProjectsRoot: options.generatedProjectsRoot ?? workspaceRoot, workspaceManagerReference: `${slug}:v${projectVersion}` }) } : undefined, workspace: { verifyStaging: (_projectId, version, reservationId, stagingPath) => workspace.verifyStagingWorkspace(slug, version, reservationId, stagingPath) } });
    const orchestratorMemory: OrchestratorMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents), appendDecision: async (projectId, version, decision) => { await memoryRoot(version).appendDecision(decision as Parameters<ProjectMemoryStore["appendDecision"]>[0]); await decisions.append(projectId, version, decision as Parameters<DecisionRepository["append"]>[2]); } };
    const orchestrator = new OrchestratorService(database, { memory: orchestratorMemory, workspace: { verify: async (_projectId, version) => workspace.verifyVersion(slug, version).then(() => true) } });
    const runtimeValidator = new GeneratedRuntimeValidator(new NodeRuntimeProcessRunner()); const functionalQa = new FunctionalQaService(new NodeLocalTestServer(), new PlaywrightBrowserRunner());
    return { database, lead, planner, design, orchestrator, implementation, workspace, runtimeValidator, functionalQa, codebaseMemory, createFullExecutor: (context) => { const state = new ProductionExecutionStateAdapter(database, context.workspacePath); const executors = new ProductionTaskExecutorAdapter(database, context, implementation, runtimeValidator, functionalQa); const repairer = createProductionRepairer(orchestrator); return new FullTaskGraphExecutor(state, executors, repairer, context.policy); } };
  }, close: async () => { await pool.end(); } };
}

export function validateProductionFactoryRuntime(runtime: ProductionFactoryRuntime) {
  const identity = runtime.identity; const valid = runtime.mode === "REAL_E2E" && identity.mode === "production" && identity.leadProviderMode === "production" && identity.plannerProviderMode === "production" && identity.designProviderMode === "production" && identity.implementationProviderMode === "production" && identity.processRunnerMode === "real" && identity.browserRunnerMode === "real" && identity.executionStateMode === "production" && identity.taskExecutorMode === "production" && identity.repairerMode === "production" && identity.fullExecutorMode === "production";
  if (!valid) throw new Error("REAL_E2E_PRODUCTION_COMPOSITION_INVALID"); return true;
}
