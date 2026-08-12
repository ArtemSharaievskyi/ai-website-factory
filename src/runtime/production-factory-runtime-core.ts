import path from "node:path";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import {
  createLeadAgentService,
  type LeadAgentService,
} from "@/agents/lead/service";
import { LeadMemoryAdapter } from "@/agents/lead/memory";
import {
  createPlannerArchitectService,
  type PlannerArchitectService,
} from "@/agents/planner/service";
import { PlannerMemoryAdapter } from "@/agents/planner/memory";
import {
  createDesignAgentService,
  type DesignAgentService,
} from "@/agents/design/service";
import { DesignMemoryAdapter } from "@/agents/design/memory";
import { ProfessionalDesignCapabilityPipeline } from "@/agents/design/professional";
import { ArchitectureReviewService } from "@/agents/reviewers/architecture/service";
import { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import { ContractAuditService } from "@/agents/reviewers/contracts/service";
import { ContractAuditOrchestrationService } from "@/orchestration/contract-audit/service";
import { CodeIntegrationReviewService } from "@/agents/reviewers/code-integration/service";
import { CodeIntegrationReviewOrchestrationService } from "@/orchestration/code-integration-review/service";
import { SecurityReviewService } from "@/agents/reviewers/security/service";
import { SecurityReviewOrchestrationService } from "@/orchestration/security-review/service";
import { TestQualityReviewOrchestrationService } from "@/orchestration/test-quality-review/service";
import { TestQualityReviewService } from "@/agents/reviewers/test-quality/service";
import {
  OrchestratorService,
  type OrchestratorMemoryPort,
} from "@/orchestration/orchestrator/service";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { WorkspaceManager } from "@/runtime/workspace/manager";
import { ProjectMemoryStore } from "@/persistence/project-memory/store";
import { versionDirectoryName } from "@/runtime/workspace/schemas";
import {
  DecisionRepository,
  ProjectVersionRepository,
} from "@/persistence/database/repositories";
import {
  createPostgresPool,
  PostgresPersistenceDatabase,
} from "@/persistence/database/postgres";
import { GeneratedRuntimeValidator } from "@/runtime/validation/service";
import { NodeRuntimeProcessRunner } from "@/runtime/validation/runner";
import { FunctionalQaService } from "@/runtime/qa/service";
import { NodeLocalTestServer } from "@/runtime/qa/server";
import { PlaywrightBrowserRunner } from "@/runtime/qa/browser";
import { FullTaskGraphExecutor } from "@/orchestration/execution/service";
import {
  ProductionExecutionStateAdapter,
  ProductionTaskExecutorAdapter,
  createProductionRepairer,
  type ProductionExecutionContext,
} from "@/orchestration/execution/production-adapters";
import {
  ImplementationAgentService,
  type ImplementationMemoryPort,
} from "@/agents/implementation/service";
import type { FullExecutionPolicy } from "@/orchestration/execution/contracts";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  readCodebaseMemoryConfig,
  CodebaseMemoryService,
} from "@/integrations/codebase-memory";
import { createProcessTransport } from "@/integrations/codebase-memory/transport";
import { SkillRegistry } from "@/skills/registry/registry";
import {
  resolveApprovedSkillContext,
  prepareAgentSkillContext,
  toReviewerSkillSelection,
} from "@/skills/runtime/resolver";
import {
  architectureReviewerAgentDefinition,
  contractAuditorAgentDefinition,
  leadAgentDefinition,
  plannerAgentDefinition,
  designAgentDefinition,
  implementationAgentDefinition,
  codeIntegrationReviewerAgentDefinition,
  securityReviewerAgentDefinition,
  testQualityReviewerAgentDefinition,
} from "@/agents/catalog";
import { classifySecuritySurface } from "@/agents/reviewers/security/deterministic";
export const RUNTIME_MODES = ["DETERMINISTIC_TEST", "REAL_E2E"] as const;
export type FactoryRuntimeMode = (typeof RUNTIME_MODES)[number];
export type ProductionAdapterIdentity = {
  mode: "production";
  leadProviderMode: "production";
  plannerProviderMode: "production";
  designProviderMode: "production";
  implementationProviderMode: "production";
  processRunnerMode: "real";
  browserRunnerMode: "real";
  executionStateMode: "production";
  taskExecutorMode: "production";
  repairerMode: "production";
  fullExecutorMode: "production";
  context7: "configured" | "not-needed" | "blocked";
  shadcn: "configured" | "not-needed" | "blocked";
  codebaseMemory: "configured" | "not-needed" | "blocked";
};
export type ProductionFactoryProjectScope = {
  database: PersistenceDatabase;
  lead: LeadAgentService;
  planner: PlannerArchitectService;
  design: DesignAgentService;
  architectureReviewer: ArchitectureReviewOrchestrationService;
  contractAuditor: ContractAuditOrchestrationService;
  codeIntegrationReviewer: CodeIntegrationReviewOrchestrationService;
  securityReviewer: SecurityReviewOrchestrationService;
  testQualityReviewer?: TestQualityReviewOrchestrationService;
  orchestrator: OrchestratorService;
  implementation: ImplementationAgentService;
  workspace: WorkspaceManager;
  runtimeValidator: GeneratedRuntimeValidator;
  functionalQa: FunctionalQaService;
  codebaseMemory?: CodebaseMemoryService;
  createFullExecutor(
    input: ProductionExecutionContext & { policy?: FullExecutionPolicy },
  ): FullTaskGraphExecutor;
};
export type ProductionFactoryRuntimeEvidence = {
  providerRequests: number;
  inputTokens: number;
  outputTokens: number;
  roles: Record<string, number>;
};
export type ProductionFactoryRuntime = {
  mode: "REAL_E2E";
  identity: ProductionAdapterIdentity;
  database: PersistenceDatabase;
  ai: ReturnType<typeof createProductionProviderBundle>;
  evidence: ProductionFactoryRuntimeEvidence;
  generatedProjectsRoot?: string;
  createProjectScope(input: {
    workspaceRoot: string;
    slug: string;
  }): ProductionFactoryProjectScope;
  close(): Promise<void>;
};
function assertRealMode(env: Record<string, string | undefined>) {
  if (env.ALLOW_REAL_FACTORY_E2E !== "true")
    throw new Error("REAL_E2E_OPT_IN_REQUIRED");
}
export function createProductionFactoryIdentity(
  options: {
    context7?: "configured" | "not-needed" | "blocked";
    shadcn?: "configured" | "not-needed" | "blocked";
    codebaseMemory?: "configured" | "not-needed" | "blocked";
  } = {},
): ProductionAdapterIdentity {
  return {
    mode: "production",
    leadProviderMode: "production",
    plannerProviderMode: "production",
    designProviderMode: "production",
    implementationProviderMode: "production",
    processRunnerMode: "real",
    browserRunnerMode: "real",
    executionStateMode: "production",
    taskExecutorMode: "production",
    repairerMode: "production",
    fullExecutorMode: "production",
    context7: options.context7 ?? "not-needed",
    shadcn: options.shadcn ?? "not-needed",
    codebaseMemory: options.codebaseMemory ?? "not-needed",
  };
}
export function createProductionFactoryRuntime(
  options: {
    env?: Record<string, string | undefined>;
    context7?: "configured" | "not-needed" | "blocked";
    shadcn?: "configured" | "not-needed" | "blocked";
    generatedProjectsRoot?: string;
  } = {},
): ProductionFactoryRuntime {
  const env = options.env ?? process.env;
  assertRealMode(env);
  const pool = createPostgresPool();
  const database = new PostgresPersistenceDatabase(pool);
  const evidence: ProductionFactoryRuntimeEvidence = {
    providerRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    roles: {},
  };
  const ai = createProductionProviderBundle({
    env,
    usageSink: async (usage) => {
      evidence.providerRequests += usage.requestCount;
      evidence.inputTokens += usage.inputTokens;
      evidence.outputTokens += usage.outputTokens;
      evidence.roles[usage.role] =
        (evidence.roles[usage.role] ?? 0) + usage.requestCount;
    },
  });
  const codebaseConfig = readCodebaseMemoryConfig(env);
  const identity = createProductionFactoryIdentity({
    ...options,
    codebaseMemory: codebaseConfig.enabled ? "configured" : "not-needed",
  });
  const skillRegistry = new SkillRegistry(path.join(process.cwd(), "skills"));
  const resolveArchitectureSkills = async (
    input: import("@/agents/reviewers/architecture/contracts").ArchitectureReviewInput,
  ) =>
    toReviewerSkillSelection(
      await resolveApprovedSkillContext(skillRegistry, {
        agent: architectureReviewerAgentDefinition,
        capability: "review.architecture",
        taskType: "review-architecture",
        projectSurfaces: ["architecture", "modules"],
        requiredCoverage: ["module-boundaries", "architecture-review"],
        requestedTools: [],
        contextBudgetBytes:
          architectureReviewerAgentDefinition.contextPolicy.maxBytes,
        reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
      }),
    );
  const resolveContractSkills = async (
    input: import("@/agents/reviewers/contracts/contracts").ContractAuditInput,
  ) =>
    toReviewerSkillSelection(
      await resolveApprovedSkillContext(skillRegistry, {
        agent: contractAuditorAgentDefinition,
        capability: "review.contracts",
        taskType: "review-contracts",
        projectSurfaces: ["requirements", "contracts", "traceability"],
        requiredCoverage: [
          "acceptance-criteria",
          "requirements-contracts",
          "traceability",
        ],
        requestedTools: [],
        contextBudgetBytes:
          contractAuditorAgentDefinition.contextPolicy.maxBytes,
        reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
      }),
    );
  const resolveSecuritySkills = async (
    input: import("@/agents/reviewers/security/contracts").SecurityReviewInput,
  ) => {
    const securitySurfaces = classifySecuritySurface(input);
    const projectSurfaces = input.acceptedPlanningPackage.supabase.postgres
      ? ["supabase", "postgres", "user-scoped-data"]
      : input.sourceManifest.some((file) => /rls/i.test(file.relativePath))
        ? ["rls"]
        : ["NONE"];
    return toReviewerSkillSelection(
      await resolveApprovedSkillContext(skillRegistry, {
        agent: securityReviewerAgentDefinition,
        capability: "review.security",
        taskType: "review-security",
        projectSurfaces,
        requiredCoverage: [
          "supabase-rls",
          "row-level-authorization",
          "user-scoped-data",
        ],
        requestedTools: [],
        contextBudgetBytes:
          securityReviewerAgentDefinition.contextPolicy.maxBytes,
        reservedContextBytes: Buffer.byteLength(
          JSON.stringify({ input, securitySurfaces }),
          "utf8",
        ),
      }),
    );
  };
  const resolveLeadSkills = async (
    input: import("@/agents/lead/contracts").LeadAgentInput,
  ) =>
    prepareAgentSkillContext(skillRegistry, {
      agent: leadAgentDefinition,
      capability: "requirements.clarify",
      taskType: "clarify-requirements",
      projectSurfaces: Object.keys(input.knownUserAnswers ?? {}).length < 3 ? ["clarification"] : [],
      requiredCoverage: Object.keys(input.knownUserAnswers ?? {}).length < 3 ? ["requirements-completeness"] : [],
      requestedTools: [],
      contextBudgetBytes: leadAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  const resolvePlannerSkills = async (
    input: import("@/agents/planner/contracts").PlannerAgentInput,
  ) => {
    const brief = input.approvedBrief;
    const hasData = brief.backendRequirements.length > 0 || brief.supabaseRequirements.length > 0 || brief.authenticationDecision === "authentication-required" || brief.storageDecision === "needed";
    const hasRisk = brief.technicalConstraints.length > 0 || hasData;
    const projectSurfaces = [
      ...(hasData ? ["data", "database", "schema"] : []),
      ...(hasRisk ? ["risk", "integrations"] : []),
    ];
    return prepareAgentSkillContext(skillRegistry, {
      agent: plannerAgentDefinition,
      capability: "planning.architecture",
      taskType: "create-technical-architecture",
      projectSurfaces,
      requiredCoverage: [
        ...(hasData ? ["data-model-planning"] : []),
        ...(hasRisk ? ["technical-risk-planning"] : []),
      ],
      requestedTools: [],
      contextBudgetBytes: plannerAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  };
  const resolveDesignSkills = async (
    input: import("@/agents/design/contracts").DesignAgentInput,
  ) => {
    const hasForm = input.acceptedPlanningPackage.forms.forms.length > 0 || input.approvedBrief.forms.length > 0;
    return prepareAgentSkillContext(skillRegistry, {
      agent: designAgentDefinition,
      capability: "design.directions",
      taskType: "create-design-directions",
      projectSurfaces: hasForm ? ["responsive", "forms"] : [],
      requiredCoverage: hasForm ? ["responsive-form-ux"] : [],
      requestedTools: [],
      contextBudgetBytes: designAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  };
  const resolveImplementationSkills = async (
    input: import("@/agents/implementation/contracts").ImplementationAgentInput,
  ) => {
    const taskType = input.task.taskType;
    const backend = ["implement-database-schema", "implement-rls-policy", "implement-authentication", "implement-storage", "implement-email"].includes(taskType) || input.task.fileScopes.some((scope) => /supabase|src\/lib\/(auth|storage|email)/i.test(scope));
    const form = taskType === "implement-form";
    const performance = /performance|maintain|refactor/i.test(taskType);
    const projectSurfaces = backend
      ? ["supabase", "database", "auth", "storage"]
      : form
        ? ["forms", "validation", "typed"]
        : performance
          ? ["performance", "maintenance"]
          : ["nextjs", "server", "client", "page", "component"];
    return prepareAgentSkillContext(skillRegistry, {
      agent: implementationAgentDefinition,
      capability: backend ? "implementation.backend" : "implementation.code",
      taskType: backend ? "implement-backend" : "implement-frontend",
      projectSurfaces,
      requiredCoverage: backend
        ? ["supabase-implementation"]
        : form
          ? ["forms-validation"]
          : performance
            ? ["maintainability-performance"]
            : ["nextjs-implementation", "server-client-boundaries"],
      requestedTools: input.task.allowedTools,
      contextBudgetBytes: implementationAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  };
  const resolveCodeIntegrationSkills = async (
    input: import("@/agents/reviewers/code-integration/contracts").CodeIntegrationReviewInput,
  ) =>
    prepareAgentSkillContext(skillRegistry, {
      agent: codeIntegrationReviewerAgentDefinition,
      capability: "review.integration",
      taskType: "review-code-integration",
      projectSurfaces: input.sourceManifest.some((file) => /react|next|components|routes|forms/i.test(file.relativePath)) ? ["react", "nextjs", "components", "routes", "forms"] : [],
      requiredCoverage: ["react-review", "nextjs-review"],
      requestedTools: [],
      contextBudgetBytes: codeIntegrationReviewerAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  const resolveTestQualitySkills = async (
    input: import("@/agents/reviewers/test-quality/contracts").TestQualityReviewInput,
  ) =>
    prepareAgentSkillContext(skillRegistry, {
      agent: testQualityReviewerAgentDefinition,
      capability: "review.test-quality",
      taskType: "review-test-quality",
      projectSurfaces: ["requirements", "tests", "behavior"],
      requiredCoverage: ["requirements-traceability", "test-strategy", "meaningful-assertions"],
      requestedTools: [],
      contextBudgetBytes: testQualityReviewerAgentDefinition.contextPolicy.maxBytes,
      reservedContextBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    });
  return {
    mode: "REAL_E2E",
    identity,
    database,
    ai,
    evidence,
    generatedProjectsRoot: options.generatedProjectsRoot,
    createProjectScope: ({ workspaceRoot, slug }) => {
      const decisions = new DecisionRepository(database);
      const versions = new ProjectVersionRepository(database);
      const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
      const workspace = new WorkspaceManager({ root: workspaceRoot, versions });
      const memoryRoot = (version: number) =>
        new ProjectMemoryStore(
          `${workspaceRoot}/${slug}/${versionDirectoryName(version)}/.factory`,
        );
      const lead = createLeadAgentService({
        database,
        provider: ai.lead,
        memory: new LeadMemoryAdapter(sync, decisions, workspaceRoot),
        resolveSkills: resolveLeadSkills,
      });
      const planner = createPlannerArchitectService({
        database,
        provider: ai.planner,
        memory: new PlannerMemoryAdapter(sync, decisions, workspaceRoot),
        resolveSkills: resolvePlannerSkills,
      });
      const design = createDesignAgentService({
        database,
        provider: ai.design,
        memory: new DesignMemoryAdapter(sync, workspaceRoot),
        resolveSkills: resolveDesignSkills,
        professionalPipeline: new ProfessionalDesignCapabilityPipeline(),
      });
      const architectureReviewer = new ArchitectureReviewOrchestrationService(
        database,
        new ArchitectureReviewService(database, {
          provider: ai.architectureReviewer,
          resolveSkills: resolveArchitectureSkills,
        }),
      );
      const contractAuditor = new ContractAuditOrchestrationService(
        database,
        new ContractAuditService(database, {
          provider: ai.contractAuditor,
          resolveSkills: resolveContractSkills,
        }),
      );
      const codeIntegrationReviewer =
        new CodeIntegrationReviewOrchestrationService(
          database,
          new CodeIntegrationReviewService(database, {
          provider: ai.codeIntegrationReviewer,
          resolveSkills: resolveCodeIntegrationSkills,
          }),
        );
      const securityReviewer = new SecurityReviewOrchestrationService(
        database,
        new SecurityReviewService(database, {
          provider: ai.securityReviewer,
          resolveSkills: resolveSecuritySkills,
        }),
      );
      const testQualityReviewer = new TestQualityReviewOrchestrationService(
        database,
        new TestQualityReviewService(database, {
          provider: ai.testQualityReviewer,
          resolveSkills: resolveTestQualitySkills,
        }),
      );
      const implementationMemory: ImplementationMemoryPort = {
        writeSnapshot: (projectId, version, documents) =>
          sync.writeVersionSnapshot(projectId, version, documents),
      };
      const codebaseMemory = codebaseConfig.enabled
        ? new CodebaseMemoryService(
            createProcessTransport(
              codebaseConfig.executable ?? "codebase-memory-mcp",
              workspaceRoot,
              codebaseConfig.timeoutMs,
            ),
            codebaseConfig,
          )
        : undefined;
      const implementation = new ImplementationAgentService(database, {
        provider: ai.implementation,
        resolveSkills: resolveImplementationSkills,
        memory: implementationMemory,
        codebaseMemory: codebaseMemory
          ? {
              port: codebaseMemory,
              scope: ({ projectId, projectVersion, stagingWorkspacePath }) => ({
                projectId,
                projectVersion,
                workspacePath: stagingWorkspacePath,
                generatedProjectsRoot:
                  options.generatedProjectsRoot ?? workspaceRoot,
                workspaceManagerReference: `${slug}:v${projectVersion}`,
              }),
            }
          : undefined,
        workspace: {
          verifyStaging: (_projectId, version, reservationId, stagingPath) =>
            workspace.verifyStagingWorkspace(
              slug,
              version,
              reservationId,
              stagingPath,
            ),
        },
      });
      const orchestratorMemory: OrchestratorMemoryPort = {
        writeSnapshot: (projectId, version, documents) =>
          sync.writeVersionSnapshot(projectId, version, documents),
        appendDecision: async (projectId, version, decision) => {
          await memoryRoot(version).appendDecision(
            decision as Parameters<ProjectMemoryStore["appendDecision"]>[0],
          );
          await decisions.append(
            projectId,
            version,
            decision as Parameters<DecisionRepository["append"]>[2],
          );
        },
      };
      const orchestrator = new OrchestratorService(database, {
        memory: orchestratorMemory,
        workspace: {
          verify: async (_projectId, version) =>
            workspace.verifyVersion(slug, version).then(() => true),
        },
      });
      const runtimeValidator = new GeneratedRuntimeValidator(
        new NodeRuntimeProcessRunner(),
      );
      const functionalQa = new FunctionalQaService(
        new NodeLocalTestServer(),
        new PlaywrightBrowserRunner(),
      );
      return {
        database,
        lead,
        planner,
        design,
        architectureReviewer,
        contractAuditor,
        codeIntegrationReviewer,
        securityReviewer,
        testQualityReviewer,
        orchestrator,
        implementation,
        workspace,
        runtimeValidator,
        functionalQa,
        codebaseMemory,
        createFullExecutor: (context) => {
          const state = new ProductionExecutionStateAdapter(
            database,
            context.workspacePath,
          );
          const executors = new ProductionTaskExecutorAdapter(
            database,
            context,
            implementation,
            runtimeValidator,
            functionalQa,
          );
          const repairer = createProductionRepairer(orchestrator);
          return new FullTaskGraphExecutor(
            state,
            executors,
            repairer,
            context.policy,
          );
        },
      };
    },
    close: async () => {
      await pool.end();
    },
  };
}
export function validateProductionFactoryRuntime(
  runtime: ProductionFactoryRuntime,
) {
  const identity = runtime.identity;
  const valid =
    runtime.mode === "REAL_E2E" &&
    identity.mode === "production" &&
    identity.leadProviderMode === "production" &&
    identity.plannerProviderMode === "production" &&
    identity.designProviderMode === "production" &&
    identity.implementationProviderMode === "production" &&
    identity.processRunnerMode === "real" &&
    identity.browserRunnerMode === "real" &&
    identity.executionStateMode === "production" &&
    identity.taskExecutorMode === "production" &&
    identity.repairerMode === "production" &&
    identity.fullExecutorMode === "production";
  if (!valid) throw new Error("REAL_E2E_PRODUCTION_COMPOSITION_INVALID");
  return true;
}
