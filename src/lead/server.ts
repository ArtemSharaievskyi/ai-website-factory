import "server-only";
import { createPostgresPool, PostgresPersistenceDatabase } from "../persistence/postgres";
import { DecisionRepository } from "../persistence/repositories";
import { FilesystemProjectMemorySyncPort } from "../workspace/sync";
import { createLeadAgentService } from "./service";
import { LeadMemoryAdapter } from "./memory";

export function createConfiguredLeadAgentService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); const decisions = new DecisionRepository(database); return createLeadAgentService({ database, memory: new LeadMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug), decisions, projectRoot) }); }
