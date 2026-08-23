import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Pool } from "pg";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { mapDocumentToRow, mapRowToDocument } from "@/persistence/database/mapping";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FakePlannerMemoryPort } from "./memory";
import { PlannerArchitectService } from "./service";
import { buildPlanningPackage, evaluatePlanningAcceptanceReadiness, planningChecksum, planningSemanticChecksum } from "./deterministic";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";

const runId = randomUUID().replaceAll("-", "").slice(0, 10);
const timestamp = "2026-08-23T12:00:00.000Z";

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
const postgresProjectIds: string[] = [];

function syntheticBrief(projectId: string): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1,
    documentType: "requirements",
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    projectSummary: "Synthetic service site for Planning Acceptance certification.",
    protectedFunctionalityRequired: false,
    imagesRequired: true,
    businessGoals: ["Explain the service"],
    targetAudiences: ["Visitors"],
    pages: [
      { slug: "home", purpose: "Explain the service" },
      { slug: "impressum", purpose: "Show legal information placeholders" },
      { slug: "datenschutz", purpose: "Show privacy information placeholders" },
    ],
    userRoles: [],
    features: [],
    forms: [],
    contentRequirements: [],
    backendRequirements: [],
    supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first",
    storageDecision: "not-needed",
    emailDecision: "not-needed",
    administrationDecision: "not-needed",
    seoRequirements: [],
    localization: { locales: ["en"], defaultLocale: "en" },
    imageSourceDecision: "custom",
    suppliedBrandInformation: { status: "missing" },
    suppliedLogoLocation: { status: "missing" },
    technicalConstraints: [],
    explicitExclusions: [],
    userAcceptanceCriteria: ["Visitors can read the service information"],
    unresolvedItems: [],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic", approvedRequirementsChecksum: "a".repeat(64) },
    contactFacts: [],
    legalFacts: [],
    brandFacts: [],
    logoMetadata: [],
    imageSourcingNotes: [],
    evidence: [],
    recommendations: [],
    briefStatus: "approved",
    briefVersion: 1,
    legalComplianceConstraints: { constraints: [], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  });
}

function plannerInput(brief: RequirementSpecification): PlannerAgentInput {
  return {
    projectId: brief.projectId,
    projectVersion: 1,
    approvedBrief: brief,
    approvedBriefChecksum: checksumPersistedDocument(brief),
    originalPromptReference: "original-prompt.md",
    clarificationEvidenceReferences: ["clarification-log.json"],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: `synthetic-planning-${runId}`,
    expectedRowVersion: 1,
  };
}

function deferredPackage(brief: RequirementSpecification) {
  const base = buildPlanningPackage(plannerInput(brief));
  return PlanningPackageSchema.parse({
    ...base,
    assets: { ...base.assets, entries: base.assets.entries.map((entry) => ({ ...entry, generationStatus: "pending-approval" as const, userApprovalRequired: true })) },
    blockers: [
      "Final legal address and registry facts must replace explicit placeholders before public publication.",
      "Rights and licenses for future additional photography must be checked and documented before publication.",
    ],
  });
}

async function createFixture(database: PersistenceDatabase = new InMemoryPersistenceDatabase()) {
  const projectId = randomUUID();
  const brief = syntheticBrief(projectId);
  const planning = deferredPackage(brief);
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `synthetic-planning-atomic-${runId}-${projectId.slice(0, 8)}`, origin: "SYNTHETIC", siteLanguage: "en", originalPrompt: "Synthetic Planning Acceptance transaction fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: checksumPersistedDocument(brief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  await documents.save(brief);
  await documents.save(planning);
  await documents.save(planning.architecture);
  await documents.save(planning.content);
  await documents.save(planning.assets);
  return { database, projectId, brief, planning, memory: new FakePlannerMemoryPort() };
}

function acceptanceInput(fixture: Awaited<ReturnType<typeof createFixture>>, overrides: Partial<{ expectedRowVersion: number; planningChecksum: string; idempotencyKey: string }> = {}) {
  return {
    projectId: fixture.projectId,
    projectVersion: 1,
    planningChecksum: overrides.planningChecksum ?? planningChecksum(fixture.planning),
    acceptedBy: "synthetic-user",
    acceptedAt: timestamp,
    expectedRowVersion: overrides.expectedRowVersion ?? 1,
    idempotencyKey: overrides.idempotencyKey ?? `synthetic-planning-accept-${runId}-${fixture.projectId}`,
  };
}

async function stateOf(database: PersistenceDatabase, projectId: string) {
  return database.transaction(async (tx) => ({
    project: await tx.getProject(projectId),
    version: await tx.getVersion(projectId, 1),
    brief: await tx.getDocument(projectId, 1, "requirements"),
    planning: await tx.getDocument(projectId, 1, "planning-package"),
    architecture: await tx.getDocument(projectId, 1, "architecture"),
    content: await tx.getDocument(projectId, 1, "content-plan"),
    assets: await tx.getDocument(projectId, 1, "asset-manifest"),
    phase7c: await tx.getDocument(projectId, 1, "phase-7c-contract-package"),
    decisions: await tx.listDecisions(projectId, 1),
    events: await tx.listWorkflowEvents(projectId, 1),
  }));
}

function semanticPlanningValue(value: PlanningPackage) {
  return { ...value, accepted: false, acceptance: {}, updatedAt: value.createdAt, architecture: { ...value.architecture, acceptance: { accepted: false } } };
}

async function cleanupPostgres(pool: Pool) {
  for (const projectId of postgresProjectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM idempotency_records WHERE idempotency_key LIKE $1", [`synthetic-planning-accept-${runId}-%`]);
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

describe("Planning Acceptance canonical transaction", () => {
  it("commits canonical documents, decision, event, and workflow together while preserving semantic planning and Brief state", async () => {
    const fixture = await createFixture();
    const service = new PlannerArchitectService({ database: fixture.database, memory: fixture.memory });
    const result = await service.acceptPlanningPackage(acceptanceInput(fixture));
    const state = await stateOf(fixture.database, fixture.projectId);
    const beforeBrief = mapDocumentToRow(fixture.brief);
    const beforeSemantic = JSON.stringify(semanticPlanningValue(fixture.planning));
    const beforeSemanticChecksum = planningSemanticChecksum(fixture.planning);
    const accepted = PlanningPackageSchema.parse(mapRowToDocument(state.planning!));
    const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: accepted, context: { legalPlaceholderPolicy: "USE_EXPLICIT_PLACEHOLDERS" } });

    expect(result.projectState).toBe("ARCHITECTURE_REVIEW");
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 2 });
    expect(state.version?.rowVersion).toBe(1);
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.architecture?.rowVersion).toBe(2);
    expect(state.content?.rowVersion).toBe(1);
    expect(state.assets?.rowVersion).toBe(1);
    expect(state.phase7c?.rowVersion).toBe(1);
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({ category: "planning-acceptance", actorIdentifier: "synthetic-user" });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ fromState: "AWAITING_DESIGN_SELECTION", toState: "ARCHITECTURE_REVIEW" });
    expect(accepted.accepted).toBe(true);
    expect(JSON.stringify(semanticPlanningValue(accepted))).toBe(beforeSemantic);
    expect(planningSemanticChecksum(accepted)).toBe(beforeSemanticChecksum);
    expect(planningChecksum(accepted)).not.toBe(planningChecksum(fixture.planning));
    expect(accepted.blockers).toEqual(fixture.planning.blockers);
    expect(readiness.deferredItems.map((item) => item.id)).toEqual(["FINAL_LEGAL_FACTS_REQUIRED", "PHOTO_RIGHTS_PROVENANCE_REQUIRED"]);
    expect(state.brief?.checksum).toBe(beforeBrief.checksum);
    expect(state.brief?.rowVersion).toBe(beforeBrief.rowVersion);
  });

  it.each(["after-acceptance-write", "after-decision-write", "before-workflow-transition"] as const)("rolls back every canonical write at fault point %s", async (point) => {
    const fixture = await createFixture();
    const service = new PlannerArchitectService({ database: fixture.database, memory: fixture.memory, acceptanceFaultInjector: { hit: async (current) => { if (current === point) throw new Error(`synthetic-${point}`); } } });
    await expect(service.acceptPlanningPackage(acceptanceInput(fixture))).rejects.toThrow(`synthetic-${point}`);
    const state = await stateOf(fixture.database, fixture.projectId);
    expect(state.project).toMatchObject({ workflow_state: "AWAITING_DESIGN_SELECTION", row_version: 1 });
    expect(state.planning?.checksum).toBe(mapDocumentToRow(fixture.planning).checksum);
    expect(state.architecture?.rowVersion).toBe(1);
    expect(state.phase7c).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a stale row-version CAS without changing canonical state", async () => {
    const fixture = await createFixture();
    const observed = await new ProjectRepository(fixture.database).getWithVersion(fixture.projectId);
    const current = fixture.database instanceof InMemoryPersistenceDatabase ? fixture.database.projects.get(fixture.projectId)! : undefined;
    if (current && fixture.database instanceof InMemoryPersistenceDatabase) fixture.database.projects.set(fixture.projectId, { ...current, row_version: 2 });
    const service = new PlannerArchitectService({ database: fixture.database, memory: fixture.memory });
    await expect(service.acceptPlanningPackage(acceptanceInput(fixture, { expectedRowVersion: observed?.rowVersion ?? 1 }))).rejects.toMatchObject({ code: "PLANNING_STALE" });
    const state = await stateOf(fixture.database, fixture.projectId);
    expect(state.project?.workflow_state).toBe("AWAITING_DESIGN_SELECTION");
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects non-deferred readiness blockers before any acceptance write", async () => {
    const fixture = await createFixture();
    const blocked = PlanningPackageSchema.parse({ ...fixture.planning, blockers: ["EMAIL_PROVIDER_PENDING"] });
    await new DocumentRepository(fixture.database).save(blocked);
    const service = new PlannerArchitectService({ database: fixture.database, memory: fixture.memory });
    await expect(service.acceptPlanningPackage(acceptanceInput({ ...fixture, planning: blocked }))).rejects.toMatchObject({ code: "ARCHITECTURE_BLOCKED" });
    const state = await stateOf(fixture.database, fixture.projectId);
    expect(state.project?.workflow_state).toBe("AWAITING_DESIGN_SELECTION");
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.phase7c).toBeNull();
  });

  it("rejects repeat acceptance without duplicating the decision, event, or document rows", async () => {
    const fixture = await createFixture();
    const service = new PlannerArchitectService({ database: fixture.database, memory: fixture.memory });
    const accepted = await service.acceptPlanningPackage(acceptanceInput(fixture));
    await expect(service.acceptPlanningPackage(acceptanceInput(fixture, { planningChecksum: accepted.planningChecksum, expectedRowVersion: accepted.rowVersion }))).rejects.toMatchObject({ code: "PLANNER_WORKFLOW_STATE_INVALID" });
    const state = await stateOf(fixture.database, fixture.projectId);
    expect(state.decisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.architecture?.rowVersion).toBe(2);
  });

  it("keeps canonical acceptance when filesystem projection fails and reconciles it from a fresh service", async () => {
    const fixture = await createFixture();
    class FailingMemory extends FakePlannerMemoryPort {
      fail = true;
      override async writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>) { if (this.fail) throw new Error("synthetic-filesystem-failure"); return super.writeSnapshot(projectId, version, documents); }
    }
    const memory = new FailingMemory();
    const service = new PlannerArchitectService({ database: fixture.database, memory });
    await expect(service.acceptPlanningPackage(acceptanceInput(fixture))).rejects.toMatchObject({ code: "PLANNING_PROJECTION_FAILED" });
    const committed = await stateOf(fixture.database, fixture.projectId);
    expect(committed.project?.workflow_state).toBe("ARCHITECTURE_REVIEW");
    expect(committed.decisions).toHaveLength(1);
    expect(committed.events).toHaveLength(1);
    expect(memory.documents.size).toBe(0);
    expect((await new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort() }).getPlanningStatus(fixture.projectId, 1)).accepted).toBe(true);
    memory.fail = false;
    await expect(service.reconcileAcceptedPlanningProjection(fixture.projectId, 1)).resolves.toMatchObject({ projectionStatus: "SYNCED" });
    expect(memory.documents.get(`${fixture.projectId}:1`)?.["planning-package.json"]).toBeTruthy();
    expect(memory.decisions).toHaveLength(1);
  });

  it("keeps Workbench and the alternate production acceptance entrypoint on the same Planner boundary", () => {
    const workbench = readFileSync("src/runtime/workbench/application.ts", "utf8");
    const alternate = readFileSync("src/runtime/production-e2e-stage-runner.ts", "utf8");
    expect(workbench).toContain("scope.planner.acceptPlanningPackage");
    expect(alternate).toContain("scope.planner.acceptPlanningPackage");
  });
});

describePostgres("Planning Acceptance Postgres certification", () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let database: PostgresPersistenceDatabase;

  beforeAll(() => {
    pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
    database = new PostgresPersistenceDatabase(pool);
  });

  afterAll(async () => {
    await cleanupPostgres(pool);
    await pool.end();
  });

  it("commits the synthetic production-shaped acceptance on real Postgres", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.projectId);
    const service = new PlannerArchitectService({ database, memory: fixture.memory });
    const result = await service.acceptPlanningPackage(acceptanceInput(fixture, { idempotencyKey: `synthetic-planning-accept-${runId}-${fixture.projectId}` }));
    const state = await stateOf(database, fixture.projectId);
    expect(result.projectState).toBe("ARCHITECTURE_REVIEW");
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 2 });
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.architecture?.rowVersion).toBe(2);
    expect(state.phase7c).not.toBeNull();
    expect(state.decisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("rolls back a real Postgres acceptance when injected after canonical acceptance writes", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.projectId);
    const service = new PlannerArchitectService({ database, memory: fixture.memory, acceptanceFaultInjector: { hit: async (point) => { if (point === "after-acceptance-write") throw new Error("synthetic-postgres-rollback"); } } });
    await expect(service.acceptPlanningPackage(acceptanceInput(fixture, { idempotencyKey: `synthetic-planning-accept-${runId}-${fixture.projectId}` }))).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await stateOf(database, fixture.projectId);
    expect(state.project).toMatchObject({ workflow_state: "AWAITING_DESIGN_SELECTION", row_version: 1 });
    expect(state.planning?.rowVersion).toBe(1);
    expect(state.architecture?.rowVersion).toBe(1);
    expect(state.phase7c).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});

if (!databaseUrl) console.log("PLANNING ACCEPTANCE POSTGRES CERTIFICATION: SKIPPED (DATABASE_URL unavailable)");
else console.log("PLANNING ACCEPTANCE POSTGRES CERTIFICATION: ENABLED");
