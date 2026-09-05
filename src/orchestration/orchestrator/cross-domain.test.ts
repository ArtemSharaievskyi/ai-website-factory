import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approveCrossDomainChangeProposal, checksumBackendImplementationContract, createCrossDomainChangeProposal } from "@/domain/implementation/contracts";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { AgentTaskSchema, TaskGraphSchema } from "@/domain/tasks/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { OrchestratorService } from "./service";

const projectId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-05T08:00:00.000Z";
const hash = (value: string) => value.repeat(64);

function implementationTask(input: { domain: "DATABASE" | "BACKEND" | "FRONTEND"; taskType: "implement-database-schema" | "implement-server-action" | "implement-page"; scopes: string[]; dependencies?: string[] }) {
  const specialistProfileId = input.domain === "DATABASE" ? "database-implementation" : input.domain === "BACKEND" ? "backend-implementation" : "frontend-implementation";
  return AgentTaskSchema.parse({ id: randomUUID(), projectId, projectVersion: 1, role: "implementation", taskType: input.taskType, title: input.taskType, objective: "fixture", implementationDomain: input.domain, specialistProfileId, inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: ["filesystem-write"], fileScopes: input.scopes, dependencies: input.dependencies ?? [], status: "passed", attempt: 1, maxAttempts: 1, createdAt: timestamp, completedAt: timestamp });
}

describe("cross-domain implementation repair routing", () => {
  it("routes an approved Backend-to-Database proposal through a CAS/idempotent repair task and blocks the stale downstream task", async () => {
    const database = new InMemoryPersistenceDatabase();
    const dbTask = implementationTask({ domain: "DATABASE", taskType: "implement-database-schema", scopes: ["supabase/migrations/**"] });
    const backendTask = implementationTask({ domain: "BACKEND", taskType: "implement-server-action", scopes: ["src/actions/**"], dependencies: [dbTask.id] });
    const base = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [dbTask, backendTask], sourceDocumentChecksums: { architecture: hash("a") } };
    const graph = TaskGraphSchema.parse({ ...base, graphChecksum: checksumPersistedDocument(base) });
    await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "cross-domain", originalPrompt: "fixture", currentVersion: 1, workflowState: "IMPLEMENTING" }));
    await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "IMPLEMENTING", memoryRootPath: "C:\\fixture", requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(graph);
    const backendContract = { schemaVersion: 1 as const, documentType: "backend-implementation-contract" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, contractId: randomUUID(), sourceTaskId: backendTask.id, sourceTaskAttempt: 1, specialistProfileId: "backend-implementation" as const, specialistProfileChecksum: hash("d"), currentness: { taskGraphChecksum: graph.graphChecksum!, architectureChecksum: hash("a"), workspaceChecksum: hash("c"), upstreamArtifactChecksum: hash("b") }, operations: [], hostLifecycle: { createdBy: "Factory" as const, providerAttempts: 0 as const } };
    await new DocumentRepository(database).save({ ...backendContract, checksum: checksumBackendImplementationContract(backendContract) });
    const pending = createCrossDomainChangeProposal({ projectId, projectVersion: 1, sourceTaskId: backendTask.id, sourceDomain: "BACKEND", targetDomain: "DATABASE", requestedFileScopes: ["supabase/migrations/20260905000000_add_index.sql"], rationale: "Add an Architecture-compatible indexed database field.", requestedContractDelta: [{ contractId: "database-implementation-contract", change: "Add the indexed field to the bounded database contract.", compatibleWithArchitecture: true }], canonicalImpact: "IMPLEMENTATION_CONTRACT_REPAIR", currentness: { taskGraphChecksum: graph.graphChecksum!, architectureChecksum: hash("a"), sourceArtifactChecksum: hash("b"), workspaceChecksum: hash("c") }, affectedContractIds: ["database-implementation-contract"], createdAt: timestamp });
    const proposal = approveCrossDomainChangeProposal(pending, { actorId: "host", decidedAt: timestamp });
    const service = new OrchestratorService(database);
    const first = await service.routeCrossDomainChangeProposal({ proposal, expectedGraphChecksum: graph.graphChecksum!, workspaceChecksum: hash("c"), actor: "host" });
    expect(first.routed).toBe(true);
    expect(first.repairTask.implementationDomain).toBe("DATABASE");
    expect(first.taskGraph.tasks.find((task) => task.id === backendTask.id)?.status).toBe("blocked");
    expect(first.taskGraph.tasks.find((task) => task.id === backendTask.id)?.dependencies).toContain(first.repairTask.id);
    const duplicate = await service.routeCrossDomainChangeProposal({ proposal, expectedGraphChecksum: graph.graphChecksum!, workspaceChecksum: hash("c"), actor: "host" });
    expect(duplicate.routed).toBe(false);
    expect(duplicate.repairTask.id).toBe(first.repairTask.id);
    expect((await new DocumentRepository(database).get(projectId, 1, "cross-domain-change-proposal"))?.documentType).toBe("cross-domain-change-proposal");
  });

  it("routes an approved Frontend-to-Backend proposal without granting the frontend a server write path", async () => {
    const database = new InMemoryPersistenceDatabase();
    const backendTask = implementationTask({ domain: "BACKEND", taskType: "implement-server-action", scopes: ["src/actions/**"] });
    const frontendTask = implementationTask({ domain: "FRONTEND", taskType: "implement-page", scopes: ["src/app/**/page.*"], dependencies: [backendTask.id] });
    const base = { schemaVersion: 1 as const, documentType: "task-graph" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, tasks: [backendTask, frontendTask], sourceDocumentChecksums: { architecture: hash("a") } };
    const graph = TaskGraphSchema.parse({ ...base, graphChecksum: checksumPersistedDocument(base) });
    await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "frontend-cross-domain", originalPrompt: "fixture", currentVersion: 1, workflowState: "IMPLEMENTING" }));
    await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "IMPLEMENTING", memoryRootPath: "C:\\fixture", requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new DocumentRepository(database).save(graph);
    const pending = createCrossDomainChangeProposal({ projectId, projectVersion: 1, sourceTaskId: frontendTask.id, sourceDomain: "FRONTEND", targetDomain: "BACKEND", requestedFileScopes: ["src/actions/approved-action.ts"], rationale: "Add an Architecture-compatible server contract response.", requestedContractDelta: [{ contractId: "backend-implementation-contract", change: "Add the approved server operation response.", compatibleWithArchitecture: true }], canonicalImpact: "IMPLEMENTATION_CONTRACT_REPAIR", currentness: { taskGraphChecksum: graph.graphChecksum!, architectureChecksum: hash("a"), sourceArtifactChecksum: checksumPersistedDocument({ taskId: frontendTask.id, taskType: frontendTask.taskType, attempt: frontendTask.attempt }), workspaceChecksum: hash("c") }, affectedContractIds: ["backend-implementation-contract"], createdAt: timestamp });
    const proposal = approveCrossDomainChangeProposal(pending, { actorId: "host", decidedAt: timestamp });
    const result = await new OrchestratorService(database).routeCrossDomainChangeProposal({ proposal, expectedGraphChecksum: graph.graphChecksum!, workspaceChecksum: hash("c"), actor: "host" });
    expect(result.repairTask.implementationDomain).toBe("BACKEND");
    expect(result.repairTask.fileScopes).toEqual(["src/actions/approved-action.ts"]);
    expect(result.taskGraph.tasks.find((task) => task.id === frontendTask.id)?.status).toBe("blocked");
  });
});
