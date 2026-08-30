import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries, createV3RequirementId, mapCanonicalBriefRequirementIds } from "@/domain/requirements/v3/identity";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakePlannerMemoryPort } from "./memory";
import { buildPlanningPackage } from "./deterministic";
import { PlanningRecoveryService, type PlanningRecoveryProvider } from "./recovery";
import { normalizePlanningPackageForHost } from "./refresh-admission";

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
const projectIds: string[] = [];
const timestamp = "2026-08-30T12:00:00.000Z";

function briefFor(projectId: string, includeRecoveryRequirement: boolean) {
  const value = CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    requirements: includeRecoveryRequirement
      ? [...cleanBriefV3.requirements, { id: "REQUIREMENT:postgres-recovery", category: "FEATURE", statement: "Retain the synthetic Postgres recovery requirement in the complete Planning package.", sourceRefs: ["synthetic:postgres-recovery"] }]
      : cleanBriefV3.requirements,
  });
  const mappings = new Map(canonicalRequirementEntries(value).map((entry, index) => [entry.id, createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: `postgres-recovery:${index}:${entry.id}` })]));
  return mapCanonicalBriefRequirementIds(value, mappings);
}

function plannerInput(projectId: string, canonicalBrief: CanonicalBriefV3) {
  const checksum = canonicalBriefChecksum(canonicalBrief);
  const approvedBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1, approval: { approved: true, approvedRequirementsChecksum: checksum }, briefStatus: "approved" });
  return { projectId, projectVersion: 1, approvedBrief, canonicalBrief, approvedBriefChecksum: checksum, originalPromptReference: "synthetic-postgres-recovery", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION" as const, existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: `postgres-recovery:${projectId}`, expectedRowVersion: 1 };
}

async function fixture(database: PostgresPersistenceDatabase) {
  const projectId = randomUUID();
  projectIds.push(projectId);
  const currentBrief = briefFor(projectId, true);
  const baseBrief = briefFor(projectId, false);
  const checksum = canonicalBriefChecksum(currentBrief);
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `postgres-recovery-${projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic PostgreSQL Planning recovery fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: checksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: currentBrief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-postgres-user", approvedCanonicalChecksum: checksum } }));
  const baseline = normalizePlanningPackageForHost({ candidate: buildPlanningPackage(plannerInput(projectId, baseBrief)), projectId, projectVersion: 1, approvedBriefChecksum: checksum, canonicalBrief: currentBrief, timestamp });
  await new DocumentRepository(database).save(baseline);
  return { projectId, currentBrief, baseline, checksum };
}

function provider(): PlanningRecoveryProvider {
  return { planRecovery: async (input) => buildPlanningPackage(input.plannerInput) };
}

async function cleanup(pool: ReturnType<typeof createPostgresPool>) {
  for (const projectId of projectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE planning_recovery_evidence DISABLE TRIGGER planning_recovery_evidence_immutable");
      await client.query("DELETE FROM planning_recovery_evidence WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM workflow_documents WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM project_versions WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM factory_projects WHERE id=$1", [projectId]);
      await client.query("ALTER TABLE planning_recovery_evidence ENABLE TRIGGER planning_recovery_evidence_immutable");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

describePostgres("Planning recovery real PostgreSQL certification", () => {
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
  });

  it("commits one complete recovery with exact evidence, CAS advancement, and no downstream promotion", async () => {
    const value = await fixture(database);
    const memory = new FakePlannerMemoryPort();
    const service = new PlanningRecoveryService({ database, memory, provider: provider(), hostRecoveryEnabled: true, now: () => timestamp });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-commit" });
    expect(prepared.eligibility).toMatchObject({ eligible: true, reason: "RECOVERY_REQUIRED" });
    const result = await service.recover({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-commit" });
    expect(result.status).toBe("COMMITTED");
    expect(result.package.accepted).toBe(false);
    expect(result.evidence.priorPlanningPackage).toEqual(value.baseline);
    const state = await database.transaction(async (tx) => ({
      project: await tx.getProject(value.projectId),
      version: await tx.getVersion(value.projectId, 1),
      brief: await tx.getDocument(value.projectId, 1, "brief-v3"),
      planning: await tx.getDocument(value.projectId, 1, "planning-package"),
      evidence: await tx.listPlanningRecoveryEvidence(value.projectId, 1),
      architecture: await tx.getDocument(value.projectId, 1, "architecture"),
      phase7c: await tx.getDocument(value.projectId, 1, "phase-7c-contract-package"),
    }));
    expect(state.project).toMatchObject({ row_version: 1, workflow_state: "AWAITING_DESIGN_SELECTION" });
    expect(state.version).toMatchObject({ rowVersion: 1, requirementsChecksum: value.checksum });
    expect(state.brief?.rowVersion).toBe(1);
    expect(state.planning).toMatchObject({ rowVersion: 2, checksum: checksumPersistedDocument(result.package) });
    expect(state.evidence).toHaveLength(1);
    expect(state.architecture).toBeNull();
    expect(state.phase7c).toBeNull();
    expect(memory.documents.get(`${value.projectId}:1`)).toEqual(expect.objectContaining({ "planning-package.json": result.package }));
  });

  it("rolls back the real PostgreSQL package and evidence writes after injected failure", async () => {
    const value = await fixture(database);
    const service = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: provider(), hostRecoveryEnabled: true, now: () => timestamp, fault: { hit: (point) => { if (point === "after-evidence-write") throw new Error("synthetic-postgres-recovery-fault"); } } });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-rollback" });
    const candidate = buildPlanningPackage(plannerInput(value.projectId, value.currentBrief));
    await expect(service.apply({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-rollback", plan: prepared.plan!, candidate })).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await database.transaction(async (tx) => ({ planning: await tx.getDocument(value.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(value.projectId, 1) }));
    expect(state.planning?.checksum).toBe(checksumPersistedDocument(value.baseline));
    expect(state.planning?.rowVersion).toBe(1);
    expect(state.evidence).toHaveLength(0);
  });

  it("rejects a stale prepared CAS token before any recovery evidence is written", async () => {
    const value = await fixture(database);
    const service = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: provider(), hostRecoveryEnabled: true, now: () => timestamp });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-stale" });
    await new DocumentRepository(database).save({ ...value.baseline, updatedAt: "2026-08-30T12:00:01.000Z" });
    const candidate = buildPlanningPackage(plannerInput(value.projectId, value.currentBrief));
    await expect(service.apply({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-stale", plan: prepared.plan!, candidate })).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await database.transaction(async (tx) => ({ planning: await tx.getDocument(value.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(value.projectId, 1) }));
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.evidence).toHaveLength(0);
  });
});

if (!databaseUrl) console.log("PLANNING RECOVERY POSTGRES: SKIPPED (DATABASE_URL unavailable)");
else console.log("PLANNING RECOVERY POSTGRES: ENABLED");
