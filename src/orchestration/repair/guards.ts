import { RepairBaselineSchema, RepairRiskSchema, RepairReviewSchema, RegressionDeltaReportSchema, TestMutationReportSchema, ProtectedStateDeltaReportSchema, RepairOwnershipCheckSchema, type ChangeBudget, type ContractChangeIntent, type ContractDeltaReport, type FailureSnapshot, type ProtectedProjectFingerprint, type ProtectedStateDeltaReport, type RepairBaseline, type RepairIntent, type RepairProposal, type RepairReview, type RepairRisk, type RepairTestMutation, type RegressionDeltaReport, type TestMutationReport, type ChangeImpactGraph, type RepairIntegrationDecision, type RepairOwnershipCheck, type RepairVerificationResult } from "./contracts";

const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
export const matchesRepairPath = (pattern: string, file: string) => {
  const left = normalize(pattern);
  const right = normalize(file);
  if (left === right) return true;
  if (left.endsWith("/**")) return right.startsWith(left.slice(0, -2));
  if (left.includes("*")) {
    const escaped = left.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(right);
  }
  return false;
};
const matchesAnyPath = (patterns: readonly string[], file: string) => patterns.some((pattern) => matchesRepairPath(pattern, file));
const hasToken = (values: readonly string[], pattern: RegExp) => values.some((value) => pattern.test(value));

export type ScopeCheckResult = { passed: boolean; code: "PASS" | "REPAIR_SCOPE_EXCEEDED"; reasons: string[] };

export function evaluateChangeBudget(budget: ChangeBudget, candidate: Pick<RepairVerificationResult, "actualChangedFiles" | "changedLines">, contractDelta?: ContractDeltaReport): ScopeCheckResult {
  const reasons: string[] = [];
  const actualFiles = [...new Set(candidate.actualChangedFiles.map(normalize))];
  if (actualFiles.length > budget.maxFilesChanged) reasons.push("maxFilesChanged");
  if (budget.maxLinesChanged !== undefined && candidate.changedLines > budget.maxLinesChanged) reasons.push("maxLinesChanged");
  if (actualFiles.some((file) => !matchesAnyPath(budget.allowedPaths, file))) reasons.push("pathOutsideAllowedScope");
  if (actualFiles.some((file) => matchesAnyPath(budget.forbiddenPaths, file))) reasons.push("forbiddenPath");
  if (!budget.migrationAllowed && actualFiles.some((file) => /^supabase\/migrations\//i.test(file))) reasons.push("migrationForbidden");
  if (!budget.schemaChangeAllowed && hasToken(actualFiles, /schema|migration|database/i)) reasons.push("schemaChangeForbidden");
  if (!budget.lifecycleChangeAllowed && hasToken(actualFiles, /lifecycle|workflow|transition/i)) reasons.push("lifecycleChangeForbidden");
  if (!budget.providerContractChangeAllowed && hasToken(actualFiles, /provider|openai|contract/i)) reasons.push("providerContractChangeForbidden");
  const publicDeltaCount = contractDelta?.entries.filter((entry) => entry.classification !== "EXPECTED").length ?? 0;
  if (publicDeltaCount > budget.maxPublicContractChanges) reasons.push("maxPublicContractChanges");
  return reasons.length ? { passed: false, code: "REPAIR_SCOPE_EXCEEDED", reasons } : { passed: true, code: "PASS", reasons: [] };
}

export function classifyRepairRisk(input: { allowedPaths: readonly string[]; nodeTypes?: readonly string[]; contractChange?: boolean; securitySensitive?: boolean }): RepairRisk {
  const values = [...input.allowedPaths, ...(input.nodeTypes ?? [])];
  if (input.securitySensitive || input.contractChange || hasToken(values, /auth|rls|migration|persistence|orchestration|provider|openai|lifecycle|security|database|specialist|canonical/i)) return RepairRiskSchema.parse("HIGH");
  if (hasToken(values, /route|workbench|contract|schema|shared|component|runtime/i)) return RepairRiskSchema.parse("MEDIUM");
  return RepairRiskSchema.parse("LOW");
}

export type BaselineCaptureInput = Omit<RepairBaseline, "capturedAt" | "risk"> & { risk?: RepairRisk; capturedAt?: string };

export function captureRepairBaseline(input: BaselineCaptureInput): RepairBaseline {
  return RepairBaselineSchema.parse({ ...input, risk: input.risk ?? "MEDIUM", capturedAt: input.capturedAt ?? new Date().toISOString() });
}

export function compareFailureDelta(baseline: readonly FailureSnapshot[], candidate: readonly FailureSnapshot[]): RegressionDeltaReport {
  const baselineByIdentity = new Map(baseline.map((failure) => [failure.identity, failure]));
  const candidateByIdentity = new Map(candidate.map((failure) => [failure.identity, failure]));
  const entries: RegressionDeltaReport["entries"] = [];
  const resolvedFailures: FailureSnapshot[] = [];
  const unchangedFailures: FailureSnapshot[] = [];
  const newFailures: FailureSnapshot[] = [];
  const changedFailures: FailureSnapshot[] = [];
  for (const failure of candidate) {
    const previous = baselineByIdentity.get(failure.identity);
    if (!previous) {
      newFailures.push(failure);
      entries.push({ identity: failure.identity, classification: "NEW_FAILURE", candidateFingerprint: failure.fingerprint });
    } else if (previous.fingerprint !== failure.fingerprint) {
      changedFailures.push(failure);
      entries.push({ identity: failure.identity, classification: "CHANGED_FAILURE", baselineFingerprint: previous.fingerprint, candidateFingerprint: failure.fingerprint });
    } else {
      unchangedFailures.push(failure);
      entries.push({ identity: failure.identity, classification: "UNCHANGED_BASELINE_FAILURE", baselineFingerprint: previous.fingerprint, candidateFingerprint: failure.fingerprint });
    }
  }
  for (const failure of baseline) if (!candidateByIdentity.has(failure.identity)) {
    resolvedFailures.push(failure);
    entries.push({ identity: failure.identity, classification: "RESOLVED_BASELINE_FAILURE", baselineFingerprint: failure.fingerprint });
  }
  return RegressionDeltaReportSchema.parse({ entries, baselineFailures: [...baseline], resolvedFailures, unchangedFailures, newFailures, changedFailures, passed: newFailures.length === 0 && changedFailures.length === 0 });
}

export class RegressionGuardian {
  verify(input: { baseline: RepairBaseline; candidateFailures: readonly FailureSnapshot[] }) {
    return compareFailureDelta(input.baseline.testFailureFingerprints, input.candidateFailures);
  }
}

export class ContractGuardian {
  compare(input: { before: Readonly<Record<string, string>>; after: Readonly<Record<string, string>>; expectedContracts?: readonly string[]; contractChangeIntent?: ContractChangeIntent }): ContractDeltaReport {
    const keys = [...new Set([...Object.keys(input.before), ...Object.keys(input.after)])].sort();
    const expected = new Set(input.expectedContracts ?? []);
    const entries: ContractDeltaReport["entries"] = [];
    for (const key of keys) {
      const before = input.before[key];
      const after = input.after[key];
      if (before === after) continue;
      let classification: "EXPECTED" | "AUTHORIZED" | "UNEXPECTED" = "UNEXPECTED";
      if (expected.has(key)) classification = "EXPECTED";
      else if (input.contractChangeIntent && contractIntentMatches(input.contractChangeIntent, key)) classification = "AUTHORIZED";
      entries.push({ surface: key.split(":", 1)[0] ?? key, contractId: key, ...(before ? { before } : {}), ...(after ? { after } : {}), classification });
    }
    const unexpectedCount = entries.filter((entry) => entry.classification === "UNEXPECTED").length;
    const authorizedCount = entries.filter((entry) => entry.classification === "AUTHORIZED").length;
    const expectedCount = entries.filter((entry) => entry.classification === "EXPECTED").length;
    return { entries, unexpectedCount, authorizedCount, expectedCount, passed: unexpectedCount === 0 };
  }
}

function contractIntentMatches(intent: ContractChangeIntent, key: string) {
  return key === intent.contract || key.startsWith(`${intent.contract}:`) || key.split(":", 1)[0] === intent.contract;
}

export class TestMutationGuardian {
  evaluate(input: { mutations: readonly RepairTestMutation[]; policy: RepairIntent["changeBudget"]["testModificationPolicy"]; contractChangeIntent?: ContractChangeIntent }): TestMutationReport {
    const changedExistingTests = input.mutations.filter((mutation) => mutation.kind !== "ADDED");
    const addedTests = input.mutations.filter((mutation) => mutation.kind === "ADDED");
    const suspicious: string[] = [];
    for (const mutation of input.mutations) {
      if (mutation.kind === "DELETED") suspicious.push("TEST_DELETED");
      if (mutation.removedAssertions > 0) suspicious.push("ASSERTIONS_REMOVED");
      if (mutation.addedSkips > 0) suspicious.push("TEST_SKIP_ADDED");
      if (mutation.addedOnly > 0) suspicious.push("TEST_ONLY_ADDED");
      if (mutation.timeoutIncreaseMs > 0) suspicious.push("TEST_TIMEOUT_INCREASED");
      if (mutation.fixtureBypass) suspicious.push("TEST_FIXTURE_BYPASS");
      if (mutation.changedExpectations > 0 && input.policy !== "AUTHORIZED_CONTRACT_MIGRATION") suspicious.push("TEST_EXPECTATION_CHANGED");
    }
    if (changedExistingTests.length && input.policy !== "AUTHORIZED_CONTRACT_MIGRATION") suspicious.push("EXISTING_TEST_MODIFIED");
    if (input.policy === "AUTHORIZED_CONTRACT_MIGRATION" && changedExistingTests.length && !input.contractChangeIntent) suspicious.push("MISSING_CONTRACT_CHANGE_INTENT");
    return TestMutationReportSchema.parse({ changedExistingTests, addedTests, suspicious: [...new Set(suspicious)], passed: suspicious.length === 0 });
  }
}

export function compareProtectedProjectState(before: readonly ProtectedProjectFingerprint[], after: readonly ProtectedProjectFingerprint[]): ProtectedStateDeltaReport {
  const beforeByKey = new Map(before.map((item) => [`${item.projectId}:${item.field}`, item]));
  const afterByKey = new Map(after.map((item) => [`${item.projectId}:${item.field}`, item]));
  const differences: ProtectedStateDeltaReport["differences"] = [];
  for (const key of [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort()) {
    const oldValue = beforeByKey.get(key);
    const newValue = afterByKey.get(key);
    if (oldValue?.fingerprint === newValue?.fingerprint) continue;
    const [projectId, field] = key.split(":", 2);
    differences.push({ projectId: projectId!, field: field!, ...(oldValue ? { before: oldValue.fingerprint } : {}), ...(newValue ? { after: newValue.fingerprint } : {}) });
  }
  return ProtectedStateDeltaReportSchema.parse({ differences, passed: differences.length === 0 });
}

export type RepairOwnershipRule = { pathPattern: string; ownerId: string };

export function evaluateRepairOwnership(input: { changedFiles: readonly string[]; specialistId: string; rules?: readonly RepairOwnershipRule[]; handoff?: { ownerId: string; approved: boolean } }): RepairOwnershipCheck {
  if (!input.rules?.length) return { passed: true, reasons: [] };
  const reasons: string[] = [];
  for (const file of input.changedFiles) {
    const owners = input.rules.filter((rule) => matchesRepairPath(rule.pathPattern, file)).map((rule) => rule.ownerId);
    if (!owners.length) reasons.push(`No owner is registered for ${normalize(file)}.`);
    else if (!owners.includes(input.specialistId) && !(input.handoff?.approved && owners.includes(input.handoff.ownerId))) reasons.push(`Specialist ${input.specialistId} does not own ${normalize(file)}.`);
  }
  return RepairOwnershipCheckSchema.parse({ passed: reasons.length === 0, reasons });
}

export class DeterministicAdversarialReviewer {
  review(input: { proposal: RepairProposal; verification: RepairVerificationResult; impact: ChangeImpactGraph; contractDelta: ContractDeltaReport; regressionDelta: RegressionDeltaReport; testMutation: TestMutationReport; protectedStateDelta: ProtectedStateDeltaReport }): RepairReview {
    const findings: RepairReview["findings"] = [];
    for (const pattern of input.verification.suspiciousPatterns) findings.push({ code: "SUSPICIOUS_REPAIR_PATTERN", severity: "HIGH", evidence: pattern, recommendation: "Return the candidate to the RepairSpecialist for a bounded root-cause repair." });
    if (input.verification.canonicalWriteAttempted) findings.push({ code: "CANONICAL_WRITE_BYPASS", severity: "CRITICAL", evidence: "A canonical write was detected before IntegrationAuthority.", recommendation: "Discard the candidate and preserve canonical-write isolation." });
    if (input.verification.providerCalls > 0) findings.push({ code: "PROVIDER_BUDGET_EXCEEDED", severity: "CRITICAL", evidence: "The source-only repair candidate consumed provider budget.", recommendation: "Reject the candidate before integration." });
    if (!input.contractDelta.passed) findings.push({ code: "CONTRACT_DELTA_UNSAFE", severity: "HIGH", evidence: "Unexpected contract changes were detected.", recommendation: "Require an explicit bounded ContractChangeIntent or reject the candidate." });
    if (!input.testMutation.passed) findings.push({ code: "TEST_TAMPERING", severity: "CRITICAL", evidence: input.testMutation.suspicious.join(","), recommendation: "Restore existing test assertions and repair production behavior." });
    if (!input.protectedStateDelta.passed) findings.push({ code: "PROTECTED_STATE_WEAKENED", severity: "CRITICAL", evidence: "Protected Factory state differs from the frozen baseline.", recommendation: "Reject the candidate and investigate the mutation boundary." });
    return RepairReviewSchema.parse({ decision: findings.length ? "BLOCK" : "PASS", findings, checkedAt: new Date().toISOString() });
  }
}

export function evaluateIntegration(input: { currentSourceHead: string; baseline: RepairBaseline; intent: RepairIntent; impact: ChangeImpactGraph; proposal: RepairProposal; verification: RepairVerificationResult; contractDelta: ContractDeltaReport; regressionDelta: RegressionDeltaReport; testMutation: TestMutationReport; protectedStateDelta: ProtectedStateDeltaReport; ownership?: RepairOwnershipCheck; adversarialReview: RepairReview }): RepairIntegrationDecision {
  const reasons: string[] = [];
  let reason: RepairIntegrationDecision["reason"] = "REPAIR_READY";
  if (input.currentSourceHead !== input.baseline.sourceHead) { reason = "REPAIR_BASELINE_STALE"; reasons.push("Canonical source HEAD changed after baseline capture."); }
  else if (!evaluateChangeBudget(input.intent.changeBudget, input.verification, input.contractDelta).passed) { reason = "REPAIR_SCOPE_EXCEEDED"; reasons.push("Candidate exceeds the host-owned change budget."); }
  else if (input.ownership && !input.ownership.passed) { reason = "REPAIR_OWNERSHIP_BLOCKED"; reasons.push("Candidate changes a file outside the assigned specialist ownership."); }
  else if (input.verification.providerCalls > 0) { reason = "PROVIDER_BUDGET_EXCEEDED"; reasons.push("Source-only repair provider budget is zero."); }
  else if (input.verification.canonicalWriteAttempted) { reason = "CANONICAL_WRITE_BYPASS"; reasons.push("A canonical write was detected before IntegrationAuthority."); }
  else if (input.verification.diffChecksum !== input.proposal.diffChecksum) { reason = "REPAIR_INTEGRATION_BLOCKED"; reasons.push("The host-verified diff checksum does not match the specialist proposal."); }
  else if (!input.verification.targetPassed || input.verification.targetProof.before !== "FAIL" || input.verification.targetProof.after !== "PASS") { reason = "TARGET_PROOF_FAILED"; reasons.push("The target behavior is not proven fixed by a bounded before/after proof."); }
  else if (!input.verification.impactChecksPassed || !input.regressionDelta.passed) { reason = input.regressionDelta.newFailures.length ? "NEW_FAILURE" : "CHANGED_FAILURE"; reasons.push("The baseline failure delta is not safe for integration."); }
  else if (input.intent.risk === "HIGH" && ["typecheck", "lint", "affected-tests", "contract-checks", "build", "runtime-smoke", "protected-state", "baseline-delta"].some((id) => input.verification.verificationGates[id]?.status !== "PASS")) { reason = "HIGH_RISK_GATE_BLOCKED"; reasons.push("A mandatory high-risk verification gate is missing or failed."); }
  else if (!input.contractDelta.passed) { reason = "CONTRACT_GUARD_BLOCKED"; reasons.push("Unexpected public/shared contract delta detected."); }
  else if (!input.testMutation.passed) { reason = "TEST_MUTATION_POLICY_BLOCKED"; reasons.push("Suspicious test mutation detected."); }
  else if (!input.protectedStateDelta.passed) { reason = "PROTECTED_STATE_DELTA_BLOCKED"; reasons.push("Protected Factory state changed."); }
  else if (input.adversarialReview.decision !== "PASS") { reason = "ADVERSARIAL_REVIEW_BLOCKED"; reasons.push("Adversarial review found an unsafe repair pattern."); }
  else return { decision: "ALLOW", reason: "REPAIR_READY", reasons: [], decidedAt: new Date().toISOString() };
  return { decision: "BLOCK", reason, reasons, decidedAt: new Date().toISOString() };
}
