import "server-only";
import { createPostgresPool } from "@/persistence/database/server";
import { PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FilesystemProjectMemorySyncPort } from "../../runtime/workspace/sync";
import { ProjectVersionRepository } from "@/persistence/database/repositories";
import { WorkspaceManager } from "../../runtime/workspace/manager";
import { createProductionProviderBundle } from "../../integrations/openai/server";
import { ImplementationAgentService, type ImplementationMemoryPort } from "./service";

export function createConfiguredImplementationAgentService(workspaceRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const versions = new ProjectVersionRepository(database); const workspace = new WorkspaceManager({ root: workspaceRoot, versions }); const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug); const memory: ImplementationMemoryPort = { writeSnapshot: (projectId, version, documents) => sync.writeVersionSnapshot(projectId, version, documents) }; return new ImplementationAgentService(database, { provider: createProductionProviderBundle().implementation, workspace: { verifyStaging: (_projectId, version, reservationId, stagingPath) => workspace.verifyStagingWorkspace(slug, version, reservationId, stagingPath) }, memory }); }
