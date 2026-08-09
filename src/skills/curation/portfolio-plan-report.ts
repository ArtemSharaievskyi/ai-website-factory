import type { PortfolioPlan } from "./portfolio-plan";

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderPortfolioPlanMarkdown(plan: PortfolioPlan) {
  const advance = plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_ADVANCE");
  const optional = plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_OPTIONAL");
  const rejected = plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation.startsWith("REJECT_"));
  const internalPreferred = plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "PREFER_INTERNAL_SKILL");
  const agentTable = plan.agents.map((agent) => [
    agent.agentId,
    agent.existingApprovedSkillIds.join(", ") || "none",
    agent.externalAdvanceCandidateIds.join(", ") || "none",
    agent.proposedInternalSkills.join(", ") || "none",
    agent.externalOptionalCandidateIds.join(", ") || "none",
    agent.remainingIntentionalGaps.join(", ") || "none",
    agent.completeness,
  ].map(cell).join(" | ")).map((row) => `| ${row} |`).join("\n");
  const advanceTable = advance.map((item) => `| ${[item.externalSkillId, item.targetAgents.join(", "), item.candidateChecksum, item.uniqueCoverageContribution, item.roleFit, item.localSecurity, item.toolAssumptions.join(", ") || "none", item.contextCost, item.overlap, `${item.licenseStatus}; ${item.metadataReadiness}`, item.rationale].map(cell).join(" | ")} |`).join("\n");
  const internalTable = plan.proposedInternalSkills.map((skill) => `| ${[skill.skillId, skill.targetAgents.join(", "), skill.coverageKeys.join(", "), skill.targetContextSize, skill.purpose, skill.expectedContribution].map(cell).join(" | ")} |`).join("\n");
  const rejectedTable = [...rejected, ...internalPreferred].map((item) => `| ${[item.externalSkillId, item.recommendation, item.rationale].map(cell).join(" | ")} |`).join("\n");
  const candidateDetails = plan.humanReviewCandidatesConsidered.map((item) => [
    `### ${item.externalSkillId}`,
    `- Final outcome: ${item.recommendation}`,
    `- Target/coverage: ${item.targetAgents.join(", ")} / ${item.coverageKeys.join(", ")}`,
    `- Checksum: ${item.candidateChecksum}; normalized content: ${item.normalizedContentBytes} bytes; estimated injection: ${item.estimatedInjectionBytes} bytes`,
    `- Role/security/tools/context/overlap: ${item.roleFit} / ${item.localSecurity} / ${item.toolAssumptions.join(", ") || "none"} / ${item.contextCost} / ${item.overlap}`,
    `- Purpose and procedure evidence: ${item.purposeProcedureEvidence}; license: ${item.licenseStatus}; metadata: ${item.metadataReadiness}`,
    `- Unique contribution: ${item.uniqueCoverageContribution}`,
    `- Decision: ${item.rationale}`,
  ].join("\n")).join("\n\n");
  const internalDetails = plan.proposedInternalSkills.map((skill) => [
    `### ${skill.skillId} — ${skill.title}`,
    `- Target agents/capabilities: ${skill.targetAgents.join(", ")} / ${skill.targetCapabilities.join(", ")}`,
    `- Coverage: ${skill.coverageKeys.join(", ")}; version: ${skill.version}; context target: ${skill.targetContextSize}`,
    `- Purpose: ${skill.purpose}`,
    `- Scope: ${skill.scope.join("; ")}`,
    `- Non-goals: ${skill.nonGoals.join("; ")}`,
    `- Prerequisites: ${skill.prerequisites.join("; ")}`,
    `- Procedure: ${skill.proceduralSteps.map((step, index) => `${index + 1}. ${step}`).join(" ")}`,
    `- Deterministic inputs: ${skill.deterministicInputs.join("; ")}`,
    `- Forbidden authority/tools: ${skill.forbiddenAuthorityTools.join("; ")}`,
    `- Expected contribution: ${skill.expectedContribution}`,
    `- Overlap/conflicts: ${skill.overlapNotes.join(" ") || "none"} / ${skill.conflictNotes.join(" ") || "none"}`,
    `- Future approval: ${skill.approvalRequirements.join("; ")}`,
    `- Provenance: ${skill.provenance}; ${skill.licenseStrategy}`,
  ].join("\n")).join("\n\n");
  const agentDetails = plan.agents.map((agent) => [
    `### ${agent.agentId}`,
    `- Coverage: ${agent.responsibilityCoverage.join(", ")}`,
    `- Planned portfolio: existing [${agent.existingApprovedSkillIds.join(", ") || "none"}], advance [${agent.externalAdvanceCandidateIds.join(", ") || "none"}], optional [${agent.externalOptionalCandidateIds.join(", ") || "none"}], internal [${agent.proposedInternalSkills.join(", ") || "none"}]`,
    `- Completeness: ${agent.completeness}; intentional gaps: ${agent.remainingIntentionalGaps.join(", ") || "none"}`,
    `- Rationale: ${agent.portfolioRationale}`,
  ].join("\n")).join("\n\n");
  return [
    "# Agent Skill Portfolio Plan — Phase 4D1 — 2026-08-09",
    "",
    "## Executive summary",
    "",
    `- 9 agents analyzed; 21 Phase 4C human-review candidates considered.`,
    `- EXTERNAL_ADVANCE: ${advance.length}; EXTERNAL_OPTIONAL: ${optional.length}; rejected after consolidation: ${rejected.length}; PREFER_INTERNAL_SKILL: ${internalPreferred.length}.`,
    `- Proposed internal skills: ${plan.proposedInternalSkills.length}. Current approved external: 3. Current assigned external: 3.`,
    `- PORTFOLIO_PLANNED_COMPLETE agents: ${plan.agents.filter((agent) => agent.completeness === "PORTFOLIO_PLANNED_COMPLETE").length}; unresolved gaps: ${plan.agents.flatMap((agent) => agent.remainingIntentionalGaps).length}.`,
    "",
    "This is a consolidation/specification artifact. It performs no discovery, approval, assignment, license research, runtime activation, or website E2E. Internal skills are proposed versioned artifacts, not trusted prompt snippets or registry entries.",
    "",
    "## Final agent portfolio table",
    "",
    "| Agent | Current approved | External advance | Proposed internal | Optional | Remaining gaps | Planned complete? |",
    "|---|---|---|---|---|---|---|",
    agentTable,
    "",
    "## EXTERNAL_ADVANCE table",
    "",
    "Every advance candidate still lacks required license and metadata evidence. Phase 4D2 must complete exact evidence and request explicit approval.",
    "",
    "| External ID | Target | Checksum | Unique contribution | Role fit | Security | Tool assumptions | Context | Overlap | Evidence status | Why external |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    advanceTable,
    "",
    "## Proposed internal skill specification table",
    "",
    "| Skill ID | Target agents | Coverage | Context target | Purpose | Expected contribution |",
    "|---|---|---|---|---|---|",
    internalTable,
    "",
    internalDetails,
    "",
    "## Per-agent plans",
    "",
    agentDetails,
    "",
    "## Candidates not advancing",
    "",
    "| External ID | Final outcome | Consolidation reason |",
    "|---|---|---|",
    rejectedTable,
    "",
    "## Complete candidate accounting",
    "",
    candidateDetails,
    "",
    "## Portfolio decisions and invariants",
    "",
    "- requirements-evidence-traceability is intentionally shared by Contract Auditor and Test / Quality Reviewer with role-specific output obligations; other procedures remain role-specific.",
    "- Deterministic validation remains outside skills; no incremental-validation-loop or monolithic factory-development skill is proposed.",
    "- Internal skills will use the same source → typed metadata → deterministic validation → checksum → registry → explicit approval → resolver path as external skills.",
    "- Internal provenance is project-owned; no third-party license is asserted.",
    "- All reviewer specifications are read-only and grant no tools.",
    "- New skills.sh searches: 0. New approvals: 0. New assignments: 0. Approved internal: 0. Assigned internal: 0.",
    "- Existing approved checksums, all nine allowlists, and the runtime resolver remain unchanged.",
    "- External content was not executed, licenses were not fetched, and no new agent, orchestrator, MCP integration, or production website-generation E2E was added or run.",
    "",
  ].join("\n");
}
