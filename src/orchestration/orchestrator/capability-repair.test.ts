import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentTaskSchema, TaskGraphSchema } from "@/domain/tasks/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { OrchestratorService } from "./service";

const id = () => randomUUID();

describe("TaskGraph capability repair", () => {
  it("removes a legacy broad controlled-edit grant while preserving task identity and status", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = id();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const task = AgentTaskSchema.parse({ id: id(), projectId, projectVersion: 1, role: "implementation", taskType: "implement-project-foundation", title: "Foundation", objective: "Implement foundation", inputs: ["approved specification"], expectedOutputs: ["foundation"], requirementReferences: ["requirement:foundation"], planningReferences: ["planning:foundation"], selectedDesignReferences: [], acceptanceCriteria: ["The foundation matches the approved specification."], allowedSkills: [], allowedTools: ["filesystem-read", "filesystem-write", "controlled-edit"], deniedTools: [], requiredCapabilities: ["source.inspect", "edit.ast-patch"], fileScopes: ["src/app/**"], dependencies: [], status: "ready", attempt: 0, maxAttempts: 2, createdAt: timestamp });
    const validAstTask = AgentTaskSchema.parse({ ...task, id: id(), taskType: "implement-page", title: "Explicit AST page", objective: "Implement page", fileScopes: ["src/components/ast-page.tsx"], allowedTools: ["filesystem-read", "filesystem-write", "codebase-memory-read", "controlled-edit"], requiredCapabilities: ["source.inspect", "edit.ast-patch"] });
    const graphBase = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [task, validAstTask], validation: { valid: true, errors: [], warnings: [] }, checkpoint: "implementation-started" as const, readyForExecution: true, blockingReasons: [], warnings: [] };
    const graph = TaskGraphSchema.parse({ ...graphBase, graphChecksum: checksumPersistedDocument(graphBase) });
    await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "capability-repair-test", originalPrompt: "Synthetic capability repair fixture.", currentVersion: 1, workflowState: "IMPLEMENTING" }));
    await new ProjectVersionRepository(database).create({ id: id(), projectId, versionNumber: 1, state: "DRAFT", memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(graph);

    const snapshots: Record<string, unknown>[] = [];
    const decisions: unknown[] = [];
    let failDecisionProjection = true;
    const service = new OrchestratorService(database, { memory: { writeSnapshot: async (_projectId, _version, documents) => { snapshots.push(documents); }, appendDecision: async (_projectId, _version, decision) => { if (failDecisionProjection) { failDecisionProjection = false; throw new Error("synthetic-memory-append-failure"); } const decisionId = typeof decision === "object" && decision !== null && "id" in decision && typeof decision.id === "string" ? decision.id : undefined; if (!decisions.some((existing) => typeof existing === "object" && existing !== null && "id" in existing && existing.id === decisionId)) decisions.push(decision); } } });
    await expect(service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "legacy-controlled-edit-repair" })).rejects.toMatchObject({ code: "TASK_STATE_CONFLICT" });
    const repaired = await service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "legacy-controlled-edit-repair" });
    const repairedTask = repaired.taskGraph.tasks[0]!;
    expect(repaired.repairedTaskIds).toEqual([task.id]);
    expect(repairedTask.id).toBe(task.id);
    expect(repairedTask.status).toBe(task.status);
    expect(repairedTask.allowedTools).not.toContain("controlled-edit");
    expect(repairedTask.requiredCapabilities).not.toContain("edit.ast-patch");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.["task-graph.json"]).toMatchObject({ graphChecksum: repaired.taskGraph.graphChecksum });
    expect(decisions).toHaveLength(1);
    await service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "legacy-controlled-edit-repair" });
    expect(snapshots).toHaveLength(2);
    expect(decisions).toHaveLength(1);
    expect(repaired.taskGraph.tasks.find((candidate) => candidate.id === validAstTask.id)?.allowedTools).toContain("controlled-edit");
    expect(repaired.taskGraph.tasks.find((candidate) => candidate.id === validAstTask.id)?.requiredCapabilities).toContain("edit.ast-patch");
    expect(repaired.repairedTaskIds).not.toContain(validAstTask.id);
  });

  it("removes inherited registry access from a persisted repair task", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = id();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const originalTaskId = id();
    const task = AgentTaskSchema.parse({ id: id(), projectId, projectVersion: 1, role: "implementation", taskType: "repair-targeted-failure", title: "Repair design system", objective: "Repair the design system", inputs: ["failed implementation evidence"], expectedOutputs: ["targeted correction"], requirementReferences: [], planningReferences: [], selectedDesignReferences: [], acceptanceCriteria: ["The design system is repaired."], allowedSkills: [], allowedTools: ["filesystem-read", "filesystem-write", "Context7-read", "codebase-memory-read", "shadcn-registry-read"], deniedTools: [], requiredCapabilities: [], fileScopes: ["src/components/ui/Button.tsx"], dependencies: [], status: "ready", attempt: 0, maxAttempts: 1, createdAt: timestamp, repairOfTaskId: originalTaskId });
    const graphBase = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [task], validation: { valid: true, errors: [], warnings: [] }, checkpoint: "repair-required" as const, readyForExecution: true, blockingReasons: [], warnings: [] };
    const graph = TaskGraphSchema.parse({ ...graphBase, graphChecksum: checksumPersistedDocument(graphBase) });
    await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "repair-tool-test", originalPrompt: "Synthetic repair tool fixture.", currentVersion: 1, workflowState: "IMPLEMENTING" }));
    await new ProjectVersionRepository(database).create({ id: id(), projectId, versionNumber: 1, state: "DRAFT", memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(graph);

    const repaired = await new OrchestratorService(database).repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "legacy-repair-tool-repair" });
    const repairedTask = repaired.taskGraph.tasks[0]!;
    expect(repaired.repairedTaskIds).toEqual([task.id]);
    expect(repairedTask.allowedTools).not.toContain("shadcn-registry-read");
  });

  it("rejects an idempotent replay when the graph changed after the original repair", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = id();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const task = AgentTaskSchema.parse({ id: id(), projectId, projectVersion: 1, role: "implementation", taskType: "implement-page", title: "Page", objective: "Implement page", inputs: ["approved specification"], expectedOutputs: ["page"], requirementReferences: ["requirement:page"], planningReferences: ["planning:page"], selectedDesignReferences: [], acceptanceCriteria: ["The page matches the approved specification."], allowedSkills: [], allowedTools: ["filesystem-read", "filesystem-write", "controlled-edit"], deniedTools: [], requiredCapabilities: ["source.inspect", "edit.ast-patch"], fileScopes: ["src/app/**"], dependencies: [], status: "ready", attempt: 0, maxAttempts: 2, createdAt: timestamp });
    const graphBase = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [task], validation: { valid: true, errors: [], warnings: [] }, checkpoint: "implementation-started" as const, readyForExecution: true, blockingReasons: [], warnings: [] };
    const graph = TaskGraphSchema.parse({ ...graphBase, graphChecksum: checksumPersistedDocument(graphBase) });
    await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "replay-conflict-test", originalPrompt: "Synthetic replay fixture.", currentVersion: 1, workflowState: "IMPLEMENTING" }));
    await new ProjectVersionRepository(database).create({ id: id(), projectId, versionNumber: 1, state: "DRAFT", memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(graph);
    const service = new OrchestratorService(database);
    const repaired = await service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "replay-conflict-repair" });
    const changedBase = { ...repaired.taskGraph, updatedAt: "2026-01-01T00:00:01.000Z" };
    const changedWithoutChecksum = { ...changedBase };
    delete (changedWithoutChecksum as { graphChecksum?: string }).graphChecksum;
    const changed = TaskGraphSchema.parse({ ...changedBase, graphChecksum: checksumPersistedDocument(changedWithoutChecksum) });
    await new DocumentRepository(database).save(changed);
    await expect(service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: graph.graphChecksum!, actor: "synthetic-test", idempotencyKey: "replay-conflict-repair" })).rejects.toMatchObject({ code: "TASK_STATE_CONFLICT" });
    const replay = await service.repairTaskCapabilityBindings({ projectId, projectVersion: 1, expectedGraphChecksum: changed.graphChecksum!, actor: "synthetic-test", idempotencyKey: "replay-conflict-repair" });
    expect(replay.repaired).toBe(true);
    expect(replay.taskGraph.graphChecksum).toBe(changed.graphChecksum);
  });
});
