import "server-only";
import { createPostgresPool } from "@/persistence/database/server";
import { ProjectVersionRepository } from "@/persistence/database/repositories";
import { PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { WorkspaceManager } from "@/runtime/workspace/manager";
import { OrchestratorService, type OrchestratorMemoryPort } from "./service";
import type { DecisionRecord } from "@/domain/workflow/decision";

export function createConfiguredOrchestratorService(workspaceRoot: string, slug: string) {
  const pool = createPostgresPool();
  const database = new PostgresPersistenceDatabase(pool);
  const versions = new ProjectVersionRepository(database);
  const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
  const memory: OrchestratorMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents), appendDecision: (projectId, version, decision) => sync.appendDecision(projectId, version, decision as DecisionRecord) };
  const workspace = new WorkspaceManager({ root: workspaceRoot, versions });
  return new OrchestratorService(database, { memory, workspace: { verify: async (_projectId, version) => workspace.verifyVersion(slug, version).then(() => true) } });
}
