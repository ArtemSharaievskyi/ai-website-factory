import { RepairIntentSchema, RepairProposalSchema, RepairTransactionSchema, RepairVerificationResultSchema, type ChangeImpactGraph, type RepairBaseline, type RepairIncident, type RepairIntent, type RepairProposal, type RepairTransaction, type RepairVerificationResult } from "./contracts";
import { DeterministicAdversarialReviewer, ContractGuardian, evaluateIntegration, RegressionGuardian, TestMutationGuardian, compareProtectedProjectState, classifyRepairRisk, evaluateRepairOwnership, matchesRepairPath, type RepairOwnershipRule } from "./guards";
import { ImpactMapper } from "./impact";
import { SafeRepairError } from "./errors";
import { InMemoryRepairWorkspace, type RepairWorkspacePort } from "./workspace";

const transitionTable: Record<RepairTransaction["status"], readonly RepairTransaction["status"][]> = {
  INCIDENT_CAPTURED: ["DIAGNOSING", "REJECTED"],
  DIAGNOSING: ["IMPACT_ANALYZED", "REJECTED"],
  IMPACT_ANALYZED: ["READY_FOR_REPAIR", "NO_SOURCE_REPAIR_REQUIRED", "REJECTED", "STALE"],
  READY_FOR_REPAIR: ["REPAIRING", "REJECTED", "STALE"],
  REPAIRING: ["VERIFYING", "REJECTED", "STALE"],
  VERIFYING: ["READY_FOR_INTEGRATION", "REVIEW_BLOCKED", "REJECTED", "STALE"],
  REVIEW_BLOCKED: ["REJECTED", "STALE"],
  READY_FOR_INTEGRATION: ["INTEGRATED", "REJECTED", "STALE"],
  INTEGRATED: [],
  NO_SOURCE_REPAIR_REQUIRED: [],
  REJECTED: [],
  STALE: [],
};

export interface FailureDiagnostician {
  diagnose(input: { incident: RepairIncident }): Promise<RepairIntent>;
}

export class StaticFailureDiagnostician implements FailureDiagnostician {
  constructor(private readonly intent: RepairIntent) {}
  async diagnose(input: { incident: RepairIncident }) {
    if (this.intent.incidentId !== input.incident.incidentId) throw new SafeRepairError("REPAIR_INCIDENT_MISMATCH", "Repair intent does not belong to the incident.");
    return RepairIntentSchema.parse(this.intent);
  }
}

export type RepairSpecialistInput = { incident: RepairIncident; intent: RepairIntent; baseline: RepairBaseline; impact: ChangeImpactGraph; workspace: NonNullable<RepairTransaction["workspace"]>; providerBudget: 0; providerGuard: RepairProviderBudget };

export interface RepairSpecialist {
  readonly specialistId: string;
  propose(input: RepairSpecialistInput): Promise<RepairProposal>;
}

export interface RepairVerificationRunner {
  verify(input: { incident: RepairIncident; intent: RepairIntent; baseline: RepairBaseline; impact: ChangeImpactGraph; workspace: NonNullable<RepairTransaction["workspace"]>; proposal: RepairProposal }): Promise<RepairVerificationResult>;
}

/** Synthetic adapter only; production wiring must execute host-owned checks. */
export class StaticRepairVerificationRunner implements RepairVerificationRunner {
  async verify(input: { proposal: RepairProposal }) {
    return RepairVerificationResultSchema.parse({ actualChangedFiles: input.proposal.actualChangedFiles, changedLines: input.proposal.changedLines, diffChecksum: input.proposal.diffChecksum, targetProof: input.proposal.targetProof, targetPassed: input.proposal.targetPassed, impactChecksPassed: input.proposal.impactChecksPassed, candidateFailures: input.proposal.candidateFailures, candidateContracts: input.proposal.candidateContracts, candidateTests: input.proposal.candidateTests, protectedProjectFingerprints: input.proposal.protectedProjectFingerprints, providerCalls: input.proposal.providerCalls, canonicalWriteAttempted: input.proposal.canonicalWriteAttempted, suspiciousPatterns: input.proposal.suspiciousPatterns, verificationGates: input.proposal.verificationGates });
  }
}

export type RepairSpecialistRoute = { subsystem: string; specialistId: string; allowedPaths: readonly string[] };

export class RepairSpecialistRouter {
  constructor(private readonly routes: readonly RepairSpecialistRoute[]) {}

  resolve(input: { subsystem: string; changedFiles: readonly string[] }) {
    const candidates = this.routes.filter((route) => route.subsystem === input.subsystem);
    if (!candidates.length) throw new SafeRepairError("REPAIR_SPECIALIST_UNRESOLVED", "No approved repair specialist owns this subsystem.");
    const owners = new Set<string>();
    for (const file of input.changedFiles) {
      const matching = candidates.filter((route) => route.allowedPaths.some((pattern) => matchesRepairPath(pattern, file)));
      if (!matching.length) throw new SafeRepairError("REPAIR_SPECIALIST_SCOPE_OVERLAP", `No specialist route owns ${file}.`);
      for (const route of matching) owners.add(route.specialistId);
    }
    if (owners.size > 1) throw new SafeRepairError("REPAIR_SPECIALIST_SCOPE_OVERLAP", "Overlapping repair specialist ownership requires IntegrationAuthority resolution.");
    return candidates.find((route) => owners.has(route.specialistId))!;
  }
}

export class StaticRepairSpecialist implements RepairSpecialist {
  readonly specialistId = "workbench-repair";
  constructor(private readonly proposal: RepairProposal) {}
  async propose(input: RepairSpecialistInput) {
    if (this.proposal.repairId !== input.workspace.repairId || this.proposal.workspaceId !== input.workspace.workspaceId) throw new SafeRepairError("REPAIR_WORKSPACE_BINDING_INVALID", "Repair proposal is not bound to the isolated workspace.");
    return RepairProposalSchema.parse(this.proposal);
  }
}

export interface IntegrationAuthority {
  integrate(input: { transaction: RepairTransaction; proposal: RepairProposal; baseline: RepairBaseline }): Promise<{ sourceHead: string; candidateChecksum: string }>;
}

export class CallbackIntegrationAuthority implements IntegrationAuthority {
  constructor(private readonly writer: (input: { transaction: RepairTransaction; proposal: RepairProposal; baseline: RepairBaseline }) => Promise<{ sourceHead: string; candidateChecksum: string }>) {}
  integrate(input: { transaction: RepairTransaction; proposal: RepairProposal; baseline: RepairBaseline }) { return this.writer(input); }
}

export type RepairOrchestratorDependencies = {
  diagnostician: FailureDiagnostician;
  impactMapper: ImpactMapper;
  workspace?: RepairWorkspacePort;
  specialist: RepairSpecialist;
  verificationRunner: RepairVerificationRunner;
  contractGuardian?: ContractGuardian;
  regressionGuardian?: RegressionGuardian;
  testMutationGuardian?: TestMutationGuardian;
  adversarialReviewer?: DeterministicAdversarialReviewer;
  integrationAuthority: IntegrationAuthority;
  currentSourceHead: string | (() => string | Promise<string>);
  expectedContractIds?: readonly string[];
  ownershipRules?: readonly RepairOwnershipRule[];
};

const riskRank = (risk: RepairTransaction["risk"]) => risk === "HIGH" ? 3 : risk === "MEDIUM" ? 2 : 1;
const currentTime = () => new Date().toISOString();

export function transitionRepairStatus(transaction: RepairTransaction, status: RepairTransaction["status"]): RepairTransaction {
  if (!transitionTable[transaction.status].includes(status)) throw new SafeRepairError("REPAIR_INVALID_STATUS_TRANSITION", `Cannot transition repair from ${transaction.status} to ${status}.`);
  return RepairTransactionSchema.parse({ ...transaction, status, updatedAt: currentTime() });
}

export class SafeRepairOrchestrator {
  private readonly workspace: RepairWorkspacePort;
  private readonly contractGuardian: ContractGuardian;
  private readonly regressionGuardian: RegressionGuardian;
  private readonly testMutationGuardian: TestMutationGuardian;
  private readonly adversarialReviewer: DeterministicAdversarialReviewer;

  constructor(private readonly dependencies: RepairOrchestratorDependencies) {
    this.workspace = dependencies.workspace ?? new InMemoryRepairWorkspace();
    this.contractGuardian = dependencies.contractGuardian ?? new ContractGuardian();
    this.regressionGuardian = dependencies.regressionGuardian ?? new RegressionGuardian();
    this.testMutationGuardian = dependencies.testMutationGuardian ?? new TestMutationGuardian();
    this.adversarialReviewer = dependencies.adversarialReviewer ?? new DeterministicAdversarialReviewer();
  }

  async captureIncident(input: { incident: RepairIncident; repairId?: string; risk?: RepairTransaction["risk"] }) {
    const { createRepairTransaction } = await import("./contracts");
    return createRepairTransaction(input.incident, { repairId: input.repairId, risk: input.risk, providerBudget: 0 });
  }

  async diagnose(transaction: RepairTransaction) {
    this.assertStatus(transaction, "INCIDENT_CAPTURED");
    const intent = RepairIntentSchema.parse(await this.dependencies.diagnostician.diagnose({ incident: transaction.incident }));
    if (intent.incidentId !== transaction.incident.incidentId) throw new SafeRepairError("REPAIR_INCIDENT_MISMATCH", "Diagnostician returned an intent for another incident.");
    const requiredRisk = classifyRepairRisk({ allowedPaths: intent.allowedScope.allowedPaths, contractChange: Boolean(intent.contractChangeIntent), securitySensitive: /auth|rls|security|ownership/i.test(`${transaction.incident.boundary} ${transaction.incident.failureClass}`) });
    const effectiveRisk = riskRank(requiredRisk) > riskRank(intent.risk) ? requiredRisk : intent.risk;
    const normalizedIntent = RepairIntentSchema.parse({ ...intent, risk: effectiveRisk });
    return this.update(transaction, { intent: normalizedIntent, risk: effectiveRisk, status: "DIAGNOSING" });
  }

  async analyzeImpact(transaction: RepairTransaction, input: { changedFiles: readonly string[] }) {
    this.assertStatus(transaction, "DIAGNOSING");
    const baseline = transaction.baseline;
    if (!baseline) throw new SafeRepairError("REPAIR_BASELINE_REQUIRED", "A frozen baseline is required before impact analysis.");
    const currentSourceHead = await this.readCurrentSourceHead();
    if (currentSourceHead !== baseline.sourceHead) return this.update(transaction, { integrationDecision: { decision: "BLOCK", reason: "REPAIR_BASELINE_STALE", reasons: ["Canonical source HEAD changed after baseline capture."], decidedAt: currentTime() }, status: "STALE" });
    const impact = await this.dependencies.impactMapper.map({ sourceHead: baseline.sourceHead, changedFiles: input.changedFiles, risk: transaction.risk });
    return this.update(transaction, { impact, performance: this.dependencies.impactMapper.lastMeasurement, status: "IMPACT_ANALYZED" });
  }

  async completeWithoutSourceRepair(transaction: RepairTransaction) {
    this.assertStatus(transaction, "IMPACT_ANALYZED");
    if (transaction.providerBudget !== 0 || transaction.providerCalls !== 0) throw new SafeRepairError("REPAIR_PROVIDER_BUDGET_EXCEEDED", "A no-source-repair outcome requires zero provider calls.");
    if (transaction.proposal || transaction.workspace || transaction.verification || transaction.integrationDecision) throw new SafeRepairError("REPAIR_SOURCE_CANDIDATE_UNEXPECTED", "A no-source-repair outcome cannot contain a source candidate or integration decision.");
    return this.update(transaction, { status: "NO_SOURCE_REPAIR_REQUIRED" });
  }

  async openRepairWorkspace(transaction: RepairTransaction, input: { project?: RepairWorkspaceOpenInputProject; projectVersion?: number; operationId?: string } = {}) {
    this.assertStatus(transaction, "IMPACT_ANALYZED");
    if (!transaction.intent || !transaction.baseline || !transaction.impact) throw new SafeRepairError("REPAIR_INTENT_REQUIRED", "Incident, intent, baseline, and impact are required before opening a repair workspace.");
    const workspace = await this.workspace.open({ repairId: transaction.repairId, sourceHead: transaction.baseline.sourceHead, ...(input.project ? { project: input.project } : {}), ...(input.projectVersion ? { projectVersion: input.projectVersion } : {}), ...(input.operationId ? { operationId: input.operationId } : {}) });
    if (workspace.sourceHead !== transaction.baseline.sourceHead || workspace.repairId !== transaction.repairId) throw new SafeRepairError("REPAIR_WORKSPACE_BINDING_INVALID", "Repair workspace identity does not match the frozen repair baseline.");
    return this.update(transaction, { workspace, status: "READY_FOR_REPAIR" });
  }

  async submitCandidate(transaction: RepairTransaction) {
    this.assertStatus(transaction, "READY_FOR_REPAIR");
    if (!transaction.intent || !transaction.baseline || !transaction.impact || !transaction.workspace) throw new SafeRepairError("REPAIR_INTENT_REQUIRED", "Repair context is incomplete.");
    let repairing = this.update(transaction, { status: "REPAIRING" });
    const providerBudget = new RepairProviderBudget();
    const rawProposal = await this.dependencies.specialist.propose({ incident: repairing.incident, intent: transaction.intent, baseline: transaction.baseline, impact: transaction.impact, workspace: transaction.workspace, providerBudget: 0, providerGuard: providerBudget });
    if (providerBudget.calls > 0) throw new SafeRepairError("REPAIR_PROVIDER_BUDGET_EXCEEDED", "The RepairSpecialist attempted forbidden provider transport.");
    const proposal = RepairProposalSchema.parse(rawProposal);
    if (proposal.repairId !== transaction.repairId || proposal.workspaceId !== transaction.workspace.workspaceId || proposal.sourceHead !== transaction.baseline.sourceHead || proposal.specialistId !== this.dependencies.specialist.specialistId) throw new SafeRepairError("REPAIR_WORKSPACE_BINDING_INVALID", "Repair proposal is not bound to the frozen repair context.");
    repairing = this.update(repairing, { proposal, status: "VERIFYING" });
    return repairing;
  }

  async verify(transaction: RepairTransaction) {
    this.assertStatus(transaction, "VERIFYING");
    if (!transaction.intent || !transaction.baseline || !transaction.impact || !transaction.proposal) throw new SafeRepairError("REPAIR_INTENT_REQUIRED", "Repair verification context is incomplete.");
    const proposal = transaction.proposal;
    const verification = RepairVerificationResultSchema.parse(await this.dependencies.verificationRunner.verify({ incident: transaction.incident, intent: transaction.intent, baseline: transaction.baseline, impact: transaction.impact, workspace: transaction.workspace!, proposal }));
    const contractDelta = this.contractGuardian.compare({ before: transaction.baseline.contractFingerprints, after: verification.candidateContracts, expectedContracts: this.dependencies.expectedContractIds, contractChangeIntent: transaction.intent.contractChangeIntent });
    const regressionDelta = this.regressionGuardian.verify({ baseline: transaction.baseline, candidateFailures: verification.candidateFailures });
    const testMutation = this.testMutationGuardian.evaluate({ mutations: verification.candidateTests, policy: transaction.intent.changeBudget.testModificationPolicy, contractChangeIntent: transaction.intent.contractChangeIntent });
    const protectedStateDelta = compareProtectedProjectState(transaction.baseline.protectedProjectFingerprints, verification.protectedProjectFingerprints);
    const ownership = evaluateRepairOwnership({ changedFiles: verification.actualChangedFiles, specialistId: proposal.specialistId, rules: this.dependencies.ownershipRules, handoff: proposal.ownershipHandoff });
    return this.update(transaction, { verification, contractDelta, regressionDelta, testMutation, protectedStateDelta, ownership });
  }

  async review(transaction: RepairTransaction) {
    this.assertStatus(transaction, "VERIFYING");
    if (!transaction.intent || !transaction.baseline || !transaction.impact || !transaction.proposal || !transaction.verification || !transaction.contractDelta || !transaction.regressionDelta || !transaction.testMutation || !transaction.protectedStateDelta) throw new SafeRepairError("REPAIR_INTENT_REQUIRED", "All deterministic verification reports are required before adversarial review.");
    const adversarialReview = this.adversarialReviewer.review({ proposal: transaction.proposal, verification: transaction.verification, impact: transaction.impact, contractDelta: transaction.contractDelta, regressionDelta: transaction.regressionDelta, testMutation: transaction.testMutation, protectedStateDelta: transaction.protectedStateDelta });
    return this.update(transaction, { adversarialReview, status: adversarialReview.decision === "PASS" ? "READY_FOR_INTEGRATION" : "REVIEW_BLOCKED" });
  }

  async decide(transaction: RepairTransaction) {
    if (!["READY_FOR_INTEGRATION", "REVIEW_BLOCKED"].includes(transaction.status)) throw new SafeRepairError("REPAIR_INVALID_STATUS_TRANSITION", "Integration decision requires completed adversarial review.");
    if (!transaction.intent || !transaction.baseline || !transaction.impact || !transaction.proposal || !transaction.verification || !transaction.contractDelta || !transaction.regressionDelta || !transaction.testMutation || !transaction.protectedStateDelta || !transaction.adversarialReview || !transaction.ownership) throw new SafeRepairError("REPAIR_INTENT_REQUIRED", "Integration decision context is incomplete.");
    const integrationDecision = evaluateIntegration({ currentSourceHead: await this.readCurrentSourceHead(), baseline: transaction.baseline, intent: transaction.intent, impact: transaction.impact, proposal: transaction.proposal, verification: transaction.verification, contractDelta: transaction.contractDelta, regressionDelta: transaction.regressionDelta, testMutation: transaction.testMutation, protectedStateDelta: transaction.protectedStateDelta, ownership: transaction.ownership, adversarialReview: transaction.adversarialReview });
    if (integrationDecision.decision === "ALLOW") return this.update(transaction, { integrationDecision });
    const status = integrationDecision.reason === "REPAIR_BASELINE_STALE" ? "STALE" : "REJECTED";
    return this.update(transaction, { integrationDecision, status });
  }

  async integrate(transaction: RepairTransaction) {
    this.assertStatus(transaction, "READY_FOR_INTEGRATION");
    if (!transaction.integrationDecision || transaction.integrationDecision.decision !== "ALLOW" || !transaction.baseline || !transaction.proposal || !transaction.verification || transaction.verification.diffChecksum !== transaction.proposal.diffChecksum) throw new SafeRepairError("REPAIR_INTEGRATION_BLOCKED", "Only an allowed, host-verified candidate may reach IntegrationAuthority.");
    const currentSourceHead = await this.readCurrentSourceHead();
    if (currentSourceHead !== transaction.baseline.sourceHead) return this.update(transaction, { integrationDecision: { ...transaction.integrationDecision, decision: "BLOCK", reason: "REPAIR_BASELINE_STALE", reasons: ["Canonical source HEAD changed before integration."], decidedAt: currentTime() }, status: "STALE" });
    const result = await this.dependencies.integrationAuthority.integrate({ transaction, proposal: transaction.proposal, baseline: transaction.baseline });
    if (result.candidateChecksum !== transaction.proposal.diffChecksum) throw new SafeRepairError("REPAIR_INTEGRATION_BLOCKED", "IntegrationAuthority did not acknowledge the exact candidate diff.");
    return this.update(transaction, { status: "INTEGRATED" });
  }

  async run(input: { incident: RepairIncident; baseline: RepairBaseline; changedFiles: readonly string[]; repairId?: string; project?: RepairWorkspaceOpenInputProject; projectVersion?: number; operationId?: string }) {
    let transaction = await this.captureIncident({ incident: input.incident, repairId: input.repairId });
    transaction = this.update(transaction, { baseline: input.baseline });
    transaction = await this.diagnose(transaction);
    transaction = await this.analyzeImpact(transaction, { changedFiles: input.changedFiles });
    if (transaction.status === "STALE") return transaction;
    transaction = await this.openRepairWorkspace(transaction, { project: input.project, projectVersion: input.projectVersion, operationId: input.operationId });
    transaction = await this.submitCandidate(transaction);
    transaction = await this.verify(transaction);
    transaction = await this.review(transaction);
    transaction = await this.decide(transaction);
    if (transaction.status === "READY_FOR_INTEGRATION" && transaction.integrationDecision?.decision === "ALLOW") transaction = await this.integrate(transaction);
    return transaction;
  }

  private async readCurrentSourceHead() { return typeof this.dependencies.currentSourceHead === "function" ? await this.dependencies.currentSourceHead() : this.dependencies.currentSourceHead; }
  private assertStatus(transaction: RepairTransaction, expected: RepairTransaction["status"]) { if (transaction.status !== expected) throw new SafeRepairError("REPAIR_INVALID_STATUS_TRANSITION", `Expected repair status ${expected}, received ${transaction.status}.`); }
  private update(transaction: RepairTransaction, updates: Partial<RepairTransaction>) { return RepairTransactionSchema.parse({ ...transaction, ...updates, updatedAt: currentTime() }); }
}

type RepairWorkspaceOpenInputProject = Parameters<RepairWorkspacePort["open"]>[0]["project"];

export class RepairProviderBudget {
  readonly maxRequests = 0;
  private requestCount = 0;

  get calls() { return this.requestCount; }
  request(): never {
    this.requestCount += 1;
    throw new SafeRepairError("REPAIR_PROVIDER_BUDGET_EXCEEDED", "Provider transport is forbidden during a source-only Safe Repair foundation run.");
  }
}
