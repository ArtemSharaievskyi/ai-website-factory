import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Pool } from "pg";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { createBriefV3Document, BriefV3DocumentSchema } from "./brief-revision-v3-contracts";
import { mapDocumentToRow, mapProjectToRow } from "./mapping";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "./repositories";
import { FakeProjectMemorySyncPort } from "./sync";
import type { PersistenceDatabase, PersistenceTransaction } from "./types";
import { PersistenceError } from "./errors";
import { normalizeAssetRow, createPostgresPool, PostgresPersistenceDatabase } from "./postgres";
import { BriefApprovalService } from "@/runtime/trial-entry/brief-approval";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "@/runtime/workbench/application";

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
const realProjectIds: string[] = [];
const runId = randomUUID().replaceAll("-", "").slice(0, 10);

class RollbackSyntheticTransaction extends PersistenceError {
  constructor() {
    super("PERSISTENCE_UNSUPPORTED", "Synthetic test rollback.");
  }
}

async function rollbackAfter<T>(database: PostgresPersistenceDatabase, work: (tx: PersistenceTransaction) => Promise<T>) {
  let result: T | undefined;
  try {
    await database.transaction(async (tx) => {
      result = await work(tx);
      throw new RollbackSyntheticTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackSyntheticTransaction)) throw error;
  }
  return result as T;
}

async function createApprovalFixture(database: PostgresPersistenceDatabase) {
  const projectId = randomUUID();
  realProjectIds.push(projectId);
  const timestamp = new Date().toISOString();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `postgres-approval-${runId}-${realProjectIds.length}`, origin: "SYNTHETIC", siteLanguage: "en", originalPrompt: "Synthetic approval persistence fixture.", currentVersion: 1, workflowState: "CLARIFYING" });
  const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, unresolved: [{ target: "legal:imprint-address", reason: "Legal details remain unavailable; an explicit publication placeholder is required.", sourceRefs: ["synthetic:legal-placeholder"] }] });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "CLARIFYING", memoryRootPath: null, requirementsChecksum: document.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new DocumentRepository(database).save(document);
  return { projectId, document };
}

async function cleanup(pool: ReturnType<typeof createPostgresPool>) {
  for (const projectId of realProjectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM idempotency_records WHERE operation=$1 AND idempotency_key LIKE $2", ["brief-approval-v3", `workbench-approve-brief:${projectId}:%`]);
      await client.query("DELETE FROM workflow_events WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM decision_records WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM workflow_documents WHERE project_id=$1", [projectId]);
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

describe("Postgres asset row normalization", () => {
  it("omits nullable optional asset fields instead of passing null into strict domain schemas", () => {
    const normalized = normalizeAssetRow({
      schemaVersion: 1,
      assetId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000001",
      projectVersion: 1,
      category: "LOGO",
      source: "USER_SUPPLIED",
      safeDisplayName: "logo.png",
      mediaType: "image/png",
      byteSize: 16,
      sha256: "a".repeat(64),
      storageIdentity: "projects/00000000-0000-4000-8000-000000000001/assets/00000000-0000-4000-8000-000000000002/png",
      status: "UPLOADING",
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
      version: 1,
      currentness: "CURRENT",
      supersedesAssetId: null as never,
      rejectionReason: null as never,
    });
    expect(normalized).not.toHaveProperty("supersedesAssetId");
    expect(normalized).not.toHaveProperty("rejectionReason");
  });
});

describe("Postgres transaction ambiguity handling", () => {
  it("normalizes connection failures before transaction start into bounded persistence diagnostics", async () => {
    const connectionFailure = new AggregateError([new Error("private host detail")], "private connection detail");
    Object.assign(connectionFailure, { code: "EACCES" });
    const pool = { connect: vi.fn().mockRejectedValue(connectionFailure) } as unknown as Pool;
    const database = new PostgresPersistenceDatabase(pool);
    await expect(database.transaction(async () => undefined)).rejects.toMatchObject({
      code: "PERSISTENCE_PROVIDER_ERROR",
      diagnostic: { stage: "database", operation: "query", sqlState: "EACCES", errorClass: "AggregateError" },
    });
  });

  it("evicts a client when COMMIT acknowledgement is ambiguous", async () => {
    const release = vi.fn();
    const client = { query: vi.fn().mockImplementation((sql: string) => sql === "COMMIT" ? Promise.reject(new Error("synthetic network loss")) : Promise.resolve({ rows: [], rowCount: 0 })) , release };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const database = new PostgresPersistenceDatabase(pool);
    await expect(database.transaction(async () => undefined)).rejects.toMatchObject({ code: "PERSISTENCE_COMMIT_AMBIGUOUS" });
    expect(release).toHaveBeenCalledWith(expect.any(Error));
  });
});

describePostgres("Postgres approval persistence round-trip", () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let database: PostgresPersistenceDatabase;

  beforeAll(() => {
    pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
    database = new PostgresPersistenceDatabase(pool);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
  });

  it("round-trips every decision binding, including rationale and nullable neighbors", async () => {
    const projectId = randomUUID();
    const timestamp = new Date().toISOString();
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `postgres-decision-${runId}`, origin: "SYNTHETIC", siteLanguage: "en", originalPrompt: "Synthetic decision binding fixture.", currentVersion: 1, workflowState: "CLARIFYING" });
    const version = { id: randomUUID(), projectId, versionNumber: 1, state: "CLARIFYING" as const, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 };
    const record = DecisionRecordSchema.parse({ id: randomUUID(), timestamp, actorType: "user", actorIdentifier: "synthetic-approval-user", category: "brief-approval", decision: "Synthetic approval decision", rationale: "Synthetic rationale must remain in the rationale column.", affectedDocuments: ["brief-v3.json", "project.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    const rows = await rollbackAfter(database, async (tx) => {
      await tx.insertProject(mapProjectToRow(project));
      await tx.insertVersion(version);
      await tx.appendDecision(projectId, 1, record);
      return tx.listDecisions(projectId, 1);
    });
    expect(rows).toHaveLength(1);
    expect(DecisionRecordSchema.parse(rows[0])).toEqual(record);
    expect(rows[0]).toMatchObject({ id: record.id, actorType: record.actorType, actorIdentifier: record.actorIdentifier, category: record.category, decision: record.decision, rationale: record.rationale, affectedDocuments: record.affectedDocuments, requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    expect(rows[0]).not.toHaveProperty("supersedesDecisionId");
  });

  it("commits one synthetic Workbench approval with an unchanged semantic Brief", async () => {
    const fixture = await createApprovalFixture(database);
    const projection = new FakeProjectMemorySyncPort();
    const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEAD_APPROVAL_PATH_REACHED"); }, createBriefApproval: () => new BriefApprovalService({ database, projection }) });
    const app = new WorkbenchApplication({ database, entry });
    const before = await app.handle({ action: "status", projectId: fixture.projectId });
    const approved = await app.handle({ action: "approve-brief", projectId: fixture.projectId, briefChecksum: fixture.document.briefChecksum, expectedRowVersion: before.project!.rowVersion });
    const state = await database.transaction(async (tx) => ({ project: await tx.getProject(fixture.projectId), version: await tx.getVersion(fixture.projectId, 1), document: await tx.getDocument(fixture.projectId, 1, "brief-v3"), decisions: await tx.listDecisions(fixture.projectId, 1), events: await tx.listWorkflowEvents(fixture.projectId, 1), history: await tx.listBriefRevisionHistory(fixture.projectId, 1) }));
    const persisted = BriefV3DocumentSchema.parse((await new DocumentRepository(database).get(fixture.projectId, 1, "brief-v3")));
    expect(approved.project?.workflowState).toBe("AWAITING_PLANNING_GENERATION");
    expect(approved.brief?.approved).toBe(true);
    expect(state.project?.workflow_state).toBe("AWAITING_PLANNING_GENERATION");
    expect(state.project?.row_version).toBe(2);
    expect(state.version?.rowVersion).toBe(1);
    expect(state.document?.rowVersion).toBe(2);
    expect(persisted.approval?.approvedCanonicalChecksum).toBe(fixture.document.briefChecksum);
    expect(persisted.brief).toEqual(fixture.document.brief);
    expect(persisted.briefChecksum).toBe(fixture.document.briefChecksum);
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]?.rationale).toBe("Explicit user approval accepted by the host-owned V3 readiness and currentness path.");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ fromState: "CLARIFYING", toState: "AWAITING_PLANNING_GENERATION" });
    expect(state.history).toHaveLength(0);
    expect(await projection.verifyVersionSnapshot(fixture.projectId, 1)).toBe(true);
  });

  it("rolls back a failure injected after the approval audit insertion", async () => {
    const fixture = await createApprovalFixture(database);
    const failingDatabase: PersistenceDatabase = { transaction: (work) => database.transaction((tx) => work({ ...tx, appendWorkflowEvent: async () => { throw new PersistenceError("PERSISTENCE_UNSUPPORTED", "synthetic failure after approval audit insertion"); } })) };
    const approval = new BriefApprovalService({ database: failingDatabase });
    const entry = new TrialEntryService({ database: failingDatabase, createLeadAgent: () => { throw new Error("LEAD_APPROVAL_PATH_REACHED"); }, createBriefApproval: () => approval });
    const app = new WorkbenchApplication({ database: failingDatabase, entry });
    await expect(app.handle({ action: "approve-brief", projectId: fixture.projectId, briefChecksum: fixture.document.briefChecksum, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await database.transaction(async (tx) => ({ project: await tx.getProject(fixture.projectId), version: await tx.getVersion(fixture.projectId, 1), document: await tx.getDocument(fixture.projectId, 1, "brief-v3"), decisions: await tx.listDecisions(fixture.projectId, 1), events: await tx.listWorkflowEvents(fixture.projectId, 1) }));
    expect(state.project?.workflow_state).toBe("CLARIFYING");
    expect(state.project?.row_version).toBe(1);
    expect(state.version?.rowVersion).toBe(1);
    expect(state.document?.checksum).toBe(mapDocumentToRow(fixture.document).checksum);
    expect(state.document?.rowVersion).toBe(1);
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("reports bounded diagnostics for a database constraint/type failure", async () => {
    const fixture = await createApprovalFixture(database);
    await expect(database.transaction((tx) => tx.appendWorkflowEvent({ id: "not-a-uuid", projectId: fixture.projectId, projectVersion: 1, fromState: "CLARIFYING", toState: "AWAITING_DESIGN_SELECTION", actor: "synthetic", reason: "synthetic diagnostic", createdAt: new Date().toISOString() }))).rejects.toMatchObject({
      code: "PERSISTENCE_PROVIDER_ERROR",
      diagnostic: { stage: "workflow-event-write", operation: "appendWorkflowEvent", sqlState: "22P02", table: "workflow_events", constraint: "unknown", errorClass: expect.any(String) },
    });
  });

  it("keeps rationale required at the domain and database contract boundary", () => {
    expect(() => DecisionRecordSchema.parse({ id: randomUUID(), timestamp: new Date().toISOString(), actorType: "user", actorIdentifier: "synthetic", category: "brief-approval", decision: "decision", rationale: "", affectedDocuments: ["brief-v3.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" })).toThrow();
  });
});

if (!databaseUrl) console.log("POSTGRES APPROVAL PERSISTENCE: SKIPPED (DATABASE_URL unavailable)");
else console.log("POSTGRES APPROVAL PERSISTENCE: ENABLED");
