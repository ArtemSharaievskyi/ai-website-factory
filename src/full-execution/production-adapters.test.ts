import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InMemoryPersistenceDatabase } from "../persistence/fake";
import { ProjectRepository, ProjectVersionRepository, DocumentRepository } from "../persistence/repositories";
import { FactoryProjectSchema } from "../domain/project/schema";
import { TaskGraphSchema } from "../domain/tasks/schema";
import { checksumPersistedDocument } from "../persistence/serialization";
import { ProductionExecutionStateAdapter, ProductionTaskExecutorAdapter, formatUnresolvedRepairSummary } from "./production-adapters";

const projectId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-01-01T00:00:00.000Z";
function graph() { const task = { id: "22222222-2222-4222-8222-222222222222", projectId, projectVersion: 1, role: "implementation" as const, taskType: "implement-page", title: "Page", objective: "Build the approved page.", inputs: [], expectedOutputs: ["page"], allowedSkills: [], allowedTools: ["filesystem-write"], fileScopes: ["src/**"], dependencies: [], status: "ready" as const, attempt: 0, maxAttempts: 1, createdAt: timestamp }; const base = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [task], validation: { valid: true, errors: [], warnings: [] }, checkpoint: "implementation-started" as const, readyForExecution: true }; return TaskGraphSchema.parse({ ...base, graphChecksum: checksumPersistedDocument(base), sourceDocumentChecksums: { brief: "a".repeat(64) }, toolPolicyVersion: "tools-v1" }); }

describe("production FullTaskGraph adapters", () => {
  it("loads canonical graph/workflow state and persists bounded execution summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-execution-adapter-")); const db = new InMemoryPersistenceDatabase();
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "adapter-fixture", originalPrompt: "fixture", currentVersion: 1, workflowState: "IMPLEMENTING" });
    await new ProjectRepository(db).create(project); await new ProjectVersionRepository(db).create({ id: "33333333-3333-4333-8333-333333333333", projectId, versionNumber: 1, state: "IMPLEMENTING", memoryRootPath: root, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 }); await new DocumentRepository(db).save(graph());
    const state = new ProductionExecutionStateAdapter(db, root); const snapshot = await state.load({ projectId, projectVersion: 1 }); expect(snapshot.graph.documentType).toBe("task-graph"); expect(snapshot.workflowState).toBe("IMPLEMENTING");
    await state.saveSummary({ schemaVersion: 1, documentType: "full-execution", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, runId: "44444444-4444-4444-8444-444444444444", taskGraphChecksum: snapshot.graph.graphChecksum!, totalTasks: 1, passed: 1, failed: 0, cancelled: 0, blocked: 0, repairsAttempted: 0, repairsPassed: 0, qualityGates: [], finalWorkflowState: "VALIDATING", releaseEligible: true, blockers: [], warnings: [], sourceChecksums: { brief: "a".repeat(64) }, policyVersion: "full-taskgraph-v1", completedAt: timestamp }); expect((await new DocumentRepository(db).get(projectId, 1, "full-execution"))?.documentType).toBe("full-execution"); await rm(root, { recursive: true, force: true });
  });
  it("exposes only Factory-owned executor routes and handles policy validation", async () => {
    const adapter = new ProductionTaskExecutorAdapter(new InMemoryPersistenceDatabase(), { projectId, projectVersion: 1, workspacePath: "C:\\generated\\fixture", generatedProjectsRoot: "C:\\generated", workspaceReservationId: "reservation", sourceDocumentChecksums: {}, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: "orchestrator-v1" }, {} as never, {} as never, {} as never); const outcome = await adapter.dispatch({ runId: "55555555-5555-4555-8555-555555555555", projectId, projectVersion: 1, task: { id: "66666666-6666-4666-8666-666666666666", projectId, projectVersion: 1, role: "qa-release", taskType: "validate-security", title: "Security", objective: "Validate security.", inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: [], fileScopes: [], dependencies: [], status: "ready", attempt: 0, maxAttempts: 1, createdAt: timestamp }, graph: graph(), signal: new AbortController().signal }); expect(outcome.status).toBe("passed");
  });
  it("preserves run-level non-targetable failure attribution without inventing repair scope", () => { const failedTask = graph().tasks[0]!; const summary = formatUnresolvedRepairSummary({ failedTask, failure: { safeFailureCode: "QA_BROWSER_LAUNCH_FAILED", safeFailureSummary: "The browser launch failed safely.", diagnostics: [] }, resolution: { targetable: false, code: "REPAIR_TARGET_NOT_FOUND", reason: "The validation result contains no bounded file or route reference.", diagnostics: [] } }); expect(summary).toContain("failureCode=QA_BROWSER_LAUNCH_FAILED"); expect(summary).toContain("failureSummary=The browser launch failed safely."); expect(summary).toContain("diagnostics=0"); expect(summary).toContain("files=none"); expect(summary).not.toContain("*"); });
});
