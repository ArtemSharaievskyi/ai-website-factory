import { randomUUID } from "node:crypto";
import { createConfiguredPool } from "./db-common.mjs";
import { ClarificationRepository, DecisionRepository, DocumentRepository, ProjectRepository, ProjectVersionRepository, WorkflowPersistenceService, CostRepository } from "../src/persistence/repositories";
import { FactoryProjectSchema } from "../src/domain/project/schema";
import { RequirementSpecificationSchema } from "../src/domain/requirements/schema";
import { ClarificationSessionSchema } from "../src/domain/requirements/schema";
import { DomainError } from "../src/domain/shared/errors";

const runId = randomUUID();
const id = randomUUID();
const timestamp = new Date().toISOString();
const base = (documentType: string) => ({ schemaVersion: 1 as const, documentType, projectId: id, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp });
const project = FactoryProjectSchema.parse({ ...base("factory-project"), id, slug: `smoke-${runId.slice(0, 8)}`, originalPrompt: "Disposable persistence smoke test", currentVersion: 1, workflowState: "CLARIFYING" });
const requirements = RequirementSpecificationSchema.parse({ ...base("requirements"), projectSummary: "Smoke test", protectedFunctionalityRequired: false, imagesRequired: false, businessGoals: [], targetAudiences: [], pages: [], userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [], localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: [], unresolvedItems: [], approval: { approved: true, approvedAt: timestamp, approvedBy: "smoke-test", approvedRequirementsChecksum: "a".repeat(64) } });
const version = { id: randomUUID(), projectId: id, versionNumber: 1, state: "CLARIFYING" as const, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 };
const questionId = randomUUID();
const unresolved = ClarificationSessionSchema.parse({ ...base("clarification-log"), documentType: "clarification-log", questions: [{ id: questionId, category: "business" as const, question: "What is the business fact?", reason: "Smoke test", required: true, blocking: true, askedAt: timestamp, answerStatus: "unresolved" as const }], answers: [] });
const resolved = ClarificationSessionSchema.parse({ ...unresolved, updatedAt: new Date().toISOString(), questions: [{ ...unresolved.questions[0], answerStatus: "answered" as const }], answers: [{ questionId, status: "answered" as const, answer: "A confirmed fact", answeredAt: new Date().toISOString(), answeredBy: "smoke-test" }] });
const decision = { id: randomUUID(), timestamp, actorType: "system" as const, actorIdentifier: "smoke-test", category: "verification", decision: "Smoke test", rationale: "Verify persistence", affectedDocuments: ["requirements.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" as const };
const pool = createConfiguredPool();
let currentStep = "start";
async function main() {
try {
  currentStep = "adapter-import"; const db = new (await import("../src/persistence/postgres")).PostgresPersistenceDatabase(pool);
  const projects = new ProjectRepository(db); const versions = new ProjectVersionRepository(db); const documents = new DocumentRepository(db); const clarifications = new ClarificationRepository(db); const workflow = new WorkflowPersistenceService(db); const decisions = new DecisionRepository(db); const costs = new CostRepository(db);
  currentStep = "project-idempotency"; const created = await projects.create(project, `smoke-project-${runId}`); const retried = await projects.create(project, `smoke-project-${runId}`); const readProject = await projects.get(id); if (created.id !== retried.id || readProject?.id !== id) throw new Error("SMOKE_IDEMPOTENCY_RESULT_MISMATCH");
  currentStep = "version-idempotency"; await versions.create(version, `smoke-version-${runId}`); await versions.create(version, `smoke-version-${runId}`);
  currentStep = "document-round-trip"; await documents.save(requirements, `smoke-requirements-${runId}`); const readBack = await documents.get(id, 1, "requirements"); if (!readBack) throw new Error("SMOKE_DOCUMENT_READ_FAILED");
  currentStep = "blocking-clarification"; await clarifications.saveSession(unresolved, `smoke-clarification-${runId}`); try { await workflow.transition({ projectId: id, projectVersion: 1, expectedState: "CLARIFYING", expectedRowVersion: 1, targetState: "AWAITING_BRIEF_APPROVAL", actor: "smoke-test", reason: "Should be blocked", context: { clarificationSession: unresolved } }); throw new Error("SMOKE_BLOCKING_GUARD_FAILED"); } catch (error) { if (!(error instanceof DomainError) || error.code !== "BLOCKING_CLARIFICATIONS_REMAIN") throw error; }
  currentStep = "workflow-transition"; await clarifications.saveSession(resolved, `smoke-clarification-resolved-${runId}`); const transitioned = await workflow.transition({ projectId: id, projectVersion: 1, expectedState: "CLARIFYING", expectedRowVersion: 1, targetState: "AWAITING_BRIEF_APPROVAL", actor: "smoke-test", reason: "Clarification resolved", context: { clarificationSession: resolved, requirements } }); if (transitioned.project.workflowState !== "AWAITING_BRIEF_APPROVAL") throw new Error("SMOKE_TRANSITION_FAILED");
  currentStep = "stale-concurrency"; try { await workflow.transition({ projectId: id, projectVersion: 1, expectedState: "CLARIFYING", expectedRowVersion: 1, targetState: "AWAITING_BRIEF_APPROVAL", actor: "smoke-test", reason: "Stale" }); throw new Error("SMOKE_CONCURRENCY_GUARD_FAILED"); } catch (error) { if (!(error instanceof Error) || !((error as { code?: string }).code === "PERSISTENCE_CONFLICT")) throw error; }
  currentStep = "idempotency-conflict"; try { await projects.create({ ...project, slug: `other-${runId.slice(0, 8)}` }, `smoke-project-${runId}`); throw new Error("SMOKE_IDEMPOTENCY_CONFLICT_FAILED"); } catch (error) { if (!(error instanceof Error) || !((error as { code?: string }).code === "IDEMPOTENCY_CONFLICT")) throw error; }
  currentStep = "decision-and-cost"; await decisions.append(id, 1, decision); if ("update" in decisions || "delete" in decisions) throw new Error("SMOKE_DECISION_MUTATION_BOUNDARY_FAILED"); await costs.append({ id: randomUUID(), projectId: id, projectVersion: 1, role: "system", provider: "none", model: "none", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCost: 0, createdAt: timestamp });
  console.log("SMOKE_OK");
} finally {
  await pool.query("DELETE FROM decision_records WHERE project_id=$1", [id]); await pool.query("DELETE FROM workflow_events WHERE project_id=$1", [id]); await pool.query("DELETE FROM workflow_documents WHERE project_id=$1", [id]); await pool.query("DELETE FROM cost_records WHERE project_id=$1", [id]); await pool.query("DELETE FROM project_versions WHERE project_id=$1", [id]); await pool.query("DELETE FROM factory_projects WHERE id=$1", [id]); await pool.query("DELETE FROM idempotency_records WHERE idempotency_key LIKE $1", [`smoke-%-${runId}`]); await pool.end();
}
}

main().catch((error) => { console.error(`${error?.code ?? "SMOKE_FAILED"}:${currentStep}:${error?.cause?.code ?? "no-provider-code"}`); process.exitCode = 1; });
