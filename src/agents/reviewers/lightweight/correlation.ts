import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { createRepairIncident, RegressionLedgerEntrySchema, type RepairIncident, type RegressionLedgerEntry } from "@/orchestration/repair/contracts";
import { ReviewFindingSchema, type ReviewFinding } from "@/domain/review/lightweight";

export type CorrelatedReviewFindings = { correlationKey: string; findings: ReviewFinding[] };

function correlationValue(finding: ReviewFinding) {
  return {
    category: finding.category,
    artifacts: [...finding.affectedArtifacts].sort(),
    routes: [...(finding.affectedRoutes ?? [])].sort(),
    files: [...(finding.affectedFiles ?? [])].sort(),
    operation: finding.operation ?? null,
    invariant: finding.invariant ?? null,
    requirements: [...(finding.canonicalRequirementRefs ?? [])].sort(),
    architecture: [...(finding.architectureRefs ?? [])].sort(),
    tasks: [...(finding.taskRefs ?? [])].sort(),
  };
}

export function reviewFindingCorrelationKey(finding: ReviewFinding) {
  return `review-finding:${checksumPersistedDocument(correlationValue(finding))}`;
}

export function correlateReviewFindings(findings: readonly ReviewFinding[]): CorrelatedReviewFindings[] {
  const groups = new Map<string, ReviewFinding[]>();
  for (const raw of findings) {
    const finding = ReviewFindingSchema.parse(raw);
    const key = reviewFindingCorrelationKey(finding);
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([correlationKey, group]) => ({ correlationKey, findings: group.sort((left, right) => left.agent.localeCompare(right.agent) || left.id.localeCompare(right.id)) }));
}

const sourceForAgent = (agent: ReviewFinding["agent"]): RepairIncident["source"] => {
  if (["browser-qa", "accessibility-review", "performance-review", "visual-regression"].includes(agent)) return "RUNTIME";
  if (["security-reviewer"].includes(agent)) return "CONTRACT";
  return "CONTRACT";
};

const repairSafeRef = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value)
  ? value
  : `review-evidence:${checksumPersistedDocument(value).slice(0, 24)}`;

export function reviewFindingsToRepairIncidents(input: { projectId: string; projectVersion: number; findings: readonly ReviewFinding[]; observedAt?: string }): RepairIncident[] {
  const groups = correlateReviewFindings(input.findings.filter((finding) => finding.blocking && finding.repairRequired));
  return groups.map((group) => {
    const first = group.findings[0]!;
    const evidenceRefs = [...new Set(group.findings.flatMap((finding) => [finding.id, ...finding.evidence].map(repairSafeRef)))].slice(0, 50);
    return createRepairIncident({
      incidentId: `review-${group.correlationKey.slice(-24)}`,
      source: sourceForAgent(first.agent),
      failureClass: "POST_IMPLEMENTATION_REVIEW_FINDING",
      stage: "POST_IMPLEMENTATION_QA",
      boundary: first.category,
      outerCode: `REVIEW_${first.agent.toUpperCase().replaceAll("-", "_")}`,
      reasonCode: first.id,
      safeFingerprint: group.correlationKey,
      safeTokens: [first.category, first.operation ?? "review", ...(first.affectedRoutes ?? []).slice(0, 3)],
      affectedProject: { projectId: input.projectId, projectVersion: input.projectVersion },
      observedAt: input.observedAt ?? new Date().toISOString(),
      evidenceRefs,
    });
  });
}

/**
 * Explicit promotion hook for a repaired, reusable regression. Project-local
 * findings deliberately return no ledger entry; Safe Repair remains the owner
 * of deciding whether a permanent regression is warranted.
 */
export function reviewFindingToRegressionLedgerEntry(input: {
  finding: ReviewFinding;
  regressionId: string;
  subsystem: string;
  regressionTestRef: string;
  reusable: boolean;
  runtimeBoundary?: string;
  introducedAt?: string;
}): RegressionLedgerEntry | undefined {
  if (!input.reusable) return undefined;
  const finding = ReviewFindingSchema.parse(input.finding);
  return RegressionLedgerEntrySchema.parse({
    regressionId: input.regressionId,
    safeFingerprint: reviewFindingCorrelationKey(finding),
    subsystem: repairSafeRef(input.subsystem),
    rootCauseClass: `review-${finding.category.toLowerCase()}`,
    protectingInvariant: finding.invariant ?? finding.operation ?? "review-boundary",
    regressionTestRefs: [repairSafeRef(input.regressionTestRef)],
    affectedContracts: [...(finding.canonicalRequirementRefs ?? []), ...(finding.architectureRefs ?? [])].map(repairSafeRef).slice(0, 100),
    affectedRuntimeBoundaries: [repairSafeRef(input.runtimeBoundary ?? finding.category)],
    status: "ACTIVE",
    ...(input.introducedAt ? { introducedAt: input.introducedAt } : {}),
  });
}
