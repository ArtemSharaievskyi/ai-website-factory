import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3, multiDomainChangeSet } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { mapDocumentToRow } from "@/persistence/database/mapping";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { createRevisionCurrentnessToken } from "./identity";
import { BriefV3TransactionService } from "./service";
import type { BriefV3ProviderInput, BriefV3RevisionProvider } from "./ports";

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
const runId = randomUUID();
const projectIds: string[] = [];

class GatedProvider implements BriefV3RevisionProvider {
  calls = 0;
  constructor(private readonly waitForAll: number) {}
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  private reached!: () => void;
  private readonly allReached = new Promise<void>((resolve) => { this.reached = resolve; });
  async proposeChanges(input: BriefV3ProviderInput) {
    void input;
    this.calls += 1;
    if (this.calls === this.waitForAll) this.reached();
    await this.gate;
    return multiDomainChangeSet;
  }
  async waitUntilAllReached() { await this.allReached; }
  releaseAll() { this.release(); }
}

async function createFixture(database: PostgresPersistenceDatabase) {
  const projectId = randomUUID();
  projectIds.push(projectId);
  const timestamp = new Date().toISOString();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `brief-v3-pg-${runId.slice(0, 8)}-${projectIds.length}`, originalPrompt: "Synthetic Postgres transaction fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(cleanBriefV3), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(document);
  const row = mapDocumentToRow(document);
  return {
    projectId,
    currentness: createRevisionCurrentnessToken({ projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: project.workflowState, documentType: "brief-v3", briefChecksum: canonicalBriefChecksum(cleanBriefV3), documentChecksum: row.checksum, documentRowVersion: 1 }),
  };
}

function request(fixture: Awaited<ReturnType<typeof createFixture>>, revisionInstruction: string, ownerId: string) {
  return { projectId: fixture.projectId, projectVersion: 1, revisionInstruction, expectedCurrentness: fixture.currentness, targetHints: ["SEO_TITLE"], targetWorkflowState: "CLARIFYING" as const, ownerId };
}

async function cleanup(pool: ReturnType<typeof createPostgresPool>) {
  for (const projectId of projectIds) {
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
}

describePostgres("Brief Revision V3 Postgres concurrency certification", () => {
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
  });

  it("gives one real Postgres provider owner to exact concurrent duplicates", async () => {
    const fixture = await createFixture(database);
    const provider = new GatedProvider(1);
    const service = new BriefV3TransactionService({ database, provider });
    const first = service.execute(request(fixture, "real Postgres duplicate request", "pg-owner-a"));
    await provider.waitUntilAllReached();
    const duplicate = service.execute(request(fixture, "real Postgres duplicate request", "pg-owner-b"));
    await expect(duplicate).rejects.toMatchObject({ code: "IN_PROGRESS_DUPLICATE" });
    provider.releaseAll();
    await expect(first).resolves.toMatchObject({ outcome: "COMMITTED" });
    expect(provider.calls).toBe(1);
  });

  it("allows overlapping real Postgres providers but commits at most one stale-token result", async () => {
    const fixture = await createFixture(database);
    const provider = new GatedProvider(2);
    const service = new BriefV3TransactionService({ database, provider });
    const first = service.execute(request(fixture, "real Postgres competing revision A", "pg-owner-a"));
    const second = service.execute(request(fixture, "real Postgres competing revision B", "pg-owner-b"));
    await provider.waitUntilAllReached();
    provider.releaseAll();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason.code === "STALE_BEFORE_COMMIT")).toHaveLength(1);
    expect(provider.calls).toBe(2);
  });

  it("gives one real Postgres owner to an expired lease reclaim race", async () => {
    const fixture = await createFixture(database);
    const operationKind = "REQUEST_BRIEF_CHANGES_V3";
    const operationKey = `brief-revision-v3:lease-race:${fixture.projectId}`;
    const payloadHash = "e".repeat(64);
    const now = new Date().toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();
    const lease = new Date(Date.now() + 60_000).toISOString();
    const attempt = await database.transaction((tx) => tx.reserveBriefRevisionAttempt({ id: randomUUID(), operationKind, operationKey, payloadHash, projectId: fixture.projectId, projectVersion: 1, currentnessToken: fixture.currentness, now }));
    await database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind, operationKey, payloadHash, owner: "pg-dead-owner", now, leaseExpiresAt: expired }));
    const claims = await Promise.all([
      database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind, operationKey, payloadHash, owner: "pg-reclaimer-a", now, leaseExpiresAt: lease })),
      database.transaction((tx) => tx.claimBriefRevisionAttempt({ attemptId: attempt.id, operationKind, operationKey, payloadHash, owner: "pg-reclaimer-b", now, leaseExpiresAt: lease })),
    ]);
    expect(claims.filter((claim) => claim.outcome === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === "IN_PROGRESS_DUPLICATE")).toHaveLength(1);
  });

  it("keeps real Postgres committed replay races mutation-free", async () => {
    const fixture = await createFixture(database);
    const provider = new GatedProvider(1);
    const service = new BriefV3TransactionService({ database, provider });
    const first = service.execute(request(fixture, "real Postgres replay race", "pg-owner"));
    await provider.waitUntilAllReached();
    provider.releaseAll();
    await expect(first).resolves.toMatchObject({ outcome: "COMMITTED" });
    const replays = await Promise.all([service.execute(request(fixture, "real Postgres replay race", "pg-replay-a")), service.execute(request(fixture, "real Postgres replay race", "pg-replay-b"))]);
    expect(replays.every((result) => result.outcome === "COMMITTED_REPLAY")).toBe(true);
    expect(provider.calls).toBe(1);
  });
});

if (!databaseUrl) console.log("BRIEF REVISION V3 POSTGRES CONCURRENCY: SKIPPED (DATABASE_URL unavailable)");
else console.log("BRIEF REVISION V3 POSTGRES CONCURRENCY: ENABLED");
