import "server-only";
import { PostgresPersistenceDatabase, createPostgresPool } from "@/persistence/database/server";
import { FilesystemProjectMemorySyncPort } from "../../runtime/workspace/sync";
import { DesignMemoryAdapter } from "./memory";
import { createDesignAgentService } from "./service";
import { createProductionProviderBundle } from "../../integrations/openai/server";
import { ProfessionalDesignCapabilityPipeline } from "./professional";
export function createConfiguredDesignAgentService(projectRoot: string, slug: string) { const pool = createPostgresPool(); const database = new PostgresPersistenceDatabase(pool); return createDesignAgentService({ database, provider: createProductionProviderBundle().design, memory: new DesignMemoryAdapter(new FilesystemProjectMemorySyncPort(projectRoot, slug)), professionalPipeline: new ProfessionalDesignCapabilityPipeline() }); }
