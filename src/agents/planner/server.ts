import "server-only";
import { PostgresPersistenceDatabase, createPostgresPool } from "@/persistence/database/server";
import { DecisionRepository } from "@/persistence/database/repositories";
import { FilesystemProjectMemorySyncPort } from "../../runtime/workspace/sync";
import { PlannerMemoryAdapter } from "./memory";
import { createPlannerArchitectService } from "./service";
import { createProductionProviderBundle } from "../../integrations/openai/server";

export function createConfiguredPlannerArchitectService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const decisions = new DecisionRepository(database); return createPlannerArchitectService({ database, provider: createProductionProviderBundle().planner, memory: new PlannerMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug), decisions, projectRoot) }); }
