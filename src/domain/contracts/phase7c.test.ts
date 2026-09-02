import { describe, expect, it } from "vitest";
import { mapDocumentToRow, mapRowToDocument } from "@/persistence/database/mapping";
import {
  Phase7CContractError,
  approveDatabaseDecision,
  approveDependencyProposal,
  approvePlanningAcceptance,
  buildDependencyProposal,
  buildPhase7CContractPackage,
  checksumDatabaseDecision,
  createDatabaseDecisionProposal,
  createPlanningAcceptance,
  createTaskContract,
  databaseConnectionStatus,
  validateDatabaseDecision,
  validatePhase7CContractPackage,
  validateStartImplementationGate,
  validateTaskContractBinding,
  type Phase7CContractPackage,
} from "./phase7c";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-12T10:00:00.000Z";
const checksum = "a".repeat(64);

const planning = {
  dataModel: { entities: [] },
  authentication: { required: false },
  storage: { decision: "not-required" },
  dependencies: { dependencies: [{ name: "zod", runtime: "runtime" as const, required: true, requirementReferences: ["brief:constraints"], purpose: "Runtime validation" }] },
};

function noneDecision() {
  return approveDatabaseDecision(createDatabaseDecisionProposal({ databaseDecisionId: "33333333-3333-4333-8333-333333333333", projectId, projectVersion: 1, createdAt: now, planningChecksum: checksum, recommendation: "NOT_REQUIRED", rationale: "No persisted data is approved.", authRequired: true, storageRequired: true }), { actorId: "user-1", approvedAt: now, mode: "NONE" });
}

function packageFixture(): Phase7CContractPackage {
  const pending = buildPhase7CContractPackage({ projectId, projectVersion: 1, createdAt: now, approvedBriefChecksum: checksum, planningChecksum: checksum, architectureChecksum: "b".repeat(64), designChecksum: "c".repeat(64), planning });
  const databaseDecision = approveDatabaseDecision(pending.databaseDecision, { actorId: "user-1", approvedAt: now, mode: "NONE" });
  const planningAcceptance = createPlanningAcceptance({ projectId, projectVersion: 1, planningChecksum: checksum, databaseDecision, dependencyProposal: pending.dependencyProposal, architectureChecksum: pending.architectureChecksum, designChecksum: pending.designChecksum, createdAt: now });
  const acceptance = approvePlanningAcceptance(planningAcceptance, { actorId: "user-1", approvedAt: now });
  const taskContract = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "prepare-workspace", allowedTools: ["filesystem-read"], fileScopes: ["src/**"], ownedArtifactTypes: ["workspace-reservation"], acceptanceCriteria: ["Workspace is reserved"], validationRequirements: ["deterministic validation"] });
  return validatePhase7CContractPackage({ ...pending, status: "APPROVED", databaseDecision, planningAcceptance: acceptance, taskContracts: [taskContract], architectureAccepted: true, contractAuditAccepted: true, designSelected: true });
}

describe("Phase 7C typed contracts", () => {
  it("keeps the planner recommendation separate from explicit user database approval", () => {
    const decision = createDatabaseDecisionProposal({ databaseDecisionId: "33333333-3333-4333-8333-333333333333", projectId, projectVersion: 1, createdAt: now, planningChecksum: checksum, recommendation: "REQUIRED", rationale: "The approved brief contains persistent data." });
    expect(decision.userDecision).toBe("PENDING");
    expect(() => validateStartImplementationGate({ contractPackage: packageFixture() })).not.toThrow();
  });

  it("requires checksum-bound user approval and rejects a stale material change", () => {
    const approved = noneDecision();
    expect(approved.approval.approvedChecksum).toBe(approved.checksum);
    expect(checksumDatabaseDecision(approved)).toBe(approved.checksum);
    expect(() => validateDatabaseDecision({ ...approved, reason: "changed after approval" })).toThrow(/stale/i);
  });

  it("models NONE without database credentials while keeping auth and storage independent", () => {
    const decision = noneDecision();
    expect(decision.mode).toBe("NONE");
    expect(decision.authRequired).toBe(true);
    expect(decision.storageRequired).toBe(true);
    expect(decision.connectionRequirements).toHaveLength(0);
    expect(databaseConnectionStatus([], "NONE")).toBe("NOT_REQUIRED");
  });

  it("distinguishes missing, partial, and ready existing Supabase connections", () => {
    const requirements = [
      { name: "NEXT_PUBLIC_SUPABASE_URL", purpose: "database URL", required: true, visibility: "PUBLIC" as const, requiredFor: ["DATABASE" as const], presence: "PRESENT" as const, connectionVerification: "NOT_RUN" as const, source: "test" },
      { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", purpose: "database key", required: true, visibility: "PUBLIC" as const, requiredFor: ["DATABASE" as const], presence: "MISSING" as const, connectionVerification: "NOT_RUN" as const, source: "test" },
    ];
    expect(databaseConnectionStatus(requirements, "SUPABASE_EXISTING")).toBe("PARTIAL");
    expect(databaseConnectionStatus(requirements.map((item) => ({ ...item, presence: "PRESENT" as const })), "SUPABASE_EXISTING")).toBe("READY");
    expect(databaseConnectionStatus(requirements.map((item) => ({ ...item, presence: "MISSING" as const })), "SUPABASE_EXISTING")).toBe("MISSING");
  });

  it("rejects database-persisted data when the approved mode is NONE", () => {
    const pending = buildPhase7CContractPackage({ projectId, projectVersion: 1, createdAt: now, approvedBriefChecksum: checksum, planningChecksum: checksum, architectureChecksum: "b".repeat(64), designChecksum: "c".repeat(64), planning: { ...planning, dataModel: { entities: [{ id: "entity-1", name: "requests", fields: [{ name: "message", type: "text", required: true, public: false }], requirementReferences: ["brief:backendRequirements"] }] } } });
    expect(() => validatePhase7CContractPackage({ ...pending, databaseDecision: noneDecision() })).toThrow(Phase7CContractError);
  });

  it("requires current TaskContract bindings and rejects capability or scope escalation", () => {
    const contract = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "prepare-workspace", allowedTools: ["filesystem-read"], fileScopes: ["src/**"], ownedArtifactTypes: ["workspace-reservation"], acceptanceCriteria: ["Workspace is reserved"], validationRequirements: ["deterministic validation"] });
    expect(() => validateTaskContractBinding({ id: taskId, projectId, projectVersion: 1, taskType: "prepare-workspace", allowedTools: ["filesystem-write"], allowedSkills: [], fileScopes: ["src/**"], expectedArtifactTypes: ["workspace-reservation"] }, contract)).toThrow(/escalation/i);
    expect(() => validateTaskContractBinding({ id: taskId, projectId, projectVersion: 1, taskType: "prepare-workspace", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["supabase/**"], expectedArtifactTypes: ["workspace-reservation"] }, contract)).toThrow(/escalation/i);
  });

  it("accepts a narrower task scope covered by a contract scope", () => {
    const contract = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "implement-shared-component", allowedTools: [], fileScopes: ["src/components/**"], ownedArtifactTypes: ["shared-component"], acceptanceCriteria: ["Component is implemented"], validationRequirements: ["deterministic validation"] });
    expect(() => validateTaskContractBinding({ id: taskId, projectId, projectVersion: 1, taskType: "implement-shared-component", allowedTools: [], allowedSkills: [], fileScopes: ["src/components/shared/hero/**"], expectedArtifactTypes: ["shared-component"] }, contract)).not.toThrow();
  });

  it("accepts a concrete repair file covered by a suffix wildcard contract scope", () => {
    const contract = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "implement-project-foundation", allowedTools: ["filesystem-read"], fileScopes: ["next.config.*", "src/app/layout.*"], ownedArtifactTypes: ["project-foundation"], acceptanceCriteria: ["The foundation is implemented"], validationRequirements: ["deterministic validation"] });
    expect(() => validateTaskContractBinding({ id: "repair-task", repairOfTaskId: taskId, projectId, projectVersion: 1, taskType: "repair-targeted-failure", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["next.config.mjs", "src/app/layout.tsx"], expectedArtifactTypes: ["project-foundation"] }, contract)).not.toThrow();
    expect(() => validateTaskContractBinding({ id: "repair-task", repairOfTaskId: taskId, projectId, projectVersion: 1, taskType: "repair-targeted-failure", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["next.config.mjs/subpath"], expectedArtifactTypes: ["project-foundation"] }, contract)).toThrow(/escalation/i);
  });

  it("binds a targeted repair to its original TaskContract without granting escalation", () => {
    const contract = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "prepare-workspace", allowedTools: ["filesystem-read"], fileScopes: ["src/**"], ownedArtifactTypes: ["workspace-reservation"], acceptanceCriteria: ["Workspace is reserved"], validationRequirements: ["deterministic validation"] });
    expect(() => validateTaskContractBinding({ id: "repair-task", repairOfTaskId: taskId, projectId, projectVersion: 1, taskType: "repair-targeted-failure", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["src/app/factory-prepared.ts"], expectedArtifactTypes: ["workspace-reservation"] }, contract)).not.toThrow();
    expect(() => validateTaskContractBinding({ id: "nested-repair-task", repairOfTaskId: "prior-repair-task", phase7cTaskContractId: contract.taskContractId, projectId, projectVersion: 1, taskType: "repair-targeted-failure", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["src/app/factory-prepared.ts"], expectedArtifactTypes: ["workspace-reservation"] }, contract)).not.toThrow();
    expect(() => validateTaskContractBinding({ id: "repair-task", repairOfTaskId: taskId, projectId, projectVersion: 1, taskType: "repair-targeted-failure", allowedTools: ["filesystem-read"], allowedSkills: [], fileScopes: ["supabase/**"], expectedArtifactTypes: ["workspace-reservation"] }, contract)).toThrow(/escalation/i);
  });

  it("requires database task bindings to use the current decision and blocks NONE", () => {
    const pkg = packageFixture();
    const databaseTask = createTaskContract({ taskId, projectId, projectVersion: 1, createdAt: now, taskType: "implement-database-schema", allowedTools: ["filesystem-write"], fileScopes: ["supabase/migrations/**"], ownedArtifactTypes: ["database-schema"], acceptanceCriteria: ["Only approved schema is represented"], validationRequirements: ["migration validation"], databaseDecisionRef: { id: pkg.databaseDecision.databaseDecisionId, checksum: pkg.databaseDecision.checksum } });
    const withDatabaseTask = { ...pkg, taskContracts: [databaseTask] };
    expect(() => validateStartImplementationGate({ contractPackage: withDatabaseTask, databaseTask: true })).toThrow(/NONE|database/i);
  });

  it("keeps optional dependency approval distinct from Foundation dependency authority", () => {
    const proposal = buildDependencyProposal({ dependencyProposalId: "44444444-4444-4444-8444-444444444444", projectId, projectVersion: 1, createdAt: now, planningChecksum: checksum, dependencies: [{ packageName: "zod", versionSpec: "^4.4.3", section: "dependencies", required: true, requirementReferences: ["brief:constraints"], rationale: "Runtime validation" }] });
    expect(proposal.dependencies[0]?.class).toBe("FOUNDATION_DEPENDENCY");
    expect(proposal.dependencies[0]?.approvalStatus).toBe("NOT_REQUIRED");
    expect(approveDependencyProposal(proposal, { actorId: "user-1", approvedAt: now }).checksum).toBe(proposal.checksum);
  });

  it("requires explicit planning acceptance and supports a stable persistence round trip", () => {
    const pkg = packageFixture();
    expect(pkg.planningAcceptance.status).toBe("APPROVED");
    const row = mapDocumentToRow(pkg);
    const roundTrip = mapRowToDocument(row);
    expect(roundTrip).toEqual(pkg);
    expect(() => mapRowToDocument({ ...row, payload: { ...pkg, reason: "tampered" } })).toThrow();
  });

  it("does not accept raw secret values in the contract package", () => {
    const pkg = packageFixture();
    expect(() => validatePhase7CContractPackage({ ...pkg, safeEnvironmentMetadata: [{ name: "DATABASE_URL", purpose: "database", required: true, visibility: "SERVER_SECRET", requiredFor: ["DATABASE"], presence: "PRESENT", connectionVerification: "NOT_RUN", source: "test", rawValue: "postgresql://secret" }] })).toThrow();
  });
});
