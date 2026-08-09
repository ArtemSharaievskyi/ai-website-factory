import "server-only";

import { readWorkspaceEnvironment } from "./config";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { DecisionRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { createWorkspaceManager } from "./manager";

export function createConfiguredWorkspaceManager() {
  const environment = readWorkspaceEnvironment(); const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); return createWorkspaceManager(environment.GENERATED_PROJECTS_ROOT as string, new ProjectVersionRepository(database), new DecisionRepository(database));
}
