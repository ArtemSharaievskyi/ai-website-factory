import "server-only";
import { createPostgresPool } from "@/persistence/database/server";
import { DecisionRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { WorkspaceManager } from "@/runtime/workspace/manager";
import { OrchestratorService, type OrchestratorMemoryPort } from "./service";

export function createConfiguredOrchestratorService(workspaceRoot: string, slug: string) {
  const pool = createPostgresPool();
  const database = new PostgresPersistenceDatabase(pool);
  const versions = new ProjectVersionRepository(database);
  const decisions = new DecisionRepository(database);
  const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
  const memory: OrchestratorMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents), appendDecision: async (projectId, version, decision) => { await sync.appendDecision(projectId, version, decision as Parameters<DecisionRepository["append"]>[2]); await decisions.append(projectId, version, decision as Parameters<DecisionRepository["append"]>[2]); } };
  const workspace = new WorkspaceManager({ root: workspaceRoot, versions });
  return new OrchestratorService(database, { memory, workspace: { verify: async (_projectId, version) => workspace.verifyVersion(slug, version).then(() => true) } });
}
