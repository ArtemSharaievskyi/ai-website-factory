import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import type { ProviderBriefChangeSet } from "@/integrations/openai-v3/changeset";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { OpenAiBriefV3RevisionProvider } from "@/integrations/openai-v3/provider";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { readV2TripwireSnapshot, resetV2Tripwires } from "@/runtime/brief-revision-v3/v2-tripwire";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";

function configuredDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*DATABASE_URL\s*=/.test(candidate));
    const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
}

const databaseUrl = configuredDatabaseUrl();
const describePostgres = describe.skipIf(!databaseUrl);
const providerDto = {
  contractVersion: 1 as const,
  changes: [
    { operation: "SET" as const, target: "SEO_TITLE" as const, value: "Synthetic Postgres route" as const },
    { operation: "UPSERT" as const, target: "REQUIREMENT:postgres-route" as const, value: { category: "FEATURE" as const, statement: "Exercise the synthetic Postgres production route." } },
  ],
} satisfies ProviderBriefChangeSet;

async function cleanup(pool: ReturnType<typeof createPostgresPool>, projectId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM brief_revision_projection_sync WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM brief_revision_history WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM workflow_events WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM decision_records WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM workflow_documents WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM brief_revision_attempts WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_versions WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM factory_projects WHERE id=$1", [projectId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describePostgres("production-shaped Brief V3 request route on Postgres", () => {
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);

  afterAll(async () => { await pool.end(); });

  it("uses the Workbench application entrypoint, persists one V3 attempt, and reconstructs replay", async () => {
    const projectId = randomUUID();
    const timestamp = new Date().toISOString();
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `brief-v3-pg-route-${projectId.slice(0, 8)}`, originalPrompt: "Synthetic Postgres production route fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-production-postgres-"));
    try {
      await new ProjectRepository(database).create(project);
      await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(cleanBriefV3), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
      await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp }));
      let calls = 0;
      const bundle = createProductionProviderBundle({ env: { OPENAI_API_KEY: "synthetic-network-fake", OPENAI_MODEL: "synthetic-model", OPENAI_MAX_RETRIES: "0" }, executor: async <T>(request: { schema: { parse: (value: unknown) => T } }) => { calls += 1; return { value: request.schema.parse(providerDto), requestId: `synthetic-postgres-${calls}` }; } });
      const projection = new FilesystemProjectMemorySyncPort(root, project.slug);
      const createApp = (provider = new OpenAiBriefV3RevisionProvider(bundle.ai)) => {
        const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEGACY_LEAD_REVISION_REACHED"); }, createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider, projection }) });
        return { entry, app: new WorkbenchApplication({ database, entry }) };
      };
      const firstApp = createApp();
      const initial = await firstApp.app.handle({ action: "status", projectId });
      if (!initial.project || !initial.brief) throw new Error("Postgres synthetic Brief was not ready");
      const request = { action: "request-brief-changes" as const, projectId, projectVersion: initial.project.projectVersion, briefChecksum: initial.brief.checksum, expectedRowVersion: initial.project.rowVersion, reason: "Update the synthetic Postgres route title and add one feature.", requirementKeys: ["project-brief"] };
      resetV2Tripwires();
      const first = await firstApp.app.handle(request);
      expect(first.project?.workflowState).toBe("CLARIFYING");
      expect(first.brief?.briefSchemaVersion).toBe(3);
      expect(calls).toBe(1);
      expect(await database.transaction((tx) => tx.listBriefRevisionHistory(projectId, 1))).toHaveLength(1);
      const replay = await firstApp.entry.requestBriefChanges(request);
      expect(replay).toMatchObject({ projectId, workflowState: "CLARIFYING" });
      expect(calls).toBe(1);
      let reconstructedCalls = 0;
      const reconstructedBundle = createProductionProviderBundle({ env: { OPENAI_API_KEY: "synthetic-network-fake", OPENAI_MODEL: "synthetic-model", OPENAI_MAX_RETRIES: "0" }, executor: async () => { reconstructedCalls += 1; throw new Error("RECONSTRUCTED_PROVIDER_INVOKED"); } });
      const reconstructed = createApp(new OpenAiBriefV3RevisionProvider(reconstructedBundle.ai));
      await expect(reconstructed.entry.requestBriefChanges(request)).resolves.toMatchObject({ projectId, workflowState: "CLARIFYING" });
      expect(reconstructedCalls).toBe(0);
      expect(readV2TripwireSnapshot()).toMatchObject({ providerMutationCalls: 0, mergeCalls: 0, revisionPersistenceCalls: 0, idempotencyMutationCalls: 0, loadedLegacyMutationModules: [] });
      await cleanup(pool, projectId);
      await expect(database.transaction(async (tx) => ({ project: await tx.getProject(projectId), version: await tx.getVersion(projectId, 1), attempts: await tx.listBriefRevisionAttempts(projectId, 1), history: await tx.listBriefRevisionHistory(projectId, 1) }))).resolves.toEqual({ project: null, version: null, attempts: [], history: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
      try { await cleanup(pool, projectId); } catch { /* cleanup already completed or setup did not reach the database */ }
    }
  });
});

if (!databaseUrl) console.log("BRIEF REVISION V3 POSTGRES PRODUCTION ROUTE: SKIPPED (DATABASE_URL unavailable)");
else console.log("BRIEF REVISION V3 POSTGRES PRODUCTION ROUTE: ENABLED");
