import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TechnicalArchitectureSchema, type TechnicalArchitecture } from "@/domain/architecture/schema";
import { createDatabaseDecisionProposal } from "@/domain/contracts/phase7c";
import { AgentTaskSchema, TaskGraphSchema, type AgentTask } from "@/domain/tasks/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { implementationOrchestrator } from "./implementation-routing";

const timestamp = "2026-01-01T00:00:00.000Z";
const projectId = randomUUID();
const databaseDecision = (mode: "SUPABASE_NEW" | "NONE" = "SUPABASE_NEW") => createDatabaseDecisionProposal({ databaseDecisionId: randomUUID(), projectId, projectVersion: 1, createdAt: timestamp, planningChecksum: "a".repeat(64), recommendation: mode === "NONE" ? "NOT_REQUIRED" : "REQUIRED", rationale: "Synthetic routing fixture.", mode });

const architecture = (overrides: Partial<TechnicalArchitecture> = {}) => TechnicalArchitectureSchema.parse({
  schemaVersion: 1,
  documentType: "architecture",
  projectId,
  projectVersion: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  applicationProfile: "business-site",
  packageManager: "npm",
  routes: [{ path: "/", responsibility: "Home" }],
  componentBoundaries: ["Header"],
  componentDecisions: [{ area: "Header", serverOrClient: "server", rationale: "No interaction" }],
  serverActions: [],
  routeHandlers: [],
  backendPriority: [],
  supabaseDatabaseRequirements: [],
  schemaPlan: [],
  rlsRequirements: [],
  authenticationPlan: "None",
  storagePlan: "None",
  emailPlan: "None",
  environmentVariables: [],
  dependencies: [],
  npmScripts: { build: "next build" },
  testStrategy: ["Unit"],
  securityControls: ["Validation"],
  rejectedInfrastructure: [],
  acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "test" },
  ...overrides,
});

const task = (taskType: string, overrides: Partial<AgentTask> = {}) => AgentTaskSchema.parse({
  id: randomUUID(),
  projectId,
  projectVersion: 1,
  role: "implementation",
  taskType,
  title: taskType,
  objective: `Implement ${taskType}`,
  inputs: ["approved specification"],
  expectedOutputs: ["bounded artifact"],
  requirementReferences: ["requirement:test"],
  planningReferences: ["planning:test"],
  selectedDesignReferences: [],
  acceptanceCriteria: ["matches contract"],
  allowedSkills: [],
  allowedTools: ["filesystem-read", "filesystem-write"],
  deniedTools: ["git-write"],
  requiredCapabilities: [],
  fileScopes: ["src/**"],
  dependencies: [],
  status: "ready",
  executionMode: "exclusive-write",
  attempt: 0,
  maxAttempts: 1,
  createdAt: timestamp,
  ...overrides,
});

describe("typed implementation specialist routing", () => {
  it.each([
    ["implement-shared-component", "FRONTEND", "frontend-implementation"],
    ["implement-form", "FRONTEND", "frontend-implementation"],
    ["implement-route-handler", "BACKEND", "backend-implementation"],
    ["implement-database-schema", "DATABASE", "database-implementation"],
    ["implement-rls-policy", "DATABASE", "database-implementation"],
  ])("routes %s by typed intent", (taskType, domain, profileId) => {
    const candidate = task(taskType);
    const decision = implementationOrchestrator.resolveTask({
      task: candidate,
      architecture: architecture(taskType === "implement-route-handler" ? { routeHandlers: ["POST /api/test"] } : {}),
      phase7c: taskType.includes("database") || taskType === "implement-rls-policy" ? { databaseDecision: databaseDecision() } : undefined,
    });
    expect(decision).toMatchObject({ domain, specialistProfileId: profileId, owner: "specialist", status: "ACTIVE" });
  });

  it("keeps backend and database inactive for a static/client-only architecture", () => {
    const frontend = task("implement-page");
    const backend = task("implement-route-handler");
    const database = task("implement-database-schema");
    const graphBase = {
      schemaVersion: 1 as const,
      documentType: "task-graph" as const,
      projectId,
      projectVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks: [frontend, backend, database],
      checkpoint: "graph-validated" as const,
      readyForExecution: true,
      blockingReasons: [],
      warnings: [],
    };
    const graph = TaskGraphSchema.parse({ ...graphBase, graphChecksum: checksumPersistedDocument(graphBase) });
    const classified = implementationOrchestrator.classifyGraph({ graph, architecture: architecture() });
    expect(classified.activation).toMatchObject({ frontend: "ACTIVE", backend: "NOT_REQUIRED", database: "NOT_REQUIRED" });
    expect(classified.activation.contradictions).toHaveLength(2);
    expect(classified.counts).toMatchObject({ FRONTEND: 1, BACKEND: 1, DATABASE: 1 });
  });

  it("activates backend without database, and database only when Phase 7C requires it", () => {
    const backend = implementationOrchestrator.resolveTask({ task: task("implement-route-handler"), architecture: architecture({ routeHandlers: ["POST /api/test"] }) });
    const database = implementationOrchestrator.resolveTask({ task: task("implement-database-schema"), architecture: architecture(), phase7c: { databaseDecision: databaseDecision() } });
    expect(backend.status).toBe("ACTIVE");
    expect(database.status).toBe("ACTIVE");
    expect(database.specialistProfileId).toBe("database-implementation");
  });

  it("fails closed for an ambiguous implementation type", () => {
    const decision = implementationOrchestrator.resolveTask({ task: task("implement-unknown"), architecture: architecture() });
    expect(decision).toMatchObject({ owner: "orchestrator", status: "UNROUTABLE" });
  });

  it("keeps deterministic validation on the Factory QA boundary", () => {
    const decision = implementationOrchestrator.resolveTask({ task: task("validate-build"), architecture: architecture() });
    expect(decision).toMatchObject({ owner: "orchestrator", status: "NOT_REQUIRED" });
  });

  it("fails closed when specialist metadata disagrees with typed intent", () => {
    const decision = implementationOrchestrator.resolveTask({
      task: task("implement-page", { implementationDomain: "BACKEND", specialistProfileId: "backend-implementation" }),
      architecture: architecture(),
    });
    expect(decision).toMatchObject({ owner: "orchestrator", status: "UNROUTABLE" });
  });

  it("does not let specialist metadata authorize an unknown task type", () => {
    const decision = implementationOrchestrator.resolveTask({
      task: task("implement-unknown", { implementationDomain: "FRONTEND", specialistProfileId: "frontend-implementation" }),
      architecture: architecture(),
    });
    expect(decision).toMatchObject({ owner: "orchestrator", status: "UNROUTABLE" });
  });

  it("treats explicit no-* architecture plans as inactive", () => {
    const classified = implementationOrchestrator.classifyGraph({
      graph: TaskGraphSchema.parse({
        schemaVersion: 1,
        documentType: "task-graph",
        projectId,
        projectVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        tasks: [task("implement-page"), task("implement-route-handler"), task("implement-database-schema")],
        checkpoint: "graph-validated",
        readyForExecution: true,
        blockingReasons: [],
        warnings: [],
      }),
      architecture: architecture({ authenticationPlan: "Keine Authentifizierung; ausschließlich Gastzugriff.", storagePlan: "Keine Laufzeit- oder Formulardatenspeicherung.", emailPlan: "Kein E-Mail-Versand und keine E-Mail-Verarbeitung." }),
      phase7c: { databaseDecision: databaseDecision("NONE") },
    });
    expect(classified.activation).toMatchObject({ backend: "NOT_REQUIRED", database: "NOT_REQUIRED" });
    expect(classified.activation.missingTaskDomains).toEqual([]);
  });
});
