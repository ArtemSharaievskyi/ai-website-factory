import "server-only";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FilesystemProjectMemorySyncPort } from "../../runtime/workspace/sync";
import { createLeadAgentService } from "./service";
import { LeadMemoryAdapter } from "./memory";
import { createProductionProviderBundle } from "../../integrations/openai/server";

export function createConfiguredLeadAgentService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); return createLeadAgentService({ database, provider: createProductionProviderBundle().lead, memory: new LeadMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug)) }); }
