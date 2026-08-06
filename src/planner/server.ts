import "server-only";
import { PostgresPersistenceDatabase, createPostgresPool } from "../persistence/server";
import { DecisionRepository } from "../persistence/repositories";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { PlannerMemoryAdapter } from "./memory";
import { createPlannerArchitectService } from "./service";

export function createConfiguredPlannerArchitectService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const decisions = new DecisionRepository(database); return createPlannerArchitectService({ database, memory: new PlannerMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug), decisions, projectRoot) }); }
