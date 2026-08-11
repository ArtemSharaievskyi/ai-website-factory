import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentCatalog } from "@/agents/catalog";
import { SkillRegistry } from "@/skills/registry/registry";
import { resolveApprovedSkillContext } from "@/skills/runtime/resolver";
import { ActiveAgentSkillPortfolioSchema } from "./active-portfolio";

const root = process.cwd();
const registryRoot = path.join(root, "skills", "registry");
const snapshotPath = path.join(root, "docs/admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json");
const readSnapshot = async () => ActiveAgentSkillPortfolioSchema.parse(JSON.parse(await readFile(snapshotPath, "utf8")));
const registry = () => new SkillRegistry(path.join(root, "skills"));

describe("Phase 4D4 active skill portfolios", () => {
  it("records exactly four external, thirteen internal, and seventeen unique approved artifacts", async () => {
    const snapshot = await readSnapshot();
    const ids = snapshot.agents.flatMap((agent) => agent.approvedAllowedSkillIds);
    expect(new Set(ids).size).toBe(17);
    expect(snapshot.approvedExternalSkillCount).toBe(4);
    expect(snapshot.approvedInternalSkillCount).toBe(13);
    expect(snapshot.uniqueActiveAssignmentReferenceCount).toBe(18);
  });

  it("binds the selected external and every internal artifact to exact runtime checksums", async () => {
    const snapshot = await readSnapshot();
    const active = snapshot.agents.flatMap((agent) => agent.skills);
    expect(active.find((skill) => skill.skillId === "review-maintainability-d9faf7cb9775")?.normalizedContentChecksum).toBe("4d178cfce7746577253c9addcb2648ceb1c5d3237ff32357a0b382df019ca7f9");
    for (const skill of active.filter((item) => item.sourceType === "internal")) expect(skill.version).toBe("1.0.0");
    expect(new Set(active.map((skill) => skill.normalizedContentChecksum)).size).toBe(17);
  });

  it("blocks wrong external and internal approval checksums", async () => {
    const reg = registry();
    await expect(reg.createApproval("review-maintainability-d9faf7cb9775", { id: "wrong-external", reviewedBy: "test", reviewedAt: "2026-08-09T00:00:00.000Z", decision: "approved", candidateChecksum: "a".repeat(64), approvedVersion: "d26c1019611c7b73eff40c72e4d25d814c00791cadf3b790e55733f6612ffe56", allowedRoles: ["review"], allowedTaskTypes: ["review-architecture"], allowedTools: [], deniedTools: [], allowedCommandPatterns: [], deniedCommandPatterns: [], notes: "test" })).rejects.toMatchObject({ code: "SKILL_CHECKSUM_MISMATCH" });
    await expect(reg.createApproval("lead-requirements-completeness", { id: "wrong-internal", reviewedBy: "test", reviewedAt: "2026-08-09T00:00:00.000Z", decision: "approved", candidateChecksum: "b".repeat(64), approvedVersion: "1.0.0", allowedRoles: ["lead"], allowedTaskTypes: ["clarify-requirements"], allowedTools: [], deniedTools: [], allowedCommandPatterns: [], deniedCommandPatterns: [], notes: "test" })).rejects.toMatchObject({ code: "SKILL_CHECKSUM_MISMATCH" });
  });

  it("requires a new exact first-party approval for changed internal version/content", async () => {
    await expect(registry().recordInternalApprovalEvidence("lead-requirements-completeness", { version: "2.0.0", normalizedContentChecksum: "c".repeat(64), provenance: "ai-website-factory-project-owned" })).rejects.toMatchObject({ code: "SKILL_SOURCE_INVALID" });
    await expect(registry().recordInternalApprovalEvidence("lead-requirements-completeness", { version: "1.0.0", normalizedContentChecksum: "c".repeat(64), provenance: "ai-website-factory-project-owned" })).rejects.toMatchObject({ code: "SKILL_CHECKSUM_MISMATCH" });
  });

  it("keeps the exact nine-agent catalog portfolios and shared traceability identity", async () => {
    const snapshot = await readSnapshot();
    expect(agentCatalog).toHaveLength(9);
    expect(snapshot.agents.map((agent) => agent.agentId)).toEqual(agentCatalog.map((agent) => agent.agentId));
    for (const agent of agentCatalog) expect(snapshot.agents.find((candidate) => candidate.agentId === agent.agentId)?.approvedAllowedSkillIds).toEqual([...agent.allowedSkillIds]);
    expect(snapshot.agents.find((agent) => agent.agentId === "contract-auditor")?.approvedAllowedSkillIds).toContain("requirements-evidence-traceability");
    expect(snapshot.agents.find((agent) => agent.agentId === "test-quality-reviewer")?.approvedAllowedSkillIds).toContain("requirements-evidence-traceability");
  });

  it("resolves lead, planner, design, and implementation portfolios locally", async () => {
    const reg = registry();
    const cases = [
      ["lead", "requirements.clarify", "clarify-requirements", ["requirements"], ["requirements-completeness"]],
      ["planner", "planning.architecture", "create-technical-architecture", ["data", "architecture"], ["data-model-planning", "technical-risk-planning"]],
      ["design", "design.directions", "create-design-directions", ["responsive", "forms"], ["responsive-form-ux"]],
      ["implementation", "implementation.code", "implement-frontend", ["nextjs"], ["nextjs-implementation"]],
      ["implementation", "implementation.code", "implement-frontend", ["forms"], ["forms-validation"]],
      ["implementation", "implementation.backend", "implement-backend", ["supabase"], ["supabase-implementation"]],
    ] as const;
    for (const [agentId, capability, taskType, projectSurfaces, requiredCoverage] of cases) {
      const result = await resolveApprovedSkillContext(reg, { agent: agentCatalog.find((agent) => agent.agentId === agentId)!, capability, taskType, projectSurfaces, requiredCoverage, requestedTools: [], contextBudgetBytes: 80_000 });
      expect(result.selected.length).toBeGreaterThan(0);
      expect(result.selected.flatMap((skill) => skill.coverageKeys)).toEqual(expect.arrayContaining([...requiredCoverage]));
    }
  });

  it("resolves reviewer portfolios, including complementary and shared procedures", async () => {
    const reg = registry();
    const cases = [
      ["architecture-reviewer", "review.architecture", "review-architecture", ["maintenance"], ["maintainability-review"]],
      ["contract-auditor", "review.contracts", "review-contracts", ["contracts"], ["requirements-traceability"]],
      ["code-integration-reviewer", "review.integration", "review-code-integration", ["react"], ["react-review"]],
      ["security-reviewer", "review.security", "review-security", ["supabase", "auth"], ["supabase-rls", "auth-security"]],
      ["test-quality-reviewer", "review.test-quality", "review-test-quality", ["tests"], ["requirements-traceability", "test-strategy"]],
    ] as const;
    for (const [agentId, capability, taskType, projectSurfaces, requiredCoverage] of cases) {
      const result = await resolveApprovedSkillContext(reg, { agent: agentCatalog.find((agent) => agent.agentId === agentId)!, capability, taskType, projectSurfaces, requiredCoverage, requestedTools: [], contextBudgetBytes: 100_000 });
      expect(result.selected.flatMap((skill) => skill.coverageKeys)).toEqual(expect.arrayContaining([...requiredCoverage]));
    }
  });

  it("enforces context budgets, overlap/conflict filtering, and deterministic identity", async () => {
    const reg = registry();
    const agent = agentCatalog.find((item) => item.agentId === "implementation")!;
    const request = { agent, capability: "implementation.code", taskType: "implement-frontend", projectSurfaces: ["nextjs", "forms"], requiredCoverage: ["nextjs-implementation", "forms-validation"], requestedTools: [], contextBudgetBytes: 100_000 } as const;
    const first = await resolveApprovedSkillContext(reg, request);
    const second = await resolveApprovedSkillContext(reg, request);
    expect(first.selected.length).toBeGreaterThan(1);
    expect(second.contextIdentity).toEqual(first.contextIdentity);
    const limited = await resolveApprovedSkillContext(reg, { ...request, contextBudgetBytes: 1 });
    expect(limited.selected).toHaveLength(0);
    expect(limited.excluded.some((item) => item.reason === "CONTEXT_LIMIT")).toBe(true);
  });

  it("keeps deferred candidates unapproved, unassigned, and not runtime-resolvable", async () => {
    const snapshot = await readSnapshot();
    expect(snapshot.deferredCandidates).toHaveLength(3);
    expect(snapshot.deferredCandidates.every((candidate) => candidate.futureReconsiderationAllowed && !candidate.runtimeResolvable)).toBe(true);
    const assigned = new Set(snapshot.agents.flatMap((agent) => agent.approvedAllowedSkillIds));
    const records = await Promise.all((await readdir(registryRoot)).filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(path.join(registryRoot, file), "utf8")) as { definition: { status: string; id: string }; source?: { externalSkillId?: string } }));
    for (const candidate of snapshot.deferredCandidates) {
      expect([...assigned]).not.toContain(candidate.externalSkillId);
      expect(records.filter((record) => record.source?.externalSkillId === candidate.externalSkillId).every((record) => record.definition.status !== "approved")).toBe(true);
    }
  });

  it("preserves authority hierarchy, read-only reviewer boundaries, and zero skill tools", async () => {
    const snapshot = await readSnapshot();
    const records = await Promise.all(snapshot.agents.flatMap((agent) => agent.approvedAllowedSkillIds).map(async (skillId) => JSON.parse(await readFile(path.join(registryRoot, `${skillId}.json`), "utf8")) as { approval: { allowedTools: string[]; allowedRoles: string[] }; definition: { sourceType: string } }));
    expect(records.every((record) => record.approval.allowedTools.length === 0)).toBe(true);
    for (const agent of agentCatalog.filter((item) => item.role === "review")) expect(agent.readOnly).toBe(true);
    expect(snapshot.runtimeResolverRedesigned).toBe(false);
  });

  it("records offline activation and local runtime parity without Vercel credentials", async () => {
    const snapshot = await readSnapshot();
    expect(snapshot.networkCalls).toBe(0);
    expect(snapshot.vercelOidcTokenRequired).toBe(false);
    expect(snapshot.skillCountQuotaIntroduced).toBe(false);
    expect(snapshot.approvalCalled).toBe(true);
    expect(snapshot.assignmentsChanged).toBe(true);
  });
});
