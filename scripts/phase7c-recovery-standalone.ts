import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { buildPlanningPackage, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "@/agents/planner/contracts";
import { buildImplementationTaskGraph } from "@/orchestration/orchestrator/graph";
import { DEFAULT_ORCHESTRATION_POLICY, type OrchestratorInput } from "@/orchestration/orchestrator/contracts";
import { rebindTaskContractsToPackage, approveDatabaseDecision, approveDependencyProposal, buildPhase7CContractPackage, createPlanningAcceptance } from "@/domain/contracts/phase7c";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { ArchitectureReviewRecordSchema, ArchitectureReviewResultSchema, ContractAuditRecordSchema, ContractAuditResultSchema } from "@/domain/review/schema";
import { CONTRACT_AUDIT_POLICY_VERSION } from "@/agents/reviewers/contracts/contracts";

const timestamp = "2026-09-27T12:00:00.000Z";
const id = () => randomUUID();
const root = path.resolve(process.cwd());

function isolatedDatabaseUrl() {
  const raw = process.env.PHASE7C_ISOLATED_DATABASE_URL;
  if (process.env.PHASE7C_CONFIRM_ISOLATED !== "true" || !raw) throw new Error("PHASE7C_ISOLATED_DATABASE_CONFIRMATION_REQUIRED");
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("PHASE7C_DATABASE_PROTOCOL_INVALID");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("PHASE7C_DATABASE_MUST_BE_LOOPBACK");
  return raw;
}

function brief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1, documentType: "requirements", projectId: id(), projectVersion: 1, createdAt: timestamp, updatedAt: timestamp,
    projectSummary: "Synthetic public information site.", protectedFunctionalityRequired: false, imagesRequired: false,
    businessGoals: ["Explain the synthetic service"], targetAudiences: ["Synthetic visitors"], pages: [{ slug: "home", purpose: "Explain the synthetic service" }, { slug: "impressum", purpose: "Synthetic legal information" }, { slug: "datenschutz", purpose: "Synthetic privacy information" }],
    userRoles: [], features: ["Direct phone and email contact actions"], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
    localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" },
    technicalConstraints: ["No contact form, database, authentication, or persistence."], explicitExclusions: [], userAcceptanceCriteria: ["Synthetic home page loads"], unresolvedItems: [],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user" }, briefStatus: "approved", briefVersion: 1,
    contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [],
    ...emptyBriefV2Fields(),
    formBehaviorRequirements: { ...emptyBriefV2Fields().formBehaviorRequirements, formPresent: false, validation: "NOT_REQUIRED", successUx: "NONE", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "NOT_APPLICABLE" },
  });
}

function planningFor(inputBrief: RequirementSpecification, canonicalBrief: ReturnType<typeof migrateLegacyBriefToCanonicalBriefV3>, briefChecksum: string): PlanningPackage {
  const input: PlannerAgentInput = { projectId: inputBrief.projectId, projectVersion: 1, approvedBrief: inputBrief, approvedBriefChecksum: briefChecksum, canonicalBrief, originalPromptReference: "synthetic-prompt", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: id(), expectedRowVersion: 1 };
  const built = buildPlanningPackage(input);
  const planning = PlanningPackageSchema.parse({
    ...built,
    traceability: [...built.traceability, { decisionId: id(), category: "synthetic-canonical-coverage", requirementReferences: canonicalBrief.requirements.map((entry) => entry.id), systemConstraintReferences: [], rationale: "Synthetic fixture binds all canonical requirements before the supported recovery route.", confidence: "high", userConfirmationRequired: false }],
  });
  return PlanningPackageSchema.parse({ ...planning, blockers: [], accepted: true, acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(planning) }, architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } } });
}

function architectureFor(inputBrief: RequirementSpecification, planning: PlanningPackage, briefChecksum: string) {
  const result = ArchitectureReviewResultSchema.parse({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["requirements", "planning-package"], policyVersion: "architecture-review-v1" });
  return ArchitectureReviewRecordSchema.parse({ schemaVersion: 1, documentType: "architecture-review", projectId: inputBrief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, reviewId: id(), reviewerAgentId: "architecture-reviewer", reviewerVersion: "synthetic", capability: "review.architecture", policyVersion: "architecture-review-v1", promptVersion: "architecture-reviewer.v2", reviewInputChecksum: "a".repeat(64), approvedBriefChecksum: briefChecksum, acceptedPlanningChecksum: checksumPersistedDocument(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), phase7cChecksum: "b".repeat(64), resultChecksum: checksumPersistedDocument(result), result });
}

async function seed(database: PostgresPersistenceDatabase) {
  const inputBrief = brief();
  const migrated = migrateLegacyBriefToCanonicalBriefV3(inputBrief);
  const canonicalBrief = { ...migrated, decisions: { ...migrated.decisions, routePolicy: { mode: "SINGLE_PAGE" as const } } };
  const canonical = createBriefV3Document({ projectId: inputBrief.projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
  const briefV3 = BriefV3DocumentSchema.parse({ ...canonical, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: canonical.briefChecksum } });
  const planning = planningFor(inputBrief, canonicalBrief, briefV3.briefChecksum);
  const selected = { schemaVersion: 1 as const, documentType: "selected-design" as const, projectId: inputBrief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, directionSetId: id(), selectedDirectionId: id(), selectedAt: timestamp, selectedBy: "synthetic-user", selectionNotes: "Synthetic explicit selection", selectedDirectionChecksum: "c".repeat(64) };
  const architectureReview = architectureFor(inputBrief, planning, briefV3.briefChecksum);
  const orchestratorInput: OrchestratorInput = { projectId: inputBrief.projectId, projectVersion: 1, approvedBrief: inputBrief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), selectedDesign: selected, selectedDesignChecksum: checksumPersistedDocument(selected), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "CONTRACT_AUDIT", existingDecisions: [], allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"], approvedSkillRegistrySnapshot: { schemaVersion: 1, checksum: "d".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: id(), expectedRowVersion: 1, workspaceReserved: true, projectImmutable: false, requiredExternalDecisionPending: false };
  const builtGraph = buildImplementationTaskGraph(orchestratorInput, DEFAULT_ORCHESTRATION_POLICY);
  const oldGraph = { ...builtGraph, tasks: builtGraph.tasks.map((task) => task.taskType === "write-unit-tests" ? { ...task, objective: `${task.objective} Synthetic legacy form criterion.` } : task) };
  const graphWithoutChecksum = { ...oldGraph };
  delete graphWithoutChecksum.graphChecksum;
  const taskGraph = { ...oldGraph, graphChecksum: checksumPersistedDocument(graphWithoutChecksum) };
  const phaseDraft = buildPhase7CContractPackage({ projectId: inputBrief.projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: briefV3.briefChecksum, planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: checksumPersistedDocument(selected), planning });
  const databaseDecision = approveDatabaseDecision(phaseDraft.databaseDecision, { actorId: "synthetic-user", approvedAt: timestamp, mode: "NONE" });
  const dependencyProposal = approveDependencyProposal(phaseDraft.dependencyProposal, { actorId: "synthetic-user", approvedAt: timestamp });
  const planningAcceptance = createPlanningAcceptance({ projectId: inputBrief.projectId, projectVersion: 1, planningChecksum: phaseDraft.planningChecksum, databaseDecision, dependencyProposal, architectureChecksum: phaseDraft.architectureChecksum, designChecksum: phaseDraft.designChecksum, createdAt: timestamp });
  const phase7c = rebindTaskContractsToPackage({ ...phaseDraft, databaseDecision, dependencyProposal, planningAcceptance, safeEnvironmentMetadata: databaseDecision.connectionRequirements }, taskGraph.tasks);
  const badResult = ContractAuditResultSchema.parse({ verdict: "CHANGES_REQUIRED", findings: [{ findingId: "legacy-form-template", severity: "ERROR", category: "FORM_CONTRACT_MISMATCH", summary: "Synthetic stale form criterion requires correction.", evidenceRefs: ["task-graph"], affectedArtifacts: ["task-graph"], recommendedAction: "Rebuild the current TaskGraph.", correctionTarget: "TASKGRAPH" }], reviewedArtifactRefs: ["task-graph"], policyVersion: CONTRACT_AUDIT_POLICY_VERSION });
  const badAudit = ContractAuditRecordSchema.parse({ schemaVersion: 1, documentType: "contract-audit", projectId: inputBrief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, auditId: id(), auditorAgentId: "contract-auditor", auditorVersion: "synthetic", capability: "review.contracts", policyVersion: CONTRACT_AUDIT_POLICY_VERSION, promptVersion: "contract-auditor.v3", briefChecksum: briefV3.briefChecksum, planningChecksum: checksumPersistedDocument(planning), architectureReviewId: architectureReview.reviewId, architectureReviewChecksum: checksumPersistedDocument(architectureReview), designChecksum: checksumPersistedDocument(selected), taskGraphChecksum: taskGraph.graphChecksum, resultChecksum: checksumPersistedDocument(badResult), result: badResult });
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: inputBrief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: inputBrief.projectId, slug: `synthetic-phase7c-${inputBrief.projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic Phase 7C recovery fixture.", currentVersion: 1, workflowState: "CONTRACT_AUDIT" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: id(), projectId: inputBrief.projectId, versionNumber: 1, state: "CONTRACT_AUDIT", memoryRootPath: null, requirementsChecksum: briefV3.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  for (const document of [inputBrief, briefV3, planning, planning.architecture, planning.content, planning.assets, architectureReview, selected, phase7c, taskGraph, badAudit]) await documents.save(document);
  return { projectId: inputBrief.projectId, oldGraphChecksum: taskGraph.graphChecksum };
}

function envWithPreload(databaseUrl: string): NodeJS.ProcessEnv {
  const preload = new URL("./phase7c-recovery-synthetic-provider.mjs", import.meta.url).href;
  const existing = process.env.NODE_OPTIONS?.trim() ?? "";
  return { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", OPENAI_API_KEY: "synthetic-local-only", OPENAI_MODEL: "synthetic-contract-audit-model", OPENAI_MAX_RETRIES: "0", OPENAI_MAX_CONCURRENT_REQUESTS: "1", GENERATED_PROJECTS_ROOT: path.join(process.env.TEMP ?? ".", "factory-phase7c-recovery-generated"), NODE_OPTIONS: `${existing} --import=${preload}`.trim() };
}

async function waitFor(url: string, server: ChildProcess) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("PHASE7C_STANDALONE_SERVER_EXITED");
    try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.status === 200) return; } catch { /* bounded readiness polling */ }
    await delay(250);
  }
  throw new Error("PHASE7C_STANDALONE_SERVER_TIMEOUT");
}

async function post(base: string, body: Record<string, unknown>) {
  const serialized = JSON.stringify(body);
  const response = await fetch(`${base}/api/workbench`, { method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(serialized, "utf8")) }, body: serialized });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main() {
  const databaseUrl = isolatedDatabaseUrl();
  const port = Number(process.env.PHASE7C_STANDALONE_PORT ?? "3326");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PHASE7C_STANDALONE_PORT_INVALID");
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);
  const fixture = await seed(database);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const server: ChildProcess = spawn(npmCommand, ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env: envWithPreload(databaseUrl), stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: process.platform === "win32" });
  let serverOutput = "";
  server.stdout?.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-4_000); });
  server.stderr?.on("data", (chunk: Buffer) => { serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-4_000); });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base, server);
    const initial = await post(base, { action: "status", projectId: fixture.projectId });
    if (initial.status !== 200) throw new Error(`PHASE7C_INITIAL_STATUS_FAILED:${initial.status}`);
    const correction = await post(base, { action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-correction-${fixture.projectId}` });
    if (correction.status !== 200) throw new Error(`PHASE7C_CORRECTION_FAILED:${correction.status}`);
    const correctedStatus = await post(base, { action: "status", projectId: fixture.projectId });
    const reassessment = await post(base, { action: "reassess-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-reassessment-${fixture.projectId}` });
    if (reassessment.status !== 200) throw new Error(`PHASE7C_REASSESSMENT_FAILED:${reassessment.status}`);
    const approval = await post(base, { action: "approve-phase7c", projectId: fixture.projectId, idempotencyKey: `synthetic-phase7c-approval-${fixture.projectId}` });
    if (approval.status !== 200) throw new Error(`PHASE7C_APPROVAL_FAILED:${approval.status}`);
    const finalStatus = await post(base, { action: "status", projectId: fixture.projectId });
    const current = await new ProjectRepository(database).getWithVersion(fixture.projectId);
    const documents = new DocumentRepository(database);
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    const audit = await documents.get(fixture.projectId, 1, "contract-audit");
    const history = await documents.get(fixture.projectId, 1, "contract-audit-history");
    const selectedDesign = await documents.get(fixture.projectId, 1, "selected-design");
    const directionSet = await documents.get(fixture.projectId, 1, "design-directions");
    const finalPendingAction = (finalStatus.body.data as { status?: { allowedActions?: string[] } } | undefined)?.status?.allowedActions?.[0] ?? null;
    if (finalPendingAction !== "START_IMPLEMENTATION") throw new Error(`PHASE7C_POSITIVE_PENDING_ACTION_INVALID:${finalPendingAction ?? "NONE"}`);
    if (!phase7c || phase7c.documentType !== "phase-7c-contract-package" || phase7c.status !== "APPROVED") throw new Error("PHASE7C_POSITIVE_PACKAGE_NOT_APPROVED");
    if (!audit || audit.documentType !== "contract-audit" || audit.result.verdict !== "APPROVED") throw new Error("PHASE7C_POSITIVE_AUDIT_NOT_APPROVED");
    if (!selectedDesign || selectedDesign.documentType !== "selected-design") throw new Error("PHASE7C_POSITIVE_SELECTED_DESIGN_MISSING");
    const reassessmentOperationId = (reassessment.body.meta as { operationId?: unknown } | undefined)?.operationId;
    const reassessmentOperation = typeof reassessmentOperationId === "string"
      ? await database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.reassess_contract_audit", key: reassessmentOperationId }))
      : undefined;
    console.log(JSON.stringify({
      status: "passed",
      fixture: { projectId: fixture.projectId, oldTaskGraphChecksum: fixture.oldGraphChecksum, syntheticOnly: true },
      http: { initial: initial.status, correction: correction.status, correctedStatus: correctedStatus.status, reassessment: reassessment.status, approval: approval.status, finalStatus: finalStatus.status },
      workflow: { projectRowVersion: current?.rowVersion, projectState: current?.project.workflowState, pendingAction: finalPendingAction, implementationEligibility: "START_IMPLEMENTATION is derived from the approved Phase 7C package, current approved Contract Audit, ready TaskGraph, and selected-design document." },
      provider: { calls: (reassessmentOperation?.result as { providerCallsTotal?: number } | null | undefined)?.providerCallsTotal ?? 0, transportIntercepted: true, externalAiCalls: 0 },
      operations: { reassessment: { operationId: reassessmentOperationId ?? null, status: reassessmentOperation?.status ?? null, result: reassessmentOperation?.result ?? null } },
      documents: {
        phase7cStatus: phase7c.status,
        phase7cBindings: { approvedBriefChecksum: phase7c.approvedBriefChecksum, planningChecksum: phase7c.planningChecksum, architectureChecksum: phase7c.architectureChecksum, designChecksum: phase7c.designChecksum },
        auditVerdict: audit.result.verdict,
        auditHistoryCount: history?.documentType === "contract-audit-history" ? history.records.length : null,
        selectedDesignPersisted: true,
        selectedDesignBinding: { directionSetId: selectedDesign.directionSetId, selectedDirectionId: selectedDesign.selectedDirectionId, selectedDirectionChecksum: selectedDesign.selectedDirectionChecksum, selectedDocumentChecksum: checksumPersistedDocument(selectedDesign) },
        directionSetPersisted: directionSet !== null,
        designAbsentMeaning: "The direction set is absent by design after explicit selection; Phase 7C and implementation readiness require the current selected-design document, not the pre-selection design-directions document.",
      },
      cleanup: "Discard the loopback-only isolated PostgreSQL database/container after the run; the runner never targets production and never sends real provider data.",
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "PHASE7C_RECOVERY_FAILED", serverOutput }));
    process.exitCode = 1;
  } finally {
    if (server.exitCode === null) server.kill();
    if (process.platform === "win32" && server.pid) {
      try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* the supported launcher may already have exited */ }
    }
    await Promise.race([pool.end(), delay(3000)]);
  }
}

void main().then(() => process.exit(process.exitCode ?? 0)).catch((error) => { console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "PHASE7C_RECOVERY_FAILED" })); process.exit(1); });
