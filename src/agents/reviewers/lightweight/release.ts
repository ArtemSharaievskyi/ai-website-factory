import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { AgentReviewResultSchema, ReleaseReadinessResultSchema, ReviewQualityGateSchema, type AgentReviewResult, type ReleaseReadinessResult, type ReviewQualityGate, type ReviewAgentId } from "@/domain/review/lightweight";

export class ReviewReadinessError extends Error {
  constructor(readonly code: "REVIEW_SNAPSHOT_STALE" | "REVIEW_RESULT_INVALID", message: string) { super(message); this.name = "ReviewReadinessError"; }
}

export function assertReviewSnapshotCurrent(expectedImplementationChecksum: string, actualImplementationChecksum: string) {
  if (expectedImplementationChecksum !== actualImplementationChecksum) throw new ReviewReadinessError("REVIEW_SNAPSHOT_STALE", "The implementation changed during the review cycle; old review evidence cannot be admitted.");
  return true;
}

export function assertReviewSnapshotBindingsCurrent(input: {
  expectedImplementationChecksum: string;
  actualImplementationChecksum: string;
  expectedArchitectureChecksum?: string;
  actualArchitectureChecksum?: string;
  expectedDesignChecksum?: string;
  actualDesignChecksum?: string;
}) {
  assertReviewSnapshotCurrent(input.expectedImplementationChecksum, input.actualImplementationChecksum);
  if (input.expectedArchitectureChecksum && input.actualArchitectureChecksum && input.expectedArchitectureChecksum !== input.actualArchitectureChecksum)
    throw new ReviewReadinessError("REVIEW_SNAPSHOT_STALE", "The approved architecture changed during the review cycle; old review evidence cannot be admitted.");
  if (input.expectedDesignChecksum && input.actualDesignChecksum && input.expectedDesignChecksum !== input.actualDesignChecksum)
    throw new ReviewReadinessError("REVIEW_SNAPSHOT_STALE", "The approved design changed during the review cycle; old visual evidence cannot be admitted.");
  return true;
}

function resultForAgent(results: readonly AgentReviewResult[], agent: ReviewAgentId) { return results.find((result) => result.agent === agent); }

export function evaluateReleaseReadiness(input: {
  implementationChecksum: string;
  requiredReviews: readonly ReviewAgentId[];
  reviewResults: readonly AgentReviewResult[];
  qualityGates?: readonly ReviewQualityGate[];
  currentImplementationChecksum?: string;
}): ReleaseReadinessResult {
  if (input.currentImplementationChecksum) assertReviewSnapshotCurrent(input.implementationChecksum, input.currentImplementationChecksum);
  const results = input.reviewResults.map((result) => AgentReviewResultSchema.parse(result));
  if (new Set(results.map((result) => result.agent)).size !== results.length)
    throw new ReviewReadinessError("REVIEW_RESULT_INVALID", "A review cycle cannot admit duplicate results for the same reviewer.");
  if (results.some((result) => result.artifactFingerprint !== input.implementationChecksum))
    throw new ReviewReadinessError("REVIEW_SNAPSHOT_STALE", "One or more reviewer results are bound to a different implementation snapshot.");
  const requiredReviews = [...new Set(input.requiredReviews)];
  const completedReviews = requiredReviews.filter((agent) => Boolean(resultForAgent(results, agent)));
  const missingRequiredReviews = requiredReviews.filter((agent) => !completedReviews.includes(agent));
  const blockingFindings = results.flatMap((result) => result.findings.filter((finding) => finding.blocking).map((finding) => finding.id));
  const warnings = results.flatMap((result) => result.findings.filter((finding) => !finding.blocking && ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(finding.severity)).map((finding) => finding.id));
  const gates = (input.qualityGates ?? []).map((gate) => ReviewQualityGateSchema.parse(gate));
  const failedGates = gates.filter((gate) => gate.status === "FAIL" || gate.status === "NOT_RUN").map((gate) => gate.id);
  const verdict = missingRequiredReviews.length || failedGates.length || results.some((result) => result.status === "BLOCK") || blockingFindings.length
    ? "BLOCKED"
    : results.some((result) => result.status === "WARN") || warnings.length || gates.some((gate) => gate.status === "WARN")
      ? "READY_WITH_WARNINGS"
      : "READY";
  return ReleaseReadinessResultSchema.parse({ implementationChecksum: input.implementationChecksum, requiredReviews, completedReviews, blockingFindings: [...new Set(blockingFindings)], warnings: [...new Set(warnings)], missingRequiredReviews, failedGates, verdict });
}

export function releaseReadinessFingerprint(result: ReleaseReadinessResult) {
  return checksumPersistedDocument(result);
}
