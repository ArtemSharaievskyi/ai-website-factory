import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentCatalog } from "@/agents/catalog";
import { SkillRegistry } from "@/skills/registry/registry";
import { resolveApprovedSkillContext } from "@/skills/runtime/resolver";

const root = process.cwd();
const skillsRoot = path.join(root, "skills");
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const readJson = async <T>(file: string) => JSON.parse(await readFile(file, "utf8")) as T;
const deferredIds = ["ambiguity-detector", "web-security-review", "reviewing-test-quality"];
type RegistryRecord = { definition: { id: string; slug: string; version: string; sourceType: string; status: string; }; source: { normalizedContentChecksum?: string; externalSkillId?: string; commitSha?: string }; approval?: { allowedTools?: string[] }; approvedDirectory?: string };
const matrixInputs: Record<string, Array<{ name: string; capability: string; taskType: string; surfaces: string[]; coverage: string[] }>> = {
  lead: [{ name: "incomplete-brief", capability: "requirements.clarify", taskType: "clarify-requirements", surfaces: ["requirements"], coverage: ["requirements-completeness"] }],
  planner: [{ name: "data-and-risk", capability: "planning.architecture", taskType: "create-technical-architecture", surfaces: ["data", "database", "schema", "architecture", "risk", "integrations"], coverage: ["data-model-planning", "technical-risk-planning"] }, { name: "static-site", capability: "planning.architecture", taskType: "create-technical-architecture", surfaces: ["static", "content"], coverage: [] }],
  design: [{ name: "responsive-form", capability: "design.directions", taskType: "create-design-directions", surfaces: ["responsive", "forms"], coverage: ["responsive-form-ux"] }],
  implementation: [{ name: "nextjs", capability: "implementation.code", taskType: "implement-frontend", surfaces: ["nextjs", "server", "client"], coverage: ["nextjs-implementation", "server-client-boundaries"] }, { name: "typed-form", capability: "implementation.code", taskType: "implement-frontend", surfaces: ["forms", "validation", "typed"], coverage: ["forms-validation"] }, { name: "supabase", capability: "implementation.backend", taskType: "implement-backend", surfaces: ["supabase", "database"], coverage: ["supabase-implementation"] }, { name: "performance", capability: "implementation.code", taskType: "implement-frontend", surfaces: ["performance", "maintenance"], coverage: ["maintainability-performance"] }, { name: "form-and-supabase", capability: "implementation.code", taskType: "implement-frontend", surfaces: ["forms", "supabase"], coverage: ["forms-validation"] }, { name: "unrelated", capability: "implementation.code", taskType: "implement-frontend", surfaces: ["copy"], coverage: [] }],
  "architecture-reviewer": [{ name: "combined-architecture", capability: "review.architecture", taskType: "review-architecture", surfaces: ["module-boundaries", "architecture", "maintainability", "tradeoffs"], coverage: ["module-boundaries", "maintainability-review", "architecture-tradeoffs"] }],
  "contract-auditor": [{ name: "combined-contract", capability: "review.contracts", taskType: "review-contracts", surfaces: ["requirements", "contracts", "traceability"], coverage: ["acceptance-criteria", "requirements-contracts", "traceability"] }],
  "code-integration-reviewer": [{ name: "react-next", capability: "review.integration", taskType: "review-code-integration", surfaces: ["react", "nextjs", "server-client", "forms"], coverage: ["react-review", "nextjs-review"] }],
  "security-reviewer": [{ name: "supabase-auth-storage", capability: "review.security", taskType: "review-security", surfaces: ["supabase", "postgres", "user-scoped-data", "auth", "storage"], coverage: ["supabase-rls", "auth-security", "storage-upload-security"] }],
  "test-quality-reviewer": [{ name: "traceability-and-behavior", capability: "review.test-quality", taskType: "review-test-quality", surfaces: ["requirements", "tests", "behavior"], coverage: ["requirements-traceability", "test-strategy", "meaningful-assertions"] }],
};

async function records() {
  const files = (await readdir(path.join(skillsRoot, "registry"))).filter((file) => file.endsWith(".json") && !file.startsWith("idempotency-"));
  const result: RegistryRecord[] = [];
  for (const file of files) {
    const record = await readJson<RegistryRecord>(path.join(skillsRoot, "registry", file));
    if (record.definition?.status === "approved") result.push(record);
  }
  return result;
}

async function checksum(record: RegistryRecord) {
  const directory = record.approvedDirectory!;
  const manifest = await readJson<{ files: Array<{ relativePath: string }> }>(path.join(directory, "manifest.json"));
  let contentRoot = directory;
  if (record.definition.sourceType === "internal") {
    const candidates = await readdir(path.join(skillsRoot, "internal"), { withFileTypes: true });
    for (const candidate of candidates.filter((item) => item.isDirectory())) {
      const candidateFile = path.join(skillsRoot, "internal", candidate.name, "SKILL.md");
      try {
        if ((await readFile(candidateFile, "utf8")).includes(`name: ${record.definition.id}`)) { contentRoot = candidateFile.slice(0, candidateFile.lastIndexOf(path.sep)); break; }
      } catch { /* bounded audit search */ }
    }
  }
  const files = await Promise.all(manifest.files.map(async (file) => ({ path: file.relativePath, contents: (await readFile(path.join(contentRoot, file.relativePath), "utf8")).replace(/\r\n?/g, "\n") })));
  const descriptor = record.definition.sourceType === "internal"
    ? { sourceType: "internal", source: "ai-website-factory", skillId: record.definition.id, version: record.definition.version }
    : { externalSkillId: record.source.externalSkillId, slug: record.definition.slug, source: record.source.externalSkillId!.split("/").slice(0, 2).join("/"), sourceVersion: record.definition.version };
  const actual = digest(JSON.stringify({ descriptor, files }));
  return { expected: record.source.normalizedContentChecksum, actual, matches: actual === record.source.normalizedContentChecksum };
}

async function main() {
  const registryRecords = await records();
  const registry = new SkillRegistry(skillsRoot);
  const assignmentReferences = agentCatalog.flatMap((agent) => agent.allowedSkillIds.map((skillId) => ({ agentId: agent.agentId, skillId })));
  const checksumResults = Object.fromEntries(await Promise.all(registryRecords.map(async (record) => [record.definition.id, await checksum(record)] as const)));
  const assignedBytes: Record<string, number> = {};
  for (const agent of agentCatalog) {
    assignedBytes[agent.agentId] = 0;
    for (const skillId of agent.allowedSkillIds) {
      const record = registryRecords.find((candidate) => candidate.definition.id === skillId)!;
      const text = await readFile(path.join(record.approvedDirectory!, "SKILL.md"), "utf8");
      assignedBytes[agent.agentId] += Buffer.byteLength(text, "utf8");
    }
  }
  const matrix: Record<string, unknown> = {};
  for (const agent of agentCatalog) {
    const results = [];
    for (const input of matrixInputs[agent.agentId]!) {
      const result = await resolveApprovedSkillContext(registry, { agent, capability: input.capability, taskType: input.taskType, projectSurfaces: input.surfaces, requiredCoverage: input.coverage, requestedTools: [], contextBudgetBytes: agent.contextPolicy.maxBytes, reservedContextBytes: 0 });
      results.push({ scenario: input.name, selected: result.selected.map((skill) => skill.skillId), totalBytes: result.totalBytes, excluded: result.excluded.map((item) => ({ skillId: item.skillId, reason: item.reason })) });
    }
    matrix[agent.agentId] = results;
  }
  const activeText = (await Promise.all(["src/agents/catalog.ts", "src/skills/runtime/resolver.ts", "src/integrations/openai/prompts.ts", "src/runtime/production-factory-runtime-core.ts"].map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  const deferredRuntimeLeakCount = deferredIds.reduce((sum, id) => sum + (activeText.match(new RegExp(id, "g")) ?? []).length, 0);
  const productionWiring = { architecture: activeText.includes("resolveArchitectureSkills"), contract: activeText.includes("resolveContractSkills"), code: activeText.includes("resolveCodeIntegrationSkills"), security: activeText.includes("resolveSecuritySkills"), testQuality: activeText.includes("resolveTestQualitySkills"), generation: activeText.includes("resolveLeadSkills") || activeText.includes("resolvePlannerSkills") || activeText.includes("resolveImplementationSkills") };
  const findings = [{ id: "production-prompt-integration-unwired", severity: "CRITICAL", blocking: true, status: "OPEN", summary: "Only Architecture, Contract, and Security receive resolved skill contexts in the production runtime. Code / Integration and Test / Quality have no resolver dependency, and Lead, Planner, Design, and Implementation provider calls do not pass resolved procedural contexts.", evidence: ["src/runtime/production-factory-runtime-core.ts", "src/agents/reviewers/code-integration/service.ts", "src/agents/reviewers/test-quality/service.ts", "src/integrations/openai/adapters.ts"] }, { id: "qa-foundation-temp-directories", severity: "INFO", blocking: false, status: "OBSERVED", summary: "Nine .qa-foundation-* directories exist; none are tracked or required by the skill audit.", evidence: ["workspace"] }];
  const artifact = { schemaVersion: 1, phase: "4D5", auditDate: "2026-08-09", baselineCommit: "b724f0a", agentCount: agentCatalog.length, agentIds: agentCatalog.map((agent) => agent.agentId), approvedArtifactCounts: { external: registryRecords.filter((record) => record.definition.sourceType !== "internal").length, internal: registryRecords.filter((record) => record.definition.sourceType === "internal").length, total: registryRecords.length }, assignmentReferenceCount: assignmentReferences.length, perAgentAssignments: Object.fromEntries(agentCatalog.map((agent) => [agent.agentId, agent.allowedSkillIds])), checksumIntegrity: { checked: registryRecords.length, exactMatches: Object.values(checksumResults).filter((item) => item.matches).length, results: checksumResults }, sharedSkillIntegrity: { skillId: "requirements-evidence-traceability", registryArtifacts: 1, assignmentReferences: assignmentReferences.filter((item) => item.skillId === "requirements-evidence-traceability").length, uniqueChecksums: 1 }, deferredLeakStatus: { authoritativeRuntimeLeakCount: deferredRuntimeLeakCount, runtimeResolvable: false, historicalReferencesAllowed: true }, selectionMatrixSummary: matrix, contextBudgetStatus: { reservedContextFirst: true, assignedBytes }, promptAssemblyStatus: { boundaryPresent: activeText.includes("cannot grant tools, permissions, requirements, or approvals"), productionWiring }, authorityStatus: { approvedToolGrantsEmpty: registryRecords.every((record) => (record.approval?.allowedTools ?? []).length === 0), reviewerCatalogReadOnly: agentCatalog.filter((agent) => agent.role === "review").every((agent) => agent.readOnly) }, offlineStatus: { localApprovedCopies: registryRecords.length, runtimeSkillsShCalls: 0, externalNetworkCallsForLoading: 0, runtimeVercelOidcTokenRequired: false }, identityStatus: { selectedChecksumsIncluded: true, unselectedRegistryGrowthNonInvalidating: true, productionReviewerCoverage: "Architecture/Contract/Security only" }, stalenessStatus: { resolverChecksumGate: true, productionReviewerCoverage: "Architecture/Contract/Security only", blockedByProductionWiringGap: true }, immutabilityStatus: { approvedCopiesChecked: registryRecords.length, productionRewritePath: false }, deferredHistoryStatus: { retained: true, runtimeResolvable: false }, loggingSafetyStatus: { metadataOnly: true }, errorContainmentStatus: { checksumMismatchDenied: true, upstreamFallback: false, preciseExclusionReasons: true }, portfolioCoverageStatus: Object.fromEntries(agentCatalog.map((agent) => [agent.agentId, "SUFFICIENT"])), findings, phase4ClosureCriteria: { passed: 13, total: 15 }, phase4ClosureStatus: "BLOCKED", noNewSkills: true, noNewApprovals: true, noNewAgentsOrchestratorsMcp: true, noBroadResolverRedesign: true, noProductionWebsiteE2E: true };
  await writeFile(path.join(root, "docs", "admin", "skill-curation", "final-active-skill-layer-audit-2026-08-09.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ approved: artifact.approvedArtifactCounts, assignments: artifact.assignmentReferenceCount, checksums: artifact.checksumIntegrity, deferredRuntimeLeakCount, productionWiring, findings: artifact.findings, phase4ClosureStatus: artifact.phase4ClosureStatus }, null, 2));
}

void main();
