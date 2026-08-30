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
import { PlanningRecoveryCrash, PlanningRecoveryService, type PlanningRecoveryProvider, type PlanningRecoveryProviderResult } from "./recovery";
import { createPlanningOwnedRequirementManifest } from "./recovery-manifests";
import { normalizePlanningPackageForHost } from "./refresh-admission";
import { createStaticSourceCurrentnessPort } from "@/runtime/source-head";

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
const TEST_SOURCE_HEAD = "b".repeat(40);

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

function completeRecoveryCandidate(input: Parameters<typeof buildPlanningPackage>[0]) {
  const candidate = buildPlanningPackage(input);
  const canonical = input.canonicalBrief;
  if (!canonical) return candidate;
  return {
    ...candidate,
    traceability: [...candidate.traceability, {
      decisionId: randomUUID(),
      category: "synthetic-recovery-coverage",
      requirementReferences: canonicalRequirementEntries(canonical).map((entry) => entry.id),
      systemConstraintReferences: ["synthetic-recovery-fixture"],
      rationale: "Synthetic recovery fixture explicitly traces every current V3 requirement.",
      confidence: "high" as const,
      userConfirmationRequired: false,
    }],
  };
}

function recoveryRequirementDisposition(category: string) {
  if (category === "EXCLUSION" || category === "PROHIBITED") return "EXPLICIT_EXCLUSION" as const;
  if (category === "FORM_INTERACTION") return "INTERACTION_REQUIREMENT" as const;
  if (category === "FORM") return "FORM_CONSTRAINT" as const;
  if (category === "SEO") return "SEO_REQUIREMENT" as const;
  if (["CONTENT", "ACCEPTANCE"].includes(category)) return "CONTENT_REQUIREMENT" as const;
  if (["BACKEND", "DATABASE", "TECHNICAL", "UX_RESPONSIVE", "LEGAL_CONSTRAINT"].includes(category)) return "NON_FUNCTIONAL_CONSTRAINT" as const;
  if (["BRAND_FACT", "BRAND_VISUAL", "IMAGE_NOTE"].includes(category)) return "ASSET_REQUIREMENT" as const;
  return "OTHER_PLANNING_RESPONSIBILITY" as const;
}

function completeRecoveryResult(input: Parameters<typeof buildPlanningPackage>[0], candidate = completeRecoveryCandidate(input)): PlanningRecoveryProviderResult {
  const manifest = createPlanningOwnedRequirementManifest(input.canonicalBrief!);
  return {
    planningPackage: candidate,
    requirementAccounting: manifest.requirements.map((entry) => ({
      disposition: recoveryRequirementDisposition(entry.category),
      planningTargetRefs: [{ kind: "section" as const, routeHandle: null, pageHandle: null, section: "traceability" as const }],
      semanticEvidence: "Synthetic fixture records the explicit Planning treatment.",
    })),
  };
}

function recoveryAccountingForPlan(plan: NonNullable<Awaited<ReturnType<PlanningRecoveryService["prepare"]>>["plan"]>) {
  return plan.planningRequirementManifest!.requirements.map((entry) => ({
    disposition: recoveryRequirementDisposition(entry.category),
    planningTargetRefs: [{ kind: "section" as const, routeHandle: null, pageHandle: null, section: "traceability" as const }],
    semanticEvidence: "Synthetic apply fixture records the explicit Planning treatment.",
  }));
}

async function fixture(database: PostgresPersistenceDatabase, versionState: "DRAFT" | "AWAITING_DESIGN_SELECTION" = "AWAITING_DESIGN_SELECTION") {
  const projectId = randomUUID();
  projectIds.push(projectId);
  const currentBrief = briefFor(projectId, true);
  const baseBrief = briefFor(projectId, false);
  const checksum = canonicalBriefChecksum(currentBrief);
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `postgres-recovery-${projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic PostgreSQL Planning recovery fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: versionState, memoryRootPath: null, requirementsChecksum: checksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: currentBrief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-postgres-user", approvedCanonicalChecksum: checksum } }));
  const baseline = normalizePlanningPackageForHost({ candidate: buildPlanningPackage(plannerInput(projectId, baseBrief)), projectId, projectVersion: 1, approvedBriefChecksum: checksum, canonicalBrief: currentBrief, timestamp });
  await new DocumentRepository(database).save(baseline);
  return { projectId, currentBrief, baseline, checksum };
}

function provider(): PlanningRecoveryProvider {
  return { planRecovery: async (input) => completeRecoveryResult(input.plannerInput) };
}

async function cleanup(pool: ReturnType<typeof createPostgresPool>) {
  for (const projectId of projectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE planning_recovery_evidence DISABLE TRIGGER planning_recovery_evidence_immutable");
      await client.query("DELETE FROM planning_recovery_runs WHERE project_id=$1", [projectId]);
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
    const service = new PlanningRecoveryService({ database, memory, provider: provider(), source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp });
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
      runs: await tx.listPlanningRecoveryRuns(value.projectId, 1),
      architecture: await tx.getDocument(value.projectId, 1, "architecture"),
      phase7c: await tx.getDocument(value.projectId, 1, "phase-7c-contract-package"),
    }));
    expect(state.project).toMatchObject({ row_version: 1, workflow_state: "AWAITING_DESIGN_SELECTION" });
    expect(state.version).toMatchObject({ rowVersion: 1, requirementsChecksum: value.checksum });
    expect(state.brief?.rowVersion).toBe(1);
    expect(state.planning).toMatchObject({ rowVersion: 2, checksum: checksumPersistedDocument(result.package) });
    expect(state.evidence).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ state: "COMMITTED", providerAttemptCount: 1, projectMemoryStatus: "SYNCED", terminalOutcome: "COMMITTED" });
    expect(state.architecture).toBeNull();
    expect(state.phase7c).toBeNull();
    expect(memory.documents.get(`${value.projectId}:1`)).toEqual(expect.objectContaining({ "planning-package.json": result.package }));
  });

  it("allows a DRAFT project version while the project workflow awaits design selection", async () => {
    const value = await fixture(database, "DRAFT");
    let calls = 0;
    const service = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryResult(input.plannerInput); } }, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp });

    const result = await service.recover({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-draft-version" });

    expect(result.status).toBe("COMMITTED");
    expect(calls).toBe(1);
    const state = await database.transaction(async (tx) => ({ project: await tx.getProject(value.projectId), version: await tx.getVersion(value.projectId, 1), run: await tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-draft-version") }));
    expect(state.project).toMatchObject({ row_version: 1, workflow_state: "AWAITING_DESIGN_SELECTION" });
    expect(state.version).toMatchObject({ rowVersion: 1, state: "DRAFT" });
    expect(state.run).toMatchObject({ state: "COMMITTED", providerAttemptCount: 1, terminalOutcome: "COMMITTED" });
  });

  it("rolls back the real PostgreSQL package and evidence writes after injected failure", async () => {
    const value = await fixture(database);
    const service = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: provider(), source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, fault: { hit: (point) => { if (point === "after-evidence-write") throw new Error("synthetic-postgres-recovery-fault"); } } });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-rollback" });
    const candidate = completeRecoveryCandidate(plannerInput(value.projectId, value.currentBrief));
    await expect(service.apply({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-rollback", plan: prepared.plan!, candidate, requirementAccounting: recoveryAccountingForPlan(prepared.plan!) })).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await database.transaction(async (tx) => ({ planning: await tx.getDocument(value.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(value.projectId, 1) }));
    expect(state.planning?.checksum).toBe(checksumPersistedDocument(value.baseline));
    expect(state.planning?.rowVersion).toBe(1);
    expect(state.evidence).toHaveLength(0);
  });

  it("rejects a stale prepared CAS token before any recovery evidence is written", async () => {
    const value = await fixture(database);
    const service = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: provider(), source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-stale" });
    await new DocumentRepository(database).save({ ...value.baseline, updatedAt: "2026-08-30T12:00:01.000Z" });
    const candidate = completeRecoveryCandidate(plannerInput(value.projectId, value.currentBrief));
    await expect(service.apply({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-stale", plan: prepared.plan!, candidate, requirementAccounting: recoveryAccountingForPlan(prepared.plan!) })).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await database.transaction(async (tx) => ({ planning: await tx.getDocument(value.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(value.projectId, 1) }));
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.evidence).toHaveLength(0);
  });

  it("persists a provider result across process replacement and never calls the provider twice", async () => {
    const value = await fixture(database);
    let now = timestamp;
    let calls = 0;
    const first = new PlanningRecoveryService({
      database,
      memory: new FakePlannerMemoryPort(),
      source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD),
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryResult(input.plannerInput); } },
      hostRecoveryEnabled: true,
      now: () => now,
      fault: { hit: (point) => { if (point === "after-provider-result") throw new Error("synthetic-process-replacement"); } },
    });
    await expect(first.recover({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-durable-result" })).rejects.toThrow("synthetic-process-replacement");
    expect(calls).toBe(1);
    const stored = await database.transaction((tx) => tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-durable-result"));
    expect(stored).toMatchObject({ state: "PROVIDER_RETURNED", providerAttemptCount: 1, providerResultChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(database.transaction((tx) => tx.transitionPlanningRecoveryRun({ runId: stored!.runId, operationKey: "postgres-durable-result", from: "PROVIDER_RETURNED", to: "ADMISSION_STARTED", now: timestamp, patch: { expectedSourceHead: "c".repeat(40) } as never }))).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION_FAILED" });
    const stillBound = await database.transaction((tx) => tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-durable-result"));
    expect(stillBound?.expectedSourceHead).toBe(TEST_SOURCE_HEAD);
    now = "2026-08-30T12:16:00.000Z";
    const second = new PlanningRecoveryService({ database, memory: new FakePlannerMemoryPort(), provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } }, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => now });
    const result = await second.recover({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-durable-result" });
    expect(result.status).toBe("COMMITTED");
    expect(calls).toBe(1);
    const run = await database.transaction((tx) => tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-durable-result"));
    expect(run).toMatchObject({ state: "COMMITTED", providerAttemptCount: 1, projectMemoryStatus: "SYNCED" });
  });

  it("keeps PostgreSQL claim and provider-attempt start as separate durable operations", async () => {
    const value = await fixture(database);
    let calls = 0;
    const service = new PlanningRecoveryService({
      database,
      memory: new FakePlannerMemoryPort(),
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryResult(input.plannerInput); } },
      source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD),
      hostRecoveryEnabled: true,
      now: () => timestamp,
      fault: { hit: (point) => { if (point === "after-claim") throw new PlanningRecoveryCrash(point); } },
    });
    const prepared = await service.prepare({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-claim-start" });
    await expect(service.recover({ projectId: value.projectId, projectVersion: 1, operationKey: "postgres-claim-start" })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
    expect(calls).toBe(0);
    const claimed = await database.transaction((tx) => tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-claim-start"));
    expect(claimed).toMatchObject({ state: "CLAIMED", providerAttemptCount: 0, terminalOutcome: null, leaseOwner: expect.any(String), leaseExpiresAt: expect.any(String) });
    const startInput = { runId: claimed!.runId, operationKey: claimed!.operationKey, owner: claimed!.leaseOwner!, now: timestamp, leaseExpiresAt: claimed!.leaseExpiresAt!, expectedSourceHead: prepared.plan!.sourceHead, recoveryPlanChecksum: prepared.plan!.planChecksum, currentness: prepared.plan!.currentness };
    const started = await database.transaction((tx) => tx.startPlanningRecoveryProviderAttempt(startInput));
    expect(started.row).toMatchObject({ state: "PROVIDER_CALL_STARTED", providerAttemptCount: 1 });
    await expect(database.transaction((tx) => tx.startPlanningRecoveryProviderAttempt(startInput))).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
    const stillStarted = await database.transaction((tx) => tx.getPlanningRecoveryRun(value.projectId, 1, "postgres-claim-start"));
    expect(stillStarted).toMatchObject({ state: "PROVIDER_CALL_STARTED", providerAttemptCount: 1 });
    expect(calls).toBe(0);
  });
});

if (!databaseUrl) console.log("PLANNING RECOVERY POSTGRES: SKIPPED (DATABASE_URL unavailable)");
else console.log("PLANNING RECOVERY POSTGRES: ENABLED");
