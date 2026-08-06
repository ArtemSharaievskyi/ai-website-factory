import "server-only";
import path from "node:path";
import { createPostgresPool } from "../persistence/server";
import { DecisionRepository, ProjectVersionRepository } from "../persistence/repositories";
import { PostgresPersistenceDatabase } from "../persistence/postgres";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { WorkspaceManager } from "../workspace/manager";
import { versionDirectoryName } from "../workspace/schemas";
import { ProjectMemoryStore } from "../project-memory/store";
import { OrchestratorService, type OrchestratorMemoryPort } from "./service";

export function createConfiguredOrchestratorService(workspaceRoot: string, slug: string) {
  const pool = createPostgresPool();
  const database = new PostgresPersistenceDatabase(pool);
  const versions = new ProjectVersionRepository(database);
  const decisions = new DecisionRepository(database);
  const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
  const memory: OrchestratorMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents), appendDecision: async (projectId, version, decision) => { await new ProjectMemoryStore(path.join(workspaceRoot, slug, versionDirectoryName(version), ".factory")).appendDecision(decision as Parameters<ProjectMemoryStore["appendDecision"]>[0]); await decisions.append(projectId, version, decision as Parameters<DecisionRepository["append"]>[2]); } };
  const workspace = new WorkspaceManager({ root: workspaceRoot, versions });
  return new OrchestratorService(database, { memory, workspace: { verify: async (_projectId, version) => workspace.verifyVersion(slug, version).then(() => true) } });
}
