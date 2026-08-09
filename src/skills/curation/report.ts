import {
  type CurationReviewer,
  type SkillCandidateEvaluation,
} from "./contracts";

export type CurationAvailability =
  | "AVAILABLE"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "ACCESS_FORBIDDEN"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "API_ERROR";

const reviewerLabels: Record<CurationReviewer, string> = {
  "architecture-reviewer": "Architecture Reviewer",
  "contract-auditor": "Contract Auditor",
  "code-integration-reviewer": "Code / Integration Reviewer",
  "security-reviewer": "Security Reviewer",
  "test-quality-reviewer": "Test / Quality Reviewer",
};
const tableCell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const auditLabel = (evaluation: SkillCandidateEvaluation) =>
  evaluation.externalAuditStatus === "unavailable"
    ? "UNAVAILABLE (advisory source)"
    : evaluation.externalAuditStatus.toUpperCase();

export type CurationReportInput = {
  generatedAt: string;
  availability: CurationAvailability;
  searchQueries: string[];
  detailCandidatesFetched: number;
  sourceIssues: readonly string[];
  stagedExternalSkills: number;
  evaluations: readonly SkillCandidateEvaluation[];
};

export function renderCurationReport(input: CurationReportInput) {
  const evaluations = [...input.evaluations];
  const shortlisted = evaluations.filter(
    (evaluation) => evaluation.recommendedDisposition === "SHORTLIST",
  );
  const rejected = evaluations.filter(
    (evaluation) => evaluation.recommendedDisposition === "REJECT",
  );
  const humanReview = evaluations.filter(
    (evaluation) => evaluation.recommendedDisposition === "NEEDS_HUMAN_REVIEW",
  );
  const rows = evaluations
    .map(
      (evaluation) =>
        `| ${tableCell(reviewerLabels[evaluation.targetReviewer])} | ${tableCell(evaluation.displayName)} | ${tableCell(evaluation.source)} | ${tableCell(evaluation.reasons[0] ?? "Focused procedural value")} | ${tableCell(evaluation.toolAssumptions.map((item) => item.category).join(", ") || "none detected")} | ${auditLabel(evaluation)} | ${evaluation.estimatedInjectionBytes} bytes | ${evaluation.recommendation} |`,
    )
    .join("\n");
  const candidateDetails = evaluations
    .map((evaluation) => {
      const reasons = evaluation.reasons.map((reason) => `- ${reason}`).join("\n");
      return `### ${evaluation.displayName} — ${reviewerLabels[evaluation.targetReviewer]}\n\n- External ID: \`${evaluation.externalSkillId}\`\n- Source: ${evaluation.source}\n- Canonical source reference: ${evaluation.canonicalSourceRef}\n- Candidate checksum: \`${evaluation.candidateChecksum}\`\n- Retrieved content checksum: \`${evaluation.retrievedContentChecksum}\`\n- Disposition: **${evaluation.recommendedDisposition}**\n- Recommendation: **${evaluation.recommendation}**\n- Role fit / procedure fit: ${evaluation.roleFit} / ${evaluation.procedureFit}\n- Architecture compatibility: ${evaluation.architectureCompatibility}\n- Tool assumptions: ${evaluation.toolAssumptions.map((item) => `${item.category}${item.essential ? " (essential)" : " (incidental)"}`).join(", ") || "none detected"}\n- Context cost: ${evaluation.estimatedInjectionBytes} bytes (${evaluation.contextEfficiency}); total candidate text ${evaluation.contentBytes} bytes\n- Overlap: ${evaluation.overlapAssessment}\n- Local security: ${evaluation.localSecurityAssessment.toUpperCase()} (${evaluation.deterministicChecks.unsafeFindingCount} approval-blocking findings)\n- External audit: ${auditLabel(evaluation)}\n- Staged skill ID: ${evaluation.stagedSkillId ?? "none"}\n\nReasons:\n${reasons}`;
    })
    .join("\n\n");
  return `# External Skill Curation Report

Generated: ${input.generatedAt}

Policy version: \`external-skill-curation-v1\`

This is an administrative discovery/evaluation report. External content remains untrusted. No candidate was approved, assigned to an agent, executed, rewritten, or used to change Factory runtime behavior. External audit results are advisory metadata only.

Availability state: **${input.availability}**

${input.availability === "AUTH_REQUIRED" ? "Official skills.sh API authentication is required for live discovery." : ""}

## Session summary

- Live search queries: ${input.searchQueries.length}
- Search queries attempted: ${input.searchQueries.map((query) => `\`${query}\``).join(", ") || "none"}
- Detail candidates fetched: ${input.detailCandidatesFetched}
- Source retrieval issues: ${input.sourceIssues.length}${input.sourceIssues.length ? ` (${input.sourceIssues.join("; ")})` : ""}
- Evaluations persisted: ${evaluations.length}
- Shortlisted: ${shortlisted.length}
- Rejected: ${rejected.length}
- Needing human review: ${humanReview.length}
- External skills staged: ${input.stagedExternalSkills}
- External skills approved: **0**
- Active assigned external skills: **0**

## Human decision table

| Reviewer | Candidate skill | Source | Primary value / main concern | Tool assumptions | Security status | Context cost | Recommendation |
|---|---|---|---|---|---|---:|---|
${rows || "| — | No candidates returned | — | — | — | — | — | OPTIONAL |"}

Recommendation labels are curation advice only. They are not registry approval states.

## Candidate details

${candidateDetails || "No detail candidates were successfully evaluated."}

## Hard-stop verification

- Approved Skills Registry approval function was not called.
- Reviewer \`allowedSkillIds\` remain unchanged and empty.
- No external skill content was executed.
- No external links in skill text were followed.
- No dependencies were installed.
- No Skills Agent, Skill Curator Agent, or second orchestrator was created.
- No workflow states were added.
- No production website-generation E2E was run.
`;
}
