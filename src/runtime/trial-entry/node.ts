import path from "node:path";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { createLeadAgentService } from "@/agents/lead/service";
import { LeadMemoryAdapter } from "@/agents/lead/memory";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { readWorkspaceEnvironment } from "@/runtime/workspace/config";
import {
  createPostgresPool,
  PostgresPersistenceDatabase,
} from "@/persistence/database/postgres";
import { TrialEntryService } from "./service";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { OpenAiBriefV3RevisionProvider } from "@/integrations/openai-v3/provider";
import { BriefApprovalService } from "./brief-approval";

/** Node/tsx composition for standalone Trial Entry commands. */
export function createNodeTrialEntryRuntime(options: {
  env?: Record<string, string | undefined>;
  requireAi?: boolean;
} = {}) {
  const env = options.env ?? process.env;
  const pool = createPostgresPool(env);
  const database = new PostgresPersistenceDatabase(pool);
  const workspaceEnvironment = readWorkspaceEnvironment({
    NODE_ENV: env.NODE_ENV,
    GENERATED_PROJECTS_ROOT: env.GENERATED_PROJECTS_ROOT,
  });
  const workspaceRoot = workspaceEnvironment.GENERATED_PROJECTS_ROOT ?? path.resolve(".factory-generated");
  const evidence = { providerRequests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  const leads = new Map<string, ReturnType<typeof createLeadAgentService>>();
  const briefRevisions = new Map<string, BriefV3TransactionService>();
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
  const briefV3Provider = ai ? new OpenAiBriefV3RevisionProvider(ai.ai) : undefined;
  const service = new TrialEntryService({
    database,
    createBriefApproval: (slug) => new BriefApprovalService({ database, projection: new FilesystemProjectMemorySyncPort(workspaceRoot, slug) }),
    createBriefRevisionV3: (slug) => {
      if (!briefV3Provider) throw new Error("TRIAL_ENTRY_AI_NOT_CONFIGURED");
      const existing = briefRevisions.get(slug);
      if (existing) return existing;
      const created = new BriefV3TransactionService({
        database,
        provider: briefV3Provider,
        projection: new FilesystemProjectMemorySyncPort(workspaceRoot, slug),
      });
      briefRevisions.set(slug, created);
      return created;
    },
    createLeadAgent: (slug) => {
      if (!ai) throw new Error("TRIAL_ENTRY_AI_NOT_CONFIGURED");
      const existing = leads.get(slug);
      if (existing) return existing;
      const sync = new FilesystemProjectMemorySyncPort(workspaceRoot, slug);
      const lead = createLeadAgentService({
        database,
        provider: ai.lead,
        memory: new LeadMemoryAdapter(sync),
      });
      leads.set(slug, lead);
      return lead;
    },
  });
  return {
    service,
    database,
    evidence,
    workspaceRoot,
    async close() {
      await pool.end();
    },
  };
}
