import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRepairIncident, checksumRepairProposal, RepairIntentSchema, RepairProposalSchema, RepairTransactionSchema, SafeIdSchema, type FailureSnapshot, type RepairBaseline, type RepairIntent, type RepairProposal, type RepairVerificationResult } from "./contracts";
import { classifyRepairRisk, ContractGuardian, DeterministicAdversarialReviewer, TestMutationGuardian, compareProtectedProjectState, evaluateRepairOwnership } from "./guards";
import { ImpactMapper, impactEdge, impactNode, StaticImpactEvidenceSource } from "./impact";
import { FileRegressionLedgerStore, InMemoryRegressionLedgerStore, RegressionLedger } from "./ledger";
import { CallbackIntegrationAuthority, RepairProviderBudget, RepairSpecialistRouter, SafeRepairOrchestrator, StaticFailureDiagnostician, StaticRepairSpecialist, StaticRepairVerificationRunner, type RepairSpecialist, type RepairVerificationRunner } from "./orchestrator";

const projectId = "11111111-1111-4111-8111-111111111111";
const hash = (character: string) => character[0]!.repeat(64);
const timestamp = "2026-09-10T00:00:00.000Z";

function incident() {
  return createRepairIncident({ incidentId: "incident-architecture-503", source: "WORKBENCH", failureClass: "KNOWN_WORKFLOW_FAILURE", stage: "PREFLIGHT", boundary: "workbench-architecture-review", outerCode: "ARCHITECTURE_REVIEW_PROVIDER_FAILED", reasonCode: "ARCHITECTURE_REVIEW_PROVIDER_FAILED", safeFingerprint: "ArchitectureReviewError@PREFLIGHT:d5f6ad1e8d511dca", safeTokens: ["HTTP_503", "PROVIDER_RESPONSE_ABSENT"], affectedProject: { projectId, projectVersion: 1 }, observedAt: timestamp, evidenceRefs: ["src/runtime/workbench/application.ts"] });
}

function budget(overrides: Partial<RepairIntent["changeBudget"]> = {}): RepairIntent["changeBudget"] {
  return { maxFilesChanged: 3, maxLinesChanged: 500, allowedPaths: ["src/runtime/workbench/**"], forbiddenPaths: ["src/persistence/**", "supabase/migrations/**"], maxPublicContractChanges: 0, migrationAllowed: false, schemaChangeAllowed: false, lifecycleChangeAllowed: false, providerContractChangeAllowed: false, testModificationPolicy: "ADD_REGRESSION_ONLY", dependencyExpansionAllowed: false, ...overrides };
}

function intent(overrides: Partial<RepairIntent> = {}) {
  return RepairIntentSchema.parse({ incidentId: incident().incidentId, rootCauseClassification: "MISSING_WORKBENCH_ARCHITECTURE_ACTION", targetBehavior: [{ id: "provider-failure-recorded", description: "The provider failure is represented without retry.", kind: "TARGET" }], allowedScope: { allowedPaths: ["src/runtime/workbench/**"], forbiddenPaths: ["src/persistence/**"] }, forbiddenScope: { allowedPaths: ["src/persistence/**", "supabase/migrations/**"], forbiddenPaths: ["src/runtime/workbench/**"] }, mustPreserve: [{ id: "no-provider", description: "Source-only repair must use zero provider calls.", kind: "BOUNDARY" }], changeBudget: budget(), requiredVerification: [{ id: "target", tier: "L1_TARGET", reason: "Prove the target behavior.", mandatory: true }, { id: "impact", tier: "L2_IMPACT", reason: "Prove affected behavior remains healthy.", mandatory: true }, { id: "integration", tier: "L3_INTEGRATION", reason: "Prove integration safety.", mandatory: true }], risk: "MEDIUM", ...overrides });
}

function baseline(overrides: Partial<RepairBaseline> = {}): RepairBaseline {
  const targetFailure: FailureSnapshot = { identity: "target-failure", subsystem: "workbench", testRef: "repair.target", code: "TARGET_FAILURE", fingerprint: hash("a") };
  return { sourceHead: "head-a", contractFingerprints: { "workbench:action": hash("a") }, testFailureFingerprints: [targetFailure], buildStatus: { status: "PASS" }, lintStatus: { status: "PASS" }, typecheckStatus: { status: "PASS" }, protectedProjectFingerprints: [{ projectId, field: "workflowState", fingerprint: hash("stable") }], risk: "MEDIUM", capturedAt: timestamp, ...overrides };
}

function proposal(overrides: Partial<RepairProposal> = {}) {
  const base = { proposalId: "proposal-1", repairId: "repair-1", workspaceId: "repair-workspace:repair-1", sourceHead: "head-a", actualChangedFiles: ["src/runtime/workbench/application.ts"], changedLines: 20, targetProof: { mode: "EXACT_REPLAY" as const, before: "FAIL" as const, after: "PASS" as const, evidenceRef: "repair.target" }, targetPassed: true, impactChecksPassed: true, candidateFailures: [], candidateContracts: { "workbench:action": hash("a") }, candidateTests: [], protectedProjectFingerprints: [{ projectId, field: "workflowState", fingerprint: hash("stable") }], providerCalls: 0, verificationGates: { typecheck: { status: "PASS" as const }, lint: { status: "PASS" as const }, "affected-tests": { status: "PASS" as const }, "contract-checks": { status: "PASS" as const }, build: { status: "PASS" as const }, "runtime-smoke": { status: "PASS" as const }, "protected-state": { status: "PASS" as const }, "baseline-delta": { status: "PASS" as const } }, specialistId: "workbench-repair", canonicalWriteAttempted: false, suspiciousPatterns: [], createdAt: timestamp, ...overrides };
  return RepairProposalSchema.parse({ ...base, diffChecksum: checksumRepairProposal(base) });
}

function verified(value: RepairProposal = proposal()): RepairVerificationResult {
  return { actualChangedFiles: value.actualChangedFiles, changedLines: value.changedLines, diffChecksum: value.diffChecksum, targetProof: value.targetProof, targetPassed: value.targetPassed, impactChecksPassed: value.impactChecksPassed, candidateFailures: value.candidateFailures, candidateContracts: value.candidateContracts, candidateTests: value.candidateTests, protectedProjectFingerprints: value.protectedProjectFingerprints, providerCalls: value.providerCalls, canonicalWriteAttempted: value.canonicalWriteAttempted, suspiciousPatterns: value.suspiciousPatterns, verificationGates: value.verificationGates };
}

function evidence() {
  const file = impactNode({ nodeId: "file:src/runtime/workbench/application.ts", type: "FILE", label: "src/runtime/workbench/application.ts", path: "src/runtime/workbench/application.ts" });
  const boundary = impactNode({ nodeId: "runtime:workbench", type: "RUNTIME_BOUNDARY", label: "workbench-boundary" });
  const test = impactNode({ nodeId: "test:workbench", type: "TEST", label: "workbench regression" });
  return { nodes: [file, boundary, test], edges: [impactEdge({ edgeId: "edge:file-boundary", from: file.nodeId, to: boundary.nodeId, type: "CALLS" }), impactEdge({ edgeId: "edge-boundary-test", from: boundary.nodeId, to: test.nodeId, type: "TESTS" })] };
}

function orchestrator(candidate: RepairProposal, currentSourceHead: string | (() => string) = "head-a", onIntegrate: () => void = () => undefined, intentOverrides: Partial<RepairIntent> = {}, verificationRunner: RepairVerificationRunner = new StaticRepairVerificationRunner(), specialist: RepairSpecialist = new StaticRepairSpecialist(candidate)) {
  const repairIntent = intent({ changeBudget: budget({ allowedPaths: ["src/runtime/workbench/**", "src/orchestration/repair/**"], forbiddenPaths: ["src/persistence/**"], ...intentOverrides.changeBudget }), ...intentOverrides });
  return new SafeRepairOrchestrator({ diagnostician: new StaticFailureDiagnostician(repairIntent), impactMapper: new ImpactMapper({ sources: [new StaticImpactEvidenceSource("TYPESCRIPT_AST", evidence())] }), specialist, verificationRunner, currentSourceHead, integrationAuthority: new CallbackIntegrationAuthority(async ({ proposal: accepted }) => { onIntegrate(); return { sourceHead: "head-b", candidateChecksum: accepted.diffChecksum }; }) });
}

describe("Safe Repair foundation", () => {
  it("runs target proof through adversarial review and sole integration authority", async () => {
    let integrations = 0;
    const result = await orchestrator(proposal(), "head-a", () => { integrations += 1; }).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.status).toBe("INTEGRATED");
    expect(result.integrationDecision).toMatchObject({ decision: "ALLOW", reason: "REPAIR_READY" });
    expect(result.regressionDelta?.resolvedFailures).toHaveLength(1);
    expect(result.providerCalls).toBe(0);
    expect(integrations).toBe(1);
  });

  it("blocks a target fix that introduces a new impacted failure", async () => {
    const candidate = proposal({ candidateFailures: [{ identity: "new-regression", subsystem: "workbench", testRef: "repair.impacted", code: "NEW_FAILURE", fingerprint: hash("n") }] });
    const result = await orchestrator(candidate).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.proposal?.targetPassed).toBe(true);
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "NEW_FAILURE" });
    expect(result.status).toBe("REJECTED");
  });

  it("admits only host verification and ignores forged specialist evidence", async () => {
    const forged = proposal();
    const verificationRunner: RepairVerificationRunner = {
      async verify() {
        return { ...verified(forged), targetProof: { mode: "EXACT_REPLAY" as const, before: "FAIL" as const, after: "PASS" as const, evidenceRef: "host.target" }, targetPassed: false, impactChecksPassed: false, candidateFailures: [{ identity: "host-regression", subsystem: "workbench", testRef: "repair.host", code: "HOST_FAILURE", fingerprint: hash("h") }] };
      },
    };
    const result = await orchestrator(forged, "head-a", () => undefined, {}, verificationRunner).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.proposal?.targetPassed).toBe(true);
    expect(result.verification?.targetPassed).toBe(false);
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "TARGET_PROOF_FAILED" });
    expect(result.status).toBe("REJECTED");
  });

  it("uses host-measured scope instead of specialist-reported changed paths", async () => {
    const candidate = proposal();
    const verificationRunner: RepairVerificationRunner = { async verify() { return { ...verified(candidate), actualChangedFiles: ["src/persistence/database/repositories.ts"] }; } };
    const result = await orchestrator(candidate, "head-a", () => undefined, {}, verificationRunner).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.proposal?.actualChangedFiles).toEqual(["src/runtime/workbench/application.ts"]);
    expect(result.verification?.actualChangedFiles).toEqual(["src/persistence/database/repositories.ts"]);
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "REPAIR_SCOPE_EXCEEDED" });
    expect(result.status).toBe("REJECTED");
  });

  it("blocks unexpected public contract changes even when target proof passes", async () => {
    const candidate = proposal({ candidateContracts: { "workbench:action": hash("a"), "public:shared-contract": hash("b") } });
    const result = await orchestrator(candidate, "head-a", () => undefined, { changeBudget: budget({ allowedPaths: ["src/runtime/workbench/**"], maxPublicContractChanges: 1 }) }).run({ incident: incident(), baseline: baseline({}), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.contractDelta?.unexpectedCount).toBe(1);
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "CONTRACT_GUARD_BLOCKED" });
  });

  it("blocks a forbidden path or budget overflow", async () => {
    const candidate = proposal({ actualChangedFiles: ["src/persistence/database/repositories.ts"] });
    const result = await orchestrator(candidate).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "REPAIR_SCOPE_EXCEEDED" });
  });

  it("blocks test tampering instead of accepting weakened assertions", async () => {
    const candidate = proposal({ candidateTests: [{ path: "src/orchestration/repair/repair.test.ts", kind: "MODIFIED", removedAssertions: 1, changedExpectations: 1, addedSkips: 0, addedOnly: 0, timeoutIncreaseMs: 0, fixtureBypass: false }] });
    const result = await orchestrator(candidate).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.testMutation).toMatchObject({ passed: false });
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "TEST_MUTATION_POLICY_BLOCKED" });
  });

  it("blocks protected-state changes and records no canonical integration", async () => {
    const candidate = proposal({ protectedProjectFingerprints: [{ projectId, field: "workflowState", fingerprint: hash("changed") }] });
    const result = await orchestrator(candidate).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.protectedStateDelta).toMatchObject({ passed: false });
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "PROTECTED_STATE_DELTA_BLOCKED" });
  });

  it("fails closed when the source baseline becomes stale", async () => {
    const result = await orchestrator(proposal(), () => "head-b").run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.status).toBe("STALE");
    expect(result.integrationDecision).toMatchObject({ reason: "REPAIR_BASELINE_STALE" });
    expect(result.proposal).toBeUndefined();
  });

  it("classifies security repairs as high risk and expands the bounded impact depth", async () => {
    expect(classifyRepairRisk({ allowedPaths: ["supabase/migrations/20260910_rls.sql"], securitySensitive: true })).toBe("HIGH");
    const nodes = Array.from({ length: 6 }, (_, index) => impactNode({ nodeId: `node:${index}`, type: index === 0 ? "FILE" : "RUNTIME_BOUNDARY", label: index === 0 ? "src/security.ts" : `boundary-${index}`, ...(index === 0 ? { path: "src/security.ts" } : {}) }));
    const edges = nodes.slice(1).map((node, index) => impactEdge({ edgeId: `chain:${index}`, from: nodes[index]!.nodeId, to: node.nodeId, type: "DEPENDS_ON" }));
    const mapper = new ImpactMapper({ sources: [new StaticImpactEvidenceSource("HOST", { nodes, edges })], maxDepth: 4 });
    const graph = await mapper.map({ sourceHead: "head-a", changedFiles: ["src/security.ts"], risk: "HIGH" });
    expect(graph.maxDepth).toBe(6);
    expect(graph.transitiveNodeIds).toContain("node:5");
  });

  it("admits the impact result into a RepairTransaction with a bounded SafeId cache key", async () => {
    const value = orchestrator(proposal());
    let transaction = await value.captureIncident({ incident: incident(), repairId: "repair-1", risk: "HIGH" });
    transaction = RepairTransactionSchema.parse({ ...transaction, baseline: baseline() });
    transaction = await value.diagnose(transaction);
    transaction = await value.analyzeImpact(transaction, { changedFiles: ["src/runtime\\workbench\\application.ts", "src/runtime/workbench/application.ts"] });
    const cacheKey = transaction.performance?.cacheKey;
    expect(cacheKey).toBeDefined();
    expect(SafeIdSchema.parse(cacheKey)).toBe(cacheKey);
    expect(cacheKey).toMatch(/^impact-v1-[a-f0-9]{64}$/);
    expect(cacheKey).toHaveLength(74);
    expect(cacheKey).not.toContain("application.ts");
  });

  it("normalizes unordered seeds and path separators without changing cache identity", async () => {
    const nodes = [
      impactNode({ nodeId: "file:one", type: "FILE", label: "src/one.ts", path: "src/one.ts" }),
      impactNode({ nodeId: "file:two", type: "FILE", label: "src/two.ts", path: "src/two.ts" }),
    ];
    const source = () => new StaticImpactEvidenceSource("HOST", { nodes, edges: [] });
    const first = await new ImpactMapper({ sources: [source()] }).map({ sourceHead: "head-a", changedFiles: ["src/one.ts", "src/two.ts"] });
    const second = await new ImpactMapper({ sources: [source()] }).map({ sourceHead: "head-a", changedFiles: ["src\\two.ts", "src\\one.ts", "src/one.ts"] });
    const firstMeasurement = new ImpactMapper({ sources: [source()] });
    await firstMeasurement.map({ sourceHead: "head-a", changedFiles: ["src/one.ts", "src/two.ts"] });
    const secondMeasurement = new ImpactMapper({ sources: [source()] });
    await secondMeasurement.map({ sourceHead: "head-a", changedFiles: ["src\\two.ts", "src\\one.ts", "src/one.ts"] });
    expect(first.changedFiles).toEqual(["src/one.ts", "src/two.ts"]);
    expect(second.changedFiles).toEqual(first.changedFiles);
    expect(firstMeasurement.lastMeasurement?.cacheKey).toBe(secondMeasurement.lastMeasurement?.cacheKey);
  });

  it("changes cache identity when authoritative impact inputs change", async () => {
    const source = new StaticImpactEvidenceSource("HOST", evidence());
    const map = async (overrides: Partial<{ sourceHead: string; risk: "LOW" | "MEDIUM" | "HIGH" }>) => {
      const mapper = new ImpactMapper({ sources: [source], maxDepth: 4 });
      await mapper.map({ sourceHead: overrides.sourceHead ?? "head-a", changedFiles: ["src/runtime/workbench/application.ts"], risk: overrides.risk });
      return mapper.lastMeasurement?.cacheKey;
    };
    const baselineKey = await map({});
    expect(await map({ sourceHead: "head-b" })).not.toBe(baselineKey);
    expect(await map({ risk: "HIGH" })).not.toBe(baselineKey);
    const deeper = new ImpactMapper({ sources: [source], maxDepth: 5 });
    await deeper.map({ sourceHead: "head-a", changedFiles: ["src/runtime/workbench/application.ts"] });
    expect(deeper.lastMeasurement?.cacheKey).not.toBe(baselineKey);
    expect(baselineKey).toMatch(/^impact-v1-[a-f0-9]{64}$/);
  });

  it("invalidates cache identity when graph authority changes and keeps large seed material bounded", async () => {
    const base = evidence();
    const changedAuthority = { nodes: [...base.nodes, impactNode({ nodeId: "file:authority", type: "FILE", label: "src/authority.ts", path: "src/authority.ts" })], edges: base.edges };
    const originalMapper = new ImpactMapper({ sources: [new StaticImpactEvidenceSource("HOST", base)] });
    const changedMapper = new ImpactMapper({ sources: [new StaticImpactEvidenceSource("HOST", changedAuthority)] });
    await originalMapper.map({ sourceHead: "head-a", changedFiles: ["src/runtime/workbench/application.ts"] });
    await changedMapper.map({ sourceHead: "head-a", changedFiles: ["src/runtime/workbench/application.ts"] });
    expect(changedMapper.lastMeasurement?.cacheKey).not.toBe(originalMapper.lastMeasurement?.cacheKey);

    const largeSeeds = ["src/runtime/workbench/application.ts", ...Array.from({ length: 100 }, (_, index) => `src/unrelated/${index}.ts`)];
    const boundedMapper = new ImpactMapper({ sources: [new StaticImpactEvidenceSource("HOST", base)] });
    await boundedMapper.map({ sourceHead: "head-a", changedFiles: largeSeeds });
    const cacheKey = boundedMapper.lastMeasurement?.cacheKey;
    expect(cacheKey).toMatch(/^impact-v1-[a-f0-9]{64}$/);
    expect(cacheKey).toHaveLength(74);
    expect(cacheKey).not.toContain("src/unrelated");
  });

  it("closes an environmental incident without inventing a source candidate", async () => {
    const value = orchestrator(proposal());
    let transaction = await value.captureIncident({ incident: incident(), repairId: "repair-1", risk: "HIGH" });
    transaction = RepairTransactionSchema.parse({ ...transaction, baseline: baseline() });
    transaction = await value.diagnose(transaction);
    transaction = await value.analyzeImpact(transaction, { changedFiles: ["src/runtime/workbench/application.ts"] });
    transaction = await value.completeWithoutSourceRepair(transaction);
    expect(transaction.status).toBe("NO_SOURCE_REPAIR_REQUIRED");
    expect(transaction.proposal).toBeUndefined();
    expect(transaction.providerCalls).toBe(0);
  });

  it("discovers ledger regressions from the impacted subsystem without specialist hints", async () => {
    const ledger = new RegressionLedger(new InMemoryRegressionLedgerStore());
    await ledger.register({ regressionId: "REG_WORKBENCH_ARCH", safeFingerprint: "ArchitectureReviewError@PREFLIGHT:d5f6ad1e8d511dca", subsystem: "workbench-boundary", rootCauseClass: "provider-failure-envelope", protectingInvariant: "safe-failure-envelope", regressionTestRefs: ["src/runtime/workbench/architecture-review-boundary.test.ts"], affectedContracts: [], affectedRuntimeBoundaries: ["workbench-boundary"], status: "ACTIVE" });
    const graph = await new ImpactMapper({ ledger, sources: [new StaticImpactEvidenceSource("WORKBENCH_REGISTRY", evidence())] }).map({ sourceHead: "head-a", changedFiles: ["src/runtime/workbench/application.ts"] });
    expect(graph.mandatoryRegressionIds).toEqual(["REG_WORKBENCH_ARCH"]);
    expect(graph.nodes.some((node) => node.type === "REGRESSION")).toBe(true);
  });

  it("classifies contract, test, protected, adversarial, and status rules deterministically", () => {
    const contract = new ContractGuardian().compare({ before: { "local:one": hash("a") }, after: { "local:one": hash("b"), "shared:two": hash("c") }, expectedContracts: ["local:one"] });
    expect(contract).toMatchObject({ expectedCount: 1, unexpectedCount: 1, passed: false });
    const mutation = new TestMutationGuardian().evaluate({ policy: "ADD_REGRESSION_ONLY", mutations: [{ path: "src/example.test.ts", kind: "MODIFIED", removedAssertions: 0, changedExpectations: 0, addedSkips: 0, addedOnly: 0, timeoutIncreaseMs: 0, fixtureBypass: false }] });
    expect(mutation.passed).toBe(false);
    expect(compareProtectedProjectState([{ projectId, field: "workflowState", fingerprint: hash("a") }], [{ projectId, field: "workflowState", fingerprint: hash("b") }]).passed).toBe(false);
    const reviewCandidate = proposal({ suspiciousPatterns: ["RLS_OWNER_ISOLATION_WEAKENED"] });
    const review = new DeterministicAdversarialReviewer().review({ proposal: reviewCandidate, verification: verified(reviewCandidate), impact: { graphId: "graph", sourceHead: "head-a", changedFiles: ["src/runtime/workbench/application.ts"], nodes: [], edges: [], directNodeIds: [], transitiveNodeIds: [], mandatoryRegressionIds: [], maxDepth: 1, bounded: true, nodeCount: 0, edgeCount: 0, checksum: hash("g") }, contractDelta: { entries: [], unexpectedCount: 0, authorizedCount: 0, expectedCount: 0, passed: true }, regressionDelta: { entries: [], baselineFailures: [], resolvedFailures: [], unchangedFailures: [], newFailures: [], changedFailures: [], passed: true }, testMutation: { changedExistingTests: [], addedTests: [], suspicious: [], passed: true }, protectedStateDelta: { differences: [], passed: true } });
    expect(review.decision).toBe("BLOCK");
  });

  it("permits an explicitly authorized contract migration but blocks provider transport", () => {
    const mutation = new TestMutationGuardian().evaluate({ policy: "AUTHORIZED_CONTRACT_MIGRATION", contractChangeIntent: { contract: "shared:contract", oldBehavior: "old", intendedBehavior: "new", consumers: ["consumer"], compatibilityStrategy: "typed handoff" }, mutations: [{ path: "src/runtime/workbench/repair.test.ts", kind: "MODIFIED", removedAssertions: 0, changedExpectations: 1, addedSkips: 0, addedOnly: 0, timeoutIncreaseMs: 0, fixtureBypass: false }] });
    expect(mutation.passed).toBe(true);
    const providerBudget = new RepairProviderBudget();
    expect(() => providerBudget.request()).toThrowError(expect.objectContaining({ code: "REPAIR_PROVIDER_BUDGET_EXCEEDED" }));
    expect(providerBudget.calls).toBe(1);
  });

  it("fails closed when a specialist swallows the provider-budget exception", async () => {
    const candidate = proposal();
    const specialist: RepairSpecialist = {
      specialistId: "workbench-repair",
      async propose(input) {
        try { input.providerGuard.request(); } catch { /* The host must still observe the attempted transport. */ }
        return candidate;
      },
    };
    await expect(orchestrator(candidate, "head-a", () => undefined, {}, new StaticRepairVerificationRunner(), specialist).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" })).rejects.toMatchObject({ code: "REPAIR_PROVIDER_BUDGET_EXCEEDED" });
  });

  it("blocks a high-risk security repair when adversarial evidence weakens owner isolation", async () => {
    const candidate = proposal({ suspiciousPatterns: ["RLS_OWNER_ISOLATION_WEAKENED"] });
    const result = await orchestrator(candidate, "head-a", () => undefined, { risk: "HIGH" }).run({ incident: incident(), baseline: baseline(), changedFiles: ["src/runtime/workbench/application.ts"], repairId: "repair-1" });
    expect(result.risk).toBe("HIGH");
    expect(result.integrationDecision).toMatchObject({ decision: "BLOCK", reason: "ADVERSARIAL_REVIEW_BLOCKED" });
    expect(result.status).toBe("REJECTED");
  });

  it("enforces specialist ownership and persists bounded regression evidence", async () => {
    expect(new RepairSpecialistRouter([{ subsystem: "workbench", specialistId: "workbench-repair", allowedPaths: ["src/runtime/workbench/**"] }]).resolve({ subsystem: "workbench", changedFiles: ["src/runtime/workbench/application.ts"] }).specialistId).toBe("workbench-repair");
    expect(evaluateRepairOwnership({ changedFiles: ["src/runtime/workbench/application.ts"], specialistId: "backend-repair", rules: [{ pathPattern: "src/runtime/workbench/**", ownerId: "workbench-repair" }] }).passed).toBe(false);
    expect(evaluateRepairOwnership({ changedFiles: ["src/runtime/workbench/application.ts"], specialistId: "backend-repair", handoff: { ownerId: "workbench-repair", approved: true }, rules: [{ pathPattern: "src/runtime/workbench/**", ownerId: "workbench-repair" }] }).passed).toBe(true);
    const root = await mkdtemp(path.join(os.tmpdir(), "safe-repair-ledger-"));
    try {
      const entry = { regressionId: "REG_PERSISTED", safeFingerprint: "stable-fingerprint", subsystem: "workbench-boundary", rootCauseClass: "workflow", protectingInvariant: "bounded-failure", regressionTestRefs: ["repair.test"], affectedContracts: [], affectedRuntimeBoundaries: ["workbench-boundary"], status: "ACTIVE" as const };
      const ledger = new RegressionLedger(new FileRegressionLedgerStore(path.join(root, "regression-ledger.json")));
      await ledger.register(entry);
      expect((await ledger.list()).map((item) => item.regressionId)).toEqual(["REG_PERSISTED"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
