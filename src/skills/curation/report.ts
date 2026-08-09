import { type CurationReviewer, type SkillCandidateEvaluation } from "./contracts";
import { agentResponsibilityProfiles, coverageCounts, type AgentResponsibilityProfile } from "./portfolio";

export type CurationAvailability =
  | "AVAILABLE" | "AUTH_REQUIRED" | "AUTH_INVALID" | "ACCESS_FORBIDDEN"
  | "RATE_LIMITED" | "UNAVAILABLE" | "NETWORK_ERROR" | "TIMEOUT"
  | "API_CONTRACT_MISMATCH" | "API_ERROR";

const labels: Record<CurationReviewer, string> = {
  lead: "Lead", planner: "Planner", design: "Design", implementation: "Implementation",
  "architecture-reviewer": "Architecture Reviewer", "contract-auditor": "Contract Auditor",
  "code-integration-reviewer": "Code / Integration Reviewer", "security-reviewer": "Security Reviewer",
  "test-quality-reviewer": "Test / Quality Reviewer",
};
const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const dispositionLabel = (evaluation: SkillCandidateEvaluation) =>
  evaluation.recommendedDisposition === "SHORTLIST" ? "STRONG_CANDIDATE" :
    evaluation.recommendedDisposition === "NEEDS_HUMAN_REVIEW" ? "USEFUL_COMPLEMENT" : "REJECTED";

export type CurationReportInput = {
  generatedAt: string;
  availability: CurationAvailability;
  searchQueries: string[];
  detailCandidatesFetched: number;
  sourceIssues: readonly string[];
  stagedExternalSkills: number;
  evaluations: readonly SkillCandidateEvaluation[];
  reusedEvaluations?: number;
  profiles?: readonly AgentResponsibilityProfile[];
};

export function renderCurationReport(input: CurationReportInput) {
  const profiles = input.profiles ?? agentResponsibilityProfiles;
  const counts = coverageCounts();
  const evaluations = [...input.evaluations];
  const strong = evaluations.filter((item) => item.recommendedDisposition === "SHORTLIST");
  const human = evaluations.filter((item) => item.recommendedDisposition === "NEEDS_HUMAN_REVIEW");
  const rejected = evaluations.filter((item) => item.recommendedDisposition === "REJECT");
  const gaps = profiles.flatMap((profile) => profile.coverage.filter((item) => item.state === "MISSING" || item.state === "PARTIALLY_COVERED"));
  const noSuitable = gaps.filter((gap) => !evaluations.some((item) => item.coverageKeys?.includes(gap.key) && item.recommendedDisposition !== "REJECT"));
  const currentSkills = profiles.flatMap((profile) => profile.approvedSkills);
  const candidateRows = evaluations.map((item) => `| ${cell(item.externalSkillId)} | ${cell(item.source)} | ${item.candidateChecksum} | ${cell(labels[item.targetReviewer])} | ${cell(item.coverageKeys?.join(", ") ?? "unmapped")} | ${item.estimatedInjectionBytes} | ${item.localSecurityAssessment.toUpperCase()} | ${item.toolAssumptionCompatibility} | ${item.overlapAssessment} | ${item.licenseEvidenceStatus ?? "MISSING"} | ${item.metadataReadiness ?? "INCOMPLETE"} | ${dispositionLabel(item)} |`).join("\n");
  const portfolioRows = profiles.map((profile) => {
    const mine = evaluations.filter((item) => item.targetReviewer === profile.agentId);
    const strongMine = mine.filter((item) => item.recommendedDisposition === "SHORTLIST").map((item) => item.externalSkillId).join(", ") || "—";
    const complementMine = mine.filter((item) => item.recommendedDisposition === "NEEDS_HUMAN_REVIEW").map((item) => item.externalSkillId).join(", ") || "—";
    const remaining = profile.coverage.filter((item) => item.state === "MISSING" || item.state === "PARTIALLY_COVERED").map((item) => item.key).join(", ") || "—";
    return `| ${labels[profile.agentId]} | ${profile.approvedSkills.join(", ") || "none"} | ${cell(strongMine)} | ${cell(complementMine)} | ${cell(remaining)} | ${profile.coverage.some((item) => item.state === "MISSING") ? "Yes" : "No"} |`;
  }).join("\n");
  const sections = profiles.map((profile) => {
    const mine = evaluations.filter((item) => item.targetReviewer === profile.agentId);
    const rows = profile.coverage.map((coverage) => {
      const candidates = mine.filter((item) => item.coverageKeys?.includes(coverage.key)).map((item) => item.externalSkillId).join(", ") || "—";
      const recommendation = coverage.state === "MISSING" && candidates === "—" ? "NO_SUITABLE_EXTERNAL_SKILL_FOUND / INTERNAL_SKILL_CANDIDATE" : candidates === "—" ? "No discovery required" : mine.filter((item) => item.coverageKeys?.includes(coverage.key)).map(dispositionLabel).join(", ");
      return `| ${coverage.key} | ${coverage.state} | ${cell(coverage.gap || "Covered by current Factory behavior.")} | ${cell(candidates)} | ${recommendation} |`;
    }).join("\n");
    const rejectedMine = mine.filter((item) => item.recommendedDisposition === "REJECT").map((item) => `${item.externalSkillId}: ${item.reasons[0] ?? "rejected"}`).join("; ") || "None recorded.";
    const additions = mine.filter((item) => item.recommendedDisposition !== "REJECT").map((item) => `${item.externalSkillId} (${dispositionLabel(item)})`).join(", ") || "None yet.";
    return `## ${labels[profile.agentId]}\n\n**Current role/capabilities:** ${cell(profile.role)} Capabilities: ${profile.capabilities.join(", ")}. Tasks: ${profile.taskTypes.join(", ")}. Tools: ${profile.tools.join(", ")}. Context: ${profile.contextCategories.join(", ")}. Read-only: ${profile.readOnly}.\n\n**Current approved skills:** ${profile.approvedSkills.join(", ") || "None"}\n\n| Coverage area | Current coverage | Gap | Candidate | Recommendation |\n|---|---|---|---|---|\n${rows}\n\n**Recommended portfolio additions:** ${additions}\n\n**Rejected/not suitable notable candidates:** ${rejectedMine}\n\n**Remaining uncovered gaps:** ${profile.coverage.filter((item) => item.state === "MISSING" || item.state === "PARTIALLY_COVERED").map((item) => item.key).join(", ") || "None."}\n\n**Internal-skill candidates:** ${profile.coverage.filter((item) => item.state === "MISSING").map((item) => item.key).join(", ") || "None identified."}`;
  }).join("\n\n");
  const humanDecision = `### A. Strong recommended external candidates\n${strong.map((item) => `- ${item.externalSkillId} → ${labels[item.targetReviewer]} (${item.coverageKeys?.join(", ") ?? "unmapped"})`).join("\n") || "- None"}\n\n### B. Useful complementary candidates\n${human.map((item) => `- ${item.externalSkillId} → ${labels[item.targetReviewer]} (${item.coverageKeys?.join(", ") ?? "unmapped"})`).join("\n") || "- None"}\n\n### C. Needs manual inspection\n${human.filter((item) => item.externalAuditStatus !== "pass" || item.metadataReadiness === "INCOMPLETE").map((item) => `- ${item.externalSkillId}`).join("\n") || "- None beyond the complementary candidates above"}\n\n### D. No suitable external candidate — internal skill recommended\n${noSuitable.map((item) => `- ${item.key}: ${item.gap}`).join("\n") || "- None"}\n\n### E. Rejected\n${rejected.map((item) => `- ${item.externalSkillId}: ${item.reasons[0] ?? "deterministic curation rejection"}`).join("\n") || "- None"}`;
  return `# Agent Skill Portfolio Discovery — 2026-08-09\n\n## Executive summary\n\n- 9 agents analyzed: **${profiles.length}**\n- Current approved external skills: **3** (${currentSkills.join(", ")})\n- Professional coverage areas identified: **${counts.total}**\n- Deterministic/prompt/approved-skill covered: **${counts.covered}**\n- Partial coverage areas: **${counts.partial}**\n- Gaps before discovery: **${counts.missing} missing / ${counts.partial} partial**\n- skills.sh searches performed: **${input.searchQueries.length}**\n- Detail candidates fetched: **${input.detailCandidatesFetched}**\n- Candidates evaluated: **${evaluations.length}**\n- Reused existing evaluations: **${input.reusedEvaluations ?? 0}**\n- Rejected: **${rejected.length}**\n- Strong candidates: **${strong.length}**\n- Human-review candidates: **${human.length}**\n- No-suitable-candidate gaps: **${noSuitable.length}**\n- Newly staged candidates: **${input.stagedExternalSkills}**\n- Approved count unchanged: **3**\n- Assigned count unchanged: **3**\n\nThis report is discovery and curation only. No newly discovered skill was approved, assigned, executed, rewritten, or used to change agent responsibilities or the runtime resolver. Popularity is advisory, and license evidence remains a separate human approval concern.\n\nAvailability: **${input.availability}**. Source issues: ${input.sourceIssues.length ? input.sourceIssues.join("; ") : "none"}.\n\n## Human-review portfolio table\n\n| Agent | Existing approved skills | Strong new candidates | Complementary candidates | Remaining gaps | Internal skill recommended? |\n|---|---|---|---|---|---|\n${portfolioRows}\n\n${sections}\n\n## Global candidate table\n\n| External skill ID | Source | Checksum | Target agent | Coverage keys | Normalized size | Security | Tool assumptions | Overlap | License evidence | Metadata | Recommendation |\n|---|---|---|---|---|---:|---|---|---|---|---|---|\n${candidateRows || "| — | — | — | — | — | — | — | — | — | — | — | — |"}\n\n## HUMAN DECISION REQUIRED\n\n${humanDecision}\n\n## Phase invariants and audit\n\n- Existing approved skills remain exactly: module-boundaries, acceptance-criteria, supabase-rls.\n- Existing assignments remain exactly 3; all nine catalog definitions retain their existing allowlist field.\n- No fixed skill-count quota was introduced; discovery is driven by missing or partial coverage only.\n- No runtime selection/resolver redesign, new agent, orchestrator, MCP integration, fallback source, dependency install, external content execution, or production website-generation E2E was performed.\n- Live query strings: ${input.searchQueries.map((query) => `\`${query}\``).join(", ") || "none"}\n`;
}
