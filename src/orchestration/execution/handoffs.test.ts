import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository } from "@/persistence/database/repositories";
import { AgentTaskSchema, TaskGraphSchema } from "@/domain/tasks/schema";
import type { ImplementationExecutionRun } from "@/domain/implementation/schema";
import { ProductionHandoffService, taskGraphIdentityChecksum, workspaceSourceChecksum } from "./handoffs";

const time = "2026-09-05T08:00:00.000Z";
const hash = (value: string) => value.repeat(64);
const task = (domain: "DATABASE" | "BACKEND", dependencies: string[] = []) => AgentTaskSchema.parse({
  id: randomUUID(), projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, role: "implementation",
  taskType: domain === "DATABASE" ? "implement-database-schema" : "implement-server-action", title: `${domain} task`, objective: "fixture", implementationDomain: domain,
  specialistProfileId: domain === "DATABASE" ? "database-implementation" : "backend-implementation", inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: [], fileScopes: domain === "DATABASE" ? ["supabase/migrations/**"] : ["src/actions/**"], dependencies, status: "ready", attempt: 0, maxAttempts: 1, createdAt: time,
});
const execution = (taskId: string): ImplementationExecutionRun => ({ executionId: randomUUID(), projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, taskId, attempt: 1, status: "passed", changedFiles: ["supabase/migrations/20260905000000_schema.sql"], createdFiles: [], deletedFiles: [], beforeChecksums: {}, afterChecksums: { "supabase/migrations/20260905000000_schema.sql": hash("f") }, validationResults: [], warnings: [], startedAt: time, completedAt: time, executionPolicyVersion: "implementation-v1" });

describe("production domain handoffs", () => {
  it("persists a bounded database contract and rejects it before a dependent backend worker when workspace currentness changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "factory-handoff-"));
    try {
      await mkdir(path.join(root, "supabase", "migrations"), { recursive: true });
      await writeFile(path.join(root, "supabase", "migrations", "20260905000000_schema.sql"), "create table example (id uuid primary key);\n");
      const databaseTask = task("DATABASE");
      const backendTask = task("BACKEND", [databaseTask.id]);
      const graph = TaskGraphSchema.parse({ schemaVersion: 1, documentType: "task-graph", projectId: databaseTask.projectId, projectVersion: 1, createdAt: time, updatedAt: time, tasks: [databaseTask, backendTask], sourceDocumentChecksums: { architecture: hash("a") }, graphChecksum: hash("b") });
      const database = new InMemoryPersistenceDatabase();
      const service = new ProductionHandoffService(database, root);
      await service.persistAfterTask(graph, databaseTask, execution(databaseTask.id), {});
      const stored = await new DocumentRepository(database).get(graph.projectId, 1, "database-implementation-contract");
      expect(stored?.documentType).toBe("database-implementation-contract");
      await expect(service.loadForTask(graph, backendTask)).resolves.toMatchObject({ database: { sourceTaskId: databaseTask.id, currentness: { taskGraphChecksum: taskGraphIdentityChecksum(graph), workspaceChecksum: await workspaceSourceChecksum(root) } } });
      await writeFile(path.join(root, "supabase", "migrations", "20260905000000_schema.sql"), "create table changed (id uuid primary key);\n");
      await expect(service.loadForTask(graph, backendTask)).rejects.toThrow("DOMAIN_HANDOFF_STALE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
