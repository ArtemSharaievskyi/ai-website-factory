import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksumForPolicy } from "@/agents/planner/deterministic";
import { PlanningPackageSchema, PlannerAgentInputSchema } from "@/agents/planner/contracts";
import { PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT, PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY } from "@/agents/planner/checksum-policy";
import { PlanningSemanticChecksumRecertificationService } from "./semantic-checksum-recertification";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-02T00:00:00.000Z";
const T2 = "2026-03-03T00:00:00.000Z";

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

async function fixture(database: PersistenceDatabase, projectId = randomUUID()) {
  const brief = CanonicalBriefV3Schema.parse(cleanBriefV3);
  const approvedBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1 });
  const planningInput = PlannerAgentInputSchema.parse({
    projectId,
    projectVersion: 1,
    approvedBrief,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-recertification-prompt",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-recertification",
    expectedRowVersion: 1,
  });
  const built = buildPlanningPackage(planningInput);
  const legacy = PlanningPackageSchema.parse({ ...built, semanticChecksumPolicyVersion: undefined, createdAt: T0, updatedAt: T0 });
  const persistedSource = PlanningPackageSchema.parse({ ...legacy, createdAt: T1, updatedAt: T1 });
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: T0, updatedAt: T0, id: projectId, slug: `synthetic-recertification-${projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic Planning checksum recertification.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  const version = { id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION" as const, memoryRootPath: null, requirementsChecksum: briefChecksum(brief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: T0, updatedAt: T0, rowVersion: 1 };
  const briefDocument = BriefV3DocumentSchema.parse({ ...createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: T0, updatedAt: T0 }), approval: { approved: true, approvedAt: T0, approvedBy: "synthetic-user", approvedCanonicalChecksum: canonicalBriefChecksum(brief) } });
  const documents = new DocumentRepository(database);
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create(version);
  await documents.save(briefDocument);
  await documents.save(legacy);
  await documents.save(persistedSource);
  return { projectId, brief, planning: persistedSource, rowVersion: 2, briefChecksum: briefDocument.briefChecksum };
}

function briefChecksum(brief: ReturnType<typeof CanonicalBriefV3Schema.parse>) {
  return canonicalBriefChecksum(brief);
}

async function cleanup(pool: ReturnType<typeof createPostgresPool>) {
  for (const projectId of realProjectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM idempotency_records WHERE operation=$1 AND idempotency_key LIKE $2", ["planning-semantic-checksum-recertification-v1", `${projectId}:%`]);
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

async function assertRecertification(database: PersistenceDatabase, projectId: string) {
  const current = await database.transaction(async (tx) => ({
    project: await tx.getProject(projectId),
    version: await tx.getVersion(projectId, 1),
    brief: await tx.getDocument(projectId, 1, "brief-v3"),
    planning: await tx.getDocument(projectId, 1, "planning-package"),
  }));
  if (!current.project || !current.version || !current.brief || !current.planning) throw new Error("Synthetic recertification fixture is incomplete.");
  const planning = PlanningPackageSchema.parse(current.planning.payload);
  return { current, planning, target: planningSemanticChecksumForPolicy(planning, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT), legacy: planningSemanticChecksumForPolicy(planning, PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY) };
}

describe("host-owned Planning semantic checksum recertification", () => {
  it("re-certifies a legacy package without Planner, preserves acceptance/currentness, syncs Project Memory, and replays safely", async () => {
    const database = new InMemoryPersistenceDatabase();
    const seeded = await fixture(database);
    const inspected = await assertRecertification(database, seeded.projectId);
    const projection = new FakeProjectMemorySyncPort();
    const service = new PlanningSemanticChecksumRecertificationService({ database, projection, clock: () => T2 });
    const result = await service.recertify({ projectId: seeded.projectId, projectVersion: 1, expectedProjectWorkflowState: "AWAITING_DESIGN_SELECTION", expectedProjectRowVersion: 1, expectedProjectVersionRowVersion: 1, expectedBriefRowVersion: 1, expectedPlanningRowVersion: 2, expectedBriefChecksum: seeded.briefChecksum, expectedBriefDocumentChecksum: inspected.current.brief!.checksum, expectedPlanningDocumentChecksum: checksumPersistedDocument(inspected.planning), expectedPlanningLegacySemanticChecksum: inspected.legacy, targetPlanningSemanticChecksum: inspected.target, expectedSelectedDesignChecksum: null, expectedArchitectureChecksum: null, now: T2 });
    expect(result).toMatchObject({ outcome: "COMMITTED", projectionStatus: "SYNCED", previousPlanningRowVersion: 2, nextPlanningRowVersion: 3, preparedTargetPlanningSemanticChecksum: inspected.target, actualCommittedPlanningSemanticChecksum: inspected.target });
    const state = await assertRecertification(database, seeded.projectId);
    const committed = state.planning;
    expect(committed.semanticChecksumPolicyVersion).toBe(PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT);
    expect(committed.accepted).toBe(false);
    expect(committed.architecture.acceptance.accepted).toBe(false);
    expect(planningSemanticChecksumForPolicy(committed, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT)).toBe(inspected.target);
    expect(state.current.planning?.checksum).toBe(planningDocumentChecksum(committed));
    expect(state.current.planning?.createdAt).toBe(T0);
    expect(state.current.project?.row_version).toBe(1);
    expect(state.current.project?.workflow_state).toBe("AWAITING_DESIGN_SELECTION");
    expect(state.current.version?.rowVersion).toBe(1);
    expect((await database.transaction((tx) => tx.listDecisions(seeded.projectId, 1)))).toHaveLength(1);
    expect((await database.transaction((tx) => tx.listWorkflowEvents(seeded.projectId, 1)))).toHaveLength(0);
    await expect(projection.verifyVersionSnapshot(seeded.projectId, 1)).resolves.toBe(true);
    const replay = await service.recertify({ projectId: seeded.projectId, projectVersion: 1, expectedProjectWorkflowState: "AWAITING_DESIGN_SELECTION", expectedProjectRowVersion: 1, expectedProjectVersionRowVersion: 1, expectedBriefRowVersion: 1, expectedPlanningRowVersion: 2, expectedBriefChecksum: seeded.briefChecksum, expectedBriefDocumentChecksum: inspected.current.brief!.checksum, expectedPlanningDocumentChecksum: checksumPersistedDocument(inspected.planning), expectedPlanningLegacySemanticChecksum: inspected.legacy, targetPlanningSemanticChecksum: inspected.target, expectedSelectedDesignChecksum: null, expectedArchitectureChecksum: null, now: "2026-04-04T00:00:00.000Z" });
    expect(replay.outcome).toBe("COMMITTED_REPLAY");
    expect((await database.transaction((tx) => tx.getDocument(seeded.projectId, 1, "planning-package")))?.rowVersion).toBe(3);
  });

  describePostgres("real PostgreSQL certification", () => {
    let pool: ReturnType<typeof createPostgresPool>;
    let database: PostgresPersistenceDatabase;
    afterAll(async () => { await cleanup(pool); await pool.end(); });
    it("proves T0 row metadata, T1 source payload, and T2 APPLY time do not alter semantic identity", async () => {
      pool = createPostgresPool({ DATABASE_URL: databaseUrl!, NODE_ENV: "test" });
      database = new PostgresPersistenceDatabase(pool);
      const projectId = randomUUID();
      realProjectIds.push(projectId);
      const seeded = await fixture(database, projectId);
      const inspected = await assertRecertification(database, projectId);
      const result = await new PlanningSemanticChecksumRecertificationService({ database }).recertify({ projectId, projectVersion: 1, expectedProjectWorkflowState: "AWAITING_DESIGN_SELECTION", expectedProjectRowVersion: 1, expectedProjectVersionRowVersion: 1, expectedBriefRowVersion: 1, expectedPlanningRowVersion: 2, expectedBriefChecksum: seeded.briefChecksum, expectedBriefDocumentChecksum: inspected.current.brief!.checksum, expectedPlanningDocumentChecksum: checksumPersistedDocument(inspected.planning), expectedPlanningLegacySemanticChecksum: inspected.legacy, targetPlanningSemanticChecksum: inspected.target, expectedSelectedDesignChecksum: null, expectedArchitectureChecksum: null, now: T2 });
      const state = await assertRecertification(database, projectId);
      expect(result.actualCommittedPlanningSemanticChecksum).toBe(inspected.target);
      expect(state.current.planning?.createdAt).toBe(T0);
      expect(state.planning.createdAt).toBe(T1);
      expect(state.planning.updatedAt).toBe(T2);
      expect(state.current.planning?.checksum).toBe(result.nextPlanningDocumentChecksum);
      expect(planningSemanticChecksumForPolicy(state.planning, PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT)).toBe(inspected.target);
    });
  });
});

if (!databaseUrl) console.log("PLANNING CHECKSUM RECERTIFICATION POSTGRES: SKIPPED (DATABASE_URL unavailable)");
else console.log("PLANNING CHECKSUM RECERTIFICATION POSTGRES: ENABLED");
