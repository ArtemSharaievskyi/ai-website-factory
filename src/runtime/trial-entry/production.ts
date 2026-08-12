import path from "node:path";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { createLeadAgentService } from "@/agents/lead/service";
import { LeadMemoryAdapter } from "@/agents/lead/memory";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { readWorkspaceEnvironment } from "@/runtime/workspace/config";
import { DecisionRepository } from "@/persistence/database/repositories";
import {
  createPostgresPool,
  PostgresPersistenceDatabase,
} from "@/persistence/database/postgres";
import { TrialEntryService } from "./service";

export function createProductionTrialEntryRuntime(options: {
  env?: Record<string, string | undefined>;
  requireAi?: boolean;
} = {}) {
  const env = options.env ?? process.env;
  const pool = createPostgresPool(env);
  const database = new PostgresPersistenceDatabase(pool);
  const workspaceEnvironment = readWorkspaceEnvironment(env);
  const workspaceRoot = workspaceEnvironment.GENERATED_PROJECTS_ROOT ?? path.resolve(".factory-generated");
  const evidence = { providerRequests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const ai = options.requireAi === false
    ? undefined
    : createProductionProviderBundle({
        env,
        usageSink: (usage) => {
          evidence.providerRequests += usage.requestCount;
          evidence.inputTokens += usage.inputTokens ?? 0;
          evidence.cachedInputTokens += usage.cachedInputTokens ?? 0;
          evidence.outputTokens += usage.outputTokens ?? 0;
        },
      });
  const service = new TrialEntryService({
    database,
    createLeadAgent: (slug) => {
      if (!ai) throw new Error("TRIAL_ENTRY_AI_NOT_CONFIGURED");
      const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
      return createLeadAgentService({
        database,
        provider: ai.lead,
        memory: new LeadMemoryAdapter(
          sync,
          new DecisionRepository(database),
          workspaceRoot,
        ),
      });
    },
  });
  return {
    service,
    evidence,
    workspaceRoot,
    async close() {
      await pool.end();
    },
  };
}
