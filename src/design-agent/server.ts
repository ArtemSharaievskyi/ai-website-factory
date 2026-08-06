import "server-only";
import { PostgresPersistenceDatabase, createPostgresPool } from "../persistence/server";
import { DecisionRepository } from "../persistence/repositories";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { DesignMemoryAdapter } from "./memory";
import { createDesignAgentService } from "./service";
export function createConfiguredDesignAgentService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const decisions = new DecisionRepository(database); return createDesignAgentService({ database, memory: new DesignMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug), decisions, projectRoot) }); }
