import "server-only";
import { PostgresPersistenceDatabase, createPostgresPool } from "../persistence/server";
import { DecisionRepository } from "../persistence/repositories";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { DesignMemoryAdapter } from "./memory";
import { createDesignAgentService } from "./service";
import { createProductionProviderBundle } from "../ai-provider/server";
export function createConfiguredDesignAgentService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const decisions = new DecisionRepository(database); return createDesignAgentService({ database, provider: createProductionProviderBundle().design, memory: new DesignMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug), decisions, projectRoot) }); }
