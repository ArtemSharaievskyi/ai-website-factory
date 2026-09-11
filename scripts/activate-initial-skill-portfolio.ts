import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentCatalog } from "@/agents/catalog";
import { ExternalAdvanceEvidenceArtifactSchema } from "@/skills/curation/external-advance-evidence";
import { InternalSkillEvidenceArtifactSchema } from "@/skills/curation/internal-skill-evidence";
import { InitialPortfolioLicenseDecisionArtifactSchema } from "@/skills/curation/initial-portfolio-policy";
import { buildActiveAgentSkillPortfolio, type ActiveAgentSkillPortfolio } from "@/skills/curation/active-portfolio";
import { SkillRegistry } from "@/skills/registry/registry";
import { readFile as readText } from "node:fs/promises";

const root = process.cwd();
const skillsRoot = path.join(root, "skills");
const registryRoot = path.join(skillsRoot, "registry");
const policyPath = path.join(root, "docs/admin/skill-curation/initial-portfolio-license-decisions-2026-08-09.json");
const externalEvidencePath = path.join(root, "docs/admin/skill-curation/external-advance-evidence-2026-08-09.json");
const internalEvidencePath = path.join(root, "docs/admin/skill-curation/internal-skill-evidence-2026-08-09.json");
const snapshotPath = path.join(root, "docs/admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json");
const reportPath = path.join(root, "docs/admin/active-agent-skill-portfolio-2026-08-09.md");
const reviewedAt = "2026-08-09T00:00:00.000Z";

type ApprovalConfig = {
  role: "lead" | "planner-architect" | "design" | "implementation" | "review";
  taskType: "clarify-requirements" | "create-requirements-spec" | "create-technical-architecture" | "create-design-directions" | "implement-frontend" | "implement-backend" | "review-architecture" | "review-contracts" | "review-code-integration" | "review-security" | "review-test-quality";
  capabilities?: string[];
  capability?: string;
  taskTypes?: ApprovalConfig["taskType"][];
  coverageKeys: string[];
  projectSurfaces: string[];
  priority: number;
  allowedTaskTypes?: ApprovalConfig["taskType"][];
};

const CONFIGS: Record<string, ApprovalConfig> = {
  "lead-requirements-completeness": { role: "lead", taskType: "clarify-requirements", coverageKeys: ["requirements-completeness"], projectSurfaces: ["requirements", "clarification"], priority: 100, allowedTaskTypes: ["clarify-requirements", "create-requirements-spec"] as ApprovalConfig["taskType"][] },
  "project-data-model-planning": { role: "planner-architect", taskType: "create-technical-architecture", coverageKeys: ["data-model-planning"], projectSurfaces: ["data", "database", "schema"], priority: 100 },
  "technical-risk-planning": { role: "planner-architect", taskType: "create-technical-architecture", coverageKeys: ["technical-risk-planning"], projectSurfaces: ["architecture", "risk", "integrations"], priority: 90 },
  "responsive-form-ux-design": { role: "design", taskType: "create-design-directions", coverageKeys: ["responsive-form-ux"], projectSurfaces: ["responsive", "forms", "mobile"], priority: 100 },
  "nextjs-server-client-implementation": { role: "implementation", taskType: "implement-frontend", coverageKeys: ["nextjs-implementation", "server-client-boundaries"], projectSurfaces: ["nextjs", "app-router", "server", "client", "page"], priority: 100 },
  "typed-form-implementation": { role: "implementation", taskType: "implement-frontend", coverageKeys: ["forms-validation"], projectSurfaces: ["forms", "validation", "typed"], priority: 100 },
  "supabase-application-integration": { role: "implementation", capability: "implementation.backend", taskType: "implement-backend", coverageKeys: ["supabase-implementation"], projectSurfaces: ["supabase", "postgres", "auth", "storage", "database"], priority: 100 },
  "maintainable-performance-implementation": { role: "implementation", taskType: "implement-frontend", coverageKeys: ["maintainability-performance"], projectSurfaces: ["performance", "maintenance", "refactor", "implementation"], priority: 90 },
  "architecture-tradeoff-review": { role: "review", taskType: "review-architecture", coverageKeys: ["architecture-tradeoffs"], projectSurfaces: ["architecture", "modules", "components"], priority: 80 },
  "requirements-evidence-traceability": { role: "review", taskType: "review-contracts", capabilities: ["review.contracts", "review.test-quality"], taskTypes: ["review-contracts", "review-test-quality"], coverageKeys: ["requirements-traceability", "cross-stage-consistency", "traceability-evidence"], projectSurfaces: ["requirements", "contracts", "traceability", "tests", "behavior"], priority: 90, allowedTaskTypes: ["review-contracts", "review-test-quality"] },
  "react-nextjs-integration-review": { role: "review", capability: "review.integration", taskType: "review-code-integration", coverageKeys: ["react-review", "nextjs-review"], projectSurfaces: ["react", "nextjs", "components", "routes", "forms"], priority: 100 },
  "auth-storage-security-review": { role: "review", capability: "review.security", taskType: "review-security", coverageKeys: ["auth-security", "storage-upload-security"], projectSurfaces: ["auth", "storage", "uploads", "sessions", "ownership"], priority: 90 },
  "behavioral-test-quality-review": { role: "review", capability: "review.test-quality", taskType: "review-test-quality", coverageKeys: ["test-strategy", "meaningful-assertions", "playwright-quality"], projectSurfaces: ["tests", "behavior", "forms", "auth", "persistence"], priority: 80 },
  "review-maintainability-d9faf7cb9775": { role: "review", taskType: "review-architecture", coverageKeys: ["maintainability-review", "evolution-maintainability"], projectSurfaces: ["architecture", "modules", "components", "maintenance"], priority: 90 },
};

const existingConfigs: Record<string, ApprovalConfig> = {
  "module-boundaries-fb20497b5c35": { role: "review", taskType: "review-architecture", coverageKeys: ["module-boundaries", "architecture-review"], projectSurfaces: ["architecture", "modules", "components"], priority: 100 },
  "acceptance-criteria-80493e317476": { role: "review", taskType: "review-contracts", coverageKeys: ["acceptance-criteria", "requirements-contracts", "traceability"], projectSurfaces: ["requirements", "contracts", "traceability"], priority: 100 },
  "supabase-rls-1e36b217c969": { role: "review", taskType: "review-security", coverageKeys: ["supabase-rls", "rls-review"], projectSurfaces: ["supabase", "postgres", "rls", "database"], priority: 100 },
};

async function json<T>(filePath: string) { return JSON.parse(await readFile(filePath, "utf8")) as T; }

async function registryRecordIds() {
  const records = new Map<string, { id: string; externalSkillId?: string }>();
  for (const file of await readdir(registryRoot)) {
    if (!file.endsWith(".json") || file.startsWith("audit") || file.startsWith("idempotency")) continue;
    const value = await json<{ definition?: { id?: string }; source?: { externalSkillId?: string } }>(path.join(registryRoot, file));
    if (value.definition?.id) records.set(value.definition.id, { id: value.definition.id, externalSkillId: value.source?.externalSkillId });
  }
  return records;
}

function configFor(skillId: string): ApprovalConfig {
  const config = CONFIGS[skillId] ?? existingConfigs[skillId];
  if (!config) throw new Error(`No Phase 4D4 approval configuration exists for ${skillId}.`);
  return config;
}

function approvalInput(skillId: string, checksum: string, version: string, config: ApprovalConfig) {
  return {
    id: `approval-phase4d4-${skillId}`,
    reviewedBy: "phase-4d4-human-approved-portfolio",
    reviewedAt,
    decision: "approved" as const,
    candidateChecksum: checksum,
    approvedVersion: version,
    approvedCommit: "phase-4d4-human-approved-portfolio",
    allowedRoles: [config.role],
    allowedTaskTypes: config.allowedTaskTypes ?? [config.taskType],
    allowedTools: [],
    deniedTools: [],
    allowedCommandPatterns: [],
    deniedCommandPatterns: [],
    notes: "Explicit Phase 4D4 human approval; procedural context grants no tools or workflow authority.",
    applicability: {
      capability: config.capability ?? config.capabilities?.[0] ?? (config.role === "lead" ? "requirements.clarify" : config.role === "planner-architect" ? "planning.architecture" : config.role === "design" ? "design.directions" : config.role === "implementation" ? "implementation.code" : "review.architecture"),
      ...(config.capabilities ? { capabilities: config.capabilities } : {}),
      taskType: config.taskType,
      ...(config.taskTypes ? { taskTypes: config.taskTypes } : {}),
      coverageKeys: config.coverageKeys,
      projectSurfaces: config.projectSurfaces,
      conflictsWithSkillIds: [],
      overlapsWithSkillIds: [],
      priority: config.priority,
    },
  };
}

type CurationEvidenceInput = Parameters<SkillRegistry["recordCurationEvidence"]>[1]["evidence"];

async function activate(registry: SkillRegistry, skillId: string, checksum: string, version: string, config: ApprovalConfig, internal: boolean, externalEvidence?: CurationEvidenceInput, recordIds?: Map<string, { id: string; externalSkillId?: string }>) {
  const runtime = await registry.getRuntimeMetadata(skillId);
  if (runtime.definition.status === "approved") {
    if (!runtime.approval || runtime.approval.decision !== "approved" || runtime.approval.candidateChecksum !== checksum || runtime.approval.approvedVersion !== version || runtime.approval.allowedTools.length !== 0)
      throw new Error(`Approved ${skillId} does not match the exact Phase 4D4 binding.`);
    try {
      await registry.load({ skillId, role: config.role, taskType: config.taskType, requestedFiles: ["SKILL.md"], requestedTools: [], contextBudgetBytes: 120_000 });
    } catch (error) {
      if ((error as { code?: string }).code !== "SKILL_NOT_APPROVED") throw error;
      await registry.promoteApproved(skillId);
    }
    return;
  }
  if (internal) {
    await registry.recordInternalApprovalEvidence(skillId, { version, normalizedContentChecksum: checksum, provenance: "ai-website-factory-project-owned" });
  } else {
    if (!externalEvidence || !recordIds) throw new Error(`Missing external evidence for ${skillId}.`);
    const record = recordIds.get(skillId);
    if (!record) throw new Error(`Missing selected external registry record ${skillId}.`);
    await registry.recordCurationEvidence(skillId, { evidence: externalEvidence, expectedExternalSkillId: record.externalSkillId ?? "", expectedNormalizedChecksum: checksum, expectedSourceRepository: "bradyhazell/brady-plugins" });
  }
  await registry.createApproval(skillId, approvalInput(skillId, checksum, version, config));
  await registry.promoteApproved(skillId);
}

function renderReport(snapshot: ActiveAgentSkillPortfolio) {
  const lines = ["# Active Agent Skill Portfolio - Phase 4D4 - 2026-08-09", "", "## Executive summary", "", `- Approved artifacts: **${snapshot.totalApprovedSkillArtifacts}** (${snapshot.approvedExternalSkillCount} external, ${snapshot.approvedInternalSkillCount} internal).`, `- Active assignment references: **${snapshot.uniqueActiveAssignmentReferenceCount}** across all **${snapshot.agents.length}** agents; shared traceability remains one artifact.`, "- Runtime resolution is local, checksum-bound, deterministic, and tool-neutral.", "- Deferred external candidates remain inactive and available only for future reconsideration.", "", "## Active portfolios", "", "| Agent | Active approved skills | Source mix | Coverage |", "|---|---|---|---|"];
  for (const agent of snapshot.agents) lines.push(`| ${agent.agentId} | ${agent.approvedAllowedSkillIds.join(", ")} | ${agent.skills.map((skill) => `${skill.skillId} (${skill.sourceType})`).join("; ")} | ${[...new Set(agent.skills.flatMap((skill) => skill.coverageKeys))].join(", ")} |`);
  lines.push("", "## Deferred candidates", "", "| External skill | Decision | Reason | Runtime eligible |", "|---|---|---|---|");
  for (const candidate of snapshot.deferredCandidates) lines.push(`| ${candidate.externalSkillId} | ${candidate.decision} | ${candidate.reason} | no |`);
  lines.push("", "## Activation invariants", "", "- Exact checksums and versions were verified before each approval.", "- All approval records grant zero tools; reviewer procedures remain read-only by role and content contract.", "- No skills.sh discovery, network call, Vercel token, new agent, orchestrator, MCP integration, or resolver redesign was used.", "");
  return lines.join("\n");
}

async function main() {
  const policy = InitialPortfolioLicenseDecisionArtifactSchema.parse(await json<unknown>(policyPath));
  const externalArtifact = ExternalAdvanceEvidenceArtifactSchema.parse(await json<unknown>(externalEvidencePath));
  const internalArtifact = InternalSkillEvidenceArtifactSchema.parse(await json<unknown>(internalEvidencePath));
  const selected = policy.candidates.filter((candidate) => candidate.phase4d35Decision === "SELECTED_FOR_PHASE_4D4_APPROVAL");
  const internalCandidates = internalArtifact.candidates.filter((candidate) => candidate.approvalReadiness === "APPROVAL_ELIGIBLE");
  if (selected.length !== 1 || internalCandidates.length !== 13 || policy.phase4d4ApprovalPreview.totalArtifacts !== 14) throw new Error("Phase 4D4 approval set is not the exact human-approved 1 + 13 set.");
  const requiredFoundationAgents = ["lead", "planner", "design", "implementation", "architecture-reviewer", "contract-auditor", "code-integration-reviewer", "security-reviewer", "test-quality-reviewer"];
  if (requiredFoundationAgents.some((agentId) => !agentCatalog.some((agent) => agent.agentId === agentId))) throw new Error("The authoritative agent catalog is missing a foundation agent.");
  const selectedExternal = selected[0];
  const externalCandidate = externalArtifact.candidates.find((candidate) => candidate.externalSkillId === selectedExternal.externalSkillId);
  if (!externalCandidate || externalCandidate.candidateChecksum !== selectedExternal.checksum || externalCandidate.staticSecurity.status !== "PASS" || externalCandidate.evaluation.overlapAssessment !== "low") throw new Error("Selected external evidence is incomplete or changed.");
  const records = await registryRecordIds();
  const selectedRecord = records.get(externalCandidate.stagedSkillId);
  if (!selectedRecord || selectedRecord.externalSkillId !== selectedExternal.externalSkillId) throw new Error("Selected external registry identity is not exact.");
  const registry = new SkillRegistry(skillsRoot);
  const selectedMetadata = { purpose: externalCandidate.purposeEvidence.reference, steps: externalCandidate.stepsEvidence, unresolved: [] as never[] };
  await activate(registry, externalCandidate.stagedSkillId, selectedExternal.checksum, (await registry.getRuntimeMetadata(externalCandidate.stagedSkillId)).definition.version, configFor("review-maintainability-d9faf7cb9775"), false, { license: externalCandidate.licenseEvidence, metadata: selectedMetadata }, records);
  for (const candidate of internalCandidates) {
    const content = (await readText(path.join(root, candidate.contentPath), "utf8")).replace(/\r\n?/g, "\n");
    const expected = candidate.checksum;
    const { canonicalInternalSkillChecksum } = await import("@/skills/curation/internal-skill-evidence");
    if (canonicalInternalSkillChecksum(candidate.skillId, candidate.version, content) !== expected) throw new Error(`Canonical internal checksum changed for ${candidate.skillId}.`);
    await activate(registry, candidate.skillId, expected, candidate.version, configFor(candidate.skillId), true);
  }
  const agents = [];
  for (const agent of agentCatalog) {
    const skills = [];
    for (const skillId of agent.allowedSkillIds) {
      const runtime = await registry.getRuntimeMetadata(skillId);
      if (runtime.definition.status !== "approved" || !runtime.approval || !runtime.normalizedContentChecksum || !runtime.definition.applicability) throw new Error(`Active catalog skill ${skillId} is not runtime-approved.`);
      skills.push({ skillId, sourceType: runtime.definition.sourceType === "internal" ? "internal" as const : "skills-sh" as const, version: runtime.definition.version, normalizedContentChecksum: runtime.normalizedContentChecksum, coverageKeys: runtime.definition.applicability.coverageKeys, assignmentState: "ACTIVE_APPROVED" as const });
    }
    agents.push({ agentId: agent.agentId, approvedAllowedSkillIds: [...agent.allowedSkillIds], skills });
  }
  const deferredCandidates = policy.candidates.filter((candidate) => candidate.phase4d35Decision !== "SELECTED_FOR_PHASE_4D4_APPROVAL").map((candidate) => ({ externalSkillId: candidate.externalSkillId, candidateChecksum: candidate.checksum, targetAgent: candidate.targetAgent, decision: candidate.phase4d35Decision as "DEFERRED_FROM_INITIAL_PORTFOLIO" | "NOT_SELECTED_INITIAL_PORTFOLIO", reason: candidate.decisionReason, futureReconsiderationAllowed: true as const, runtimeResolvable: false as const }));
  const snapshot = buildActiveAgentSkillPortfolio({ schemaVersion: 1, phase: "4D4", generatedAt: policy.generatedAt, sourceOfTruth: "docs/admin/skill-curation/initial-portfolio-license-decisions-2026-08-09.json", approvedExternalSkillCount: 4, approvedInternalSkillCount: 13, totalApprovedSkillArtifacts: 17, uniqueActiveAssignmentReferenceCount: 18, agents, deferredCandidates, skillCountQuotaIntroduced: false, approvalCalled: true, assignmentsChanged: true, networkCalls: 0, vercelOidcTokenRequired: false, runtimeResolverRedesigned: false });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(snapshot), "utf8");
  console.log(JSON.stringify({ approvedExternal: 4, approvedInternal: 13, totalApproved: 17, activeAssignmentReferences: 18, agents: 9, networkCalls: 0, snapshotPath, reportPath }));
}

void main();
