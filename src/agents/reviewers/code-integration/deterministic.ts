import { CodeIntegrationReviewResultSchema, type CodeIntegrationReviewResult } from "@/domain/review/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { CodeIntegrationReviewInputSchema, type CodeIntegrationReviewInput, CODE_INTEGRATION_REVIEW_POLICY_VERSION } from "./contracts";
import type { CodeIntegrationReviewProvider } from "./ports";

const finding = (id: string, category: CodeIntegrationReviewResult["findings"][number]["category"], summary: string, refs: string[], ownerTaskId?: string) => ({ findingId: id, severity: "ERROR" as const, category, summary, evidenceRefs: refs, affectedArtifacts: refs, recommendedAction: ownerTaskId ? `Correct the implementation owned by task ${ownerTaskId}.` : "Correct the upstream contract and rerun implementation review.", correctionTarget: ownerTaskId ? "IMPLEMENTATION_TASK" as const : "UPSTREAM_CONTRACT" as const, ...(ownerTaskId ? { ownerTaskId } : {}) });
export function deterministicCodeIntegrationReview(raw: CodeIntegrationReviewInput): CodeIntegrationReviewResult {
  const input = CodeIntegrationReviewInputSchema.parse(raw);
  const findings = [] as CodeIntegrationReviewResult["findings"];
  if (input.staticValidation.sourceChecksum !== input.sourceChecksum) findings.push(finding("source-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "Static validation evidence does not describe the current source checksum.", ["source"]));
  if (checksumPersistedDocument(input.approvedBrief) !== input.briefChecksum) findings.push(finding("brief-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied Brief checksum is stale.", ["brief"]));
  if (checksumPersistedDocument(input.acceptedPlanningPackage) !== input.planningChecksum) findings.push(finding("planning-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied Planning checksum is stale.", ["planning-package"]));
  if (checksumPersistedDocument(input.approvedArchitectureReview) !== input.architectureReviewChecksum) findings.push(finding("architecture-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied Architecture Review checksum is stale.", ["architecture-review"]));
  if (checksumPersistedDocument(input.selectedDesign) !== input.designChecksum) findings.push(finding("design-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied selected Design checksum is stale.", ["selected-design"]));
  if (input.approvedContractAudit.result.verdict !== "APPROVED") findings.push(finding("contract-audit-not-current", "CONTRACT_IMPLEMENTATION_MISMATCH", "A current approved Contract Audit is required before code review.", ["contract-audit"]));
  if (checksumPersistedDocument(input.approvedContractAudit) !== input.contractAuditChecksum) findings.push(finding("contract-audit-checksum-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied Contract Audit record checksum is stale.", ["contract-audit"]));
  if (input.approvedArchitectureReview.result.verdict !== "APPROVED") findings.push(finding("architecture-review-not-approved", "CONTRACT_IMPLEMENTATION_MISMATCH", "The bound Architecture Review is not approved.", ["architecture-review"]));
  if (input.taskGraph.graphChecksum && input.taskGraph.graphChecksum !== input.taskGraphChecksum) findings.push(finding("task-graph-stale", "CONTRACT_IMPLEMENTATION_MISMATCH", "The supplied TaskGraph checksum is stale.", ["task-graph"]));
  const manifest = new Set(input.sourceManifest.map((file) => file.relativePath));
  for (const slice of input.sourceSlices) if (!manifest.has(slice.relativePath)) findings.push(finding(`source-ref-${slice.relativePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, "MODULE_INTEGRATION_MISMATCH", "A source slice is not present in the bounded source manifest.", [`source:${slice.relativePath}`]));
  const taskIds = new Set(input.implementationTasks.map((task) => task.taskId));
  for (const task of input.taskGraph.tasks.filter((task) => task.role === "implementation" && task.taskType.startsWith("implement-"))) if (task.status === "passed" && !taskIds.has(task.id)) findings.push(finding(`task-summary-${task.id}`, "IMPLEMENTATION_RESPONSIBILITY_MISMATCH", "A passed implementation task is missing from the current source review summaries.", [task.id]));
  const result = { verdict: findings.length ? "CHANGES_REQUIRED" as const : "APPROVED" as const, findings, reviewedArtifactRefs: ["brief", "planning-package", "architecture-review", "selected-design", "contract-audit", "task-graph", "source"], policyVersion: CODE_INTEGRATION_REVIEW_POLICY_VERSION };
  return CodeIntegrationReviewResultSchema.parse(result);
}
export class DeterministicCodeIntegrationReviewProvider implements CodeIntegrationReviewProvider { readonly promptVersion = "code-integration-reviewer.v1"; async review(input: CodeIntegrationReviewInput) { return deterministicCodeIntegrationReview(input); } }
