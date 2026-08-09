import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentCatalog } from "@/agents/catalog";
import { ExternalAdvanceEvidenceArtifactSchema } from "./external-advance-evidence";
import {
  InitialPortfolioLicenseDecisionArtifactSchema,
} from "./initial-portfolio-policy";
import { InternalSkillEvidenceArtifactSchema, canonicalInternalSkillChecksum } from "./internal-skill-evidence";

const root = process.cwd();
const readJson = async (relativePath: string) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

async function artifacts() {
  const policy = InitialPortfolioLicenseDecisionArtifactSchema.parse(
    await readJson("docs/admin/skill-curation/initial-portfolio-license-decisions-2026-08-09.json"),
  );
  const external = ExternalAdvanceEvidenceArtifactSchema.parse(
    await readJson("docs/admin/skill-curation/external-advance-evidence-2026-08-09.json"),
  );
  const internal = InternalSkillEvidenceArtifactSchema.parse(
    await readJson("docs/admin/skill-curation/internal-skill-evidence-2026-08-09.json"),
  );
  return { policy, external, internal };
}

describe("Phase 4D3.5 initial portfolio policy", () => {
  it("keeps license evidence, policy status, and portfolio selection separate", async () => {
    const { policy } = await artifacts();
    const ambiguity = policy.candidates.find((candidate) => candidate.externalSkillId.includes("ambiguity-detector"));
    const webSecurity = policy.candidates.find((candidate) => candidate.externalSkillId.includes("web-security-review"));
    const testQuality = policy.candidates.find((candidate) => candidate.externalSkillId.includes("reviewing-test-quality"));
    expect(ambiguity).toMatchObject({ licenseId: "Elastic-2.0", licenseEvidenceStatus: "PRESENT", licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED", licenseScope: "repository", phase4d35Decision: "DEFERRED_FROM_INITIAL_PORTFOLIO" });
    expect(webSecurity).toMatchObject({ licenseId: "CC-BY-4.0", licenseEvidenceStatus: "PRESENT", licensePolicyStatus: "LICENSE_POLICY_REVIEW_REQUIRED", licenseScope: "repository", phase4d35Decision: "DEFERRED_FROM_INITIAL_PORTFOLIO", attributionObligations: ["ATTRIBUTION_REQUIRED"] });
    expect(testQuality).toMatchObject({ licenseId: "MIT", licenseEvidenceStatus: "PRESENT", licensePolicyStatus: "LICENSE_SCOPE_REVIEW_REQUIRED", licenseScope: "repository-inherited-no-narrower-local-evidence", licenseScopeStatus: "LICENSE_SCOPE_REVIEW_REQUIRED", phase4d35Decision: "NOT_SELECTED_INITIAL_PORTFOLIO" });
  });

  it("preserves the historical EXTERNAL_ADVANCE decision and exact candidate checksums", async () => {
    const { policy, external } = await artifacts();
    expect(policy.candidates).toHaveLength(4);
    for (const candidate of policy.candidates) {
      const source = external.candidates.find((item) => item.externalSkillId === candidate.externalSkillId);
      expect(source?.candidateChecksum).toBe(candidate.checksum);
      expect(candidate.previousPortfolioDecision).toBe("EXTERNAL_ADVANCE");
    }
  });

  it("selects the eligible maintainability candidate for later approval without approving it", async () => {
    const { policy } = await artifacts();
    const selected = policy.candidates.find((candidate) => candidate.externalSkillId.includes("review-maintainability"));
    expect(selected).toMatchObject({ phase4d35Decision: "SELECTED_FOR_PHASE_4D4_APPROVAL", currentReadiness: "APPROVAL_ELIGIBLE", initialPortfolioRequired: true });
    expect(policy.approvalCalled).toBe(false);
    expect(policy.assignmentsChanged).toBe(false);
    expect(policy.approvedExternalSkillCount).toBe(3);
    expect(policy.assignedExternalSkillCount).toBe(3);
    expect(policy.approvedInternalSkillCount).toBe(0);
    expect(policy.assignedInternalSkillCount).toBe(0);
  });

  it("keeps deferred candidates historical and outside runtime allowlists", async () => {
    const { policy, external } = await artifacts();
    const deferred = policy.candidates.filter((candidate) => !candidate.initialPortfolioRequired);
    expect(deferred).toHaveLength(3);
    expect(deferred.every((candidate) => candidate.futureReconsiderationAllowed)).toBe(true);
    expect(deferred.every((candidate) => candidate.phase4d35Decision !== "SELECTED_FOR_PHASE_4D4_APPROVAL")).toBe(true);
    const deferredIds = new Set(deferred.map((candidate) => candidate.externalSkillId));
    const deferredStagedIds = new Set(external.candidates.filter((candidate) => deferredIds.has(candidate.externalSkillId)).map((candidate) => candidate.stagedSkillId));
    expect(agentCatalog.flatMap((agent) => agent.allowedSkillIds).some((skillId) => deferredIds.has(skillId) || deferredStagedIds.has(skillId))).toBe(false);
    expect(agentCatalog.flatMap((agent) => agent.allowedSkillIds)).not.toContain("bradyhazell/brady-plugins/review-maintainability");
  });

  it("contains exactly one external and all 13 internal Phase 4D4 approval previews", async () => {
    const { policy, internal } = await artifacts();
    expect(policy.phase4d4ApprovalPreview.previewOnly).toBe(true);
    expect(policy.phase4d4ApprovalPreview.externalSkillIds).toEqual(["bradyhazell/brady-plugins/review-maintainability"]);
    expect(policy.phase4d4ApprovalPreview.internalSkillIds).toHaveLength(13);
    expect(policy.phase4d4ApprovalPreview.internalSkillIds).toEqual(internal.candidates.map((candidate) => candidate.skillId));
    expect(policy.phase4d4ApprovalPreview.totalArtifacts).toBe(14);
  });

  it("provides sufficient initial coverage for all nine agents without a skill-count quota", async () => {
    const { policy } = await artifacts();
    expect(policy.skillCountQuotaIntroduced).toBe(false);
    expect(policy.initialCoverage).toHaveLength(9);
    expect(policy.initialCoverage.map((coverage) => coverage.agentId)).toEqual(agentCatalog.map((agent) => agent.agentId));
    expect(policy.initialCoverage.every((coverage) => coverage.coverageStatus === "SUFFICIENT_INITIAL_COVERAGE")).toBe(true);
    expect(policy.initialPortfolioGaps).toEqual([]);
  });

  it("matches the intended final per-agent preview", async () => {
    const { policy } = await artifacts();
    const byAgent = new Map(policy.initialCoverage.map((coverage) => [coverage.agentId, coverage]));
    expect(byAgent.get("lead")?.phase4d4InternalSkillIds).toEqual(["lead-requirements-completeness"]);
    expect(byAgent.get("planner")?.phase4d4InternalSkillIds).toEqual(["project-data-model-planning", "technical-risk-planning"]);
    expect(byAgent.get("design")?.phase4d4InternalSkillIds).toEqual(["responsive-form-ux-design"]);
    expect(byAgent.get("implementation")?.phase4d4InternalSkillIds).toEqual(["nextjs-server-client-implementation", "typed-form-implementation", "supabase-application-integration", "maintainable-performance-implementation"]);
    expect(byAgent.get("architecture-reviewer")).toMatchObject({ existingApprovedSkillIds: ["module-boundaries-fb20497b5c35"], phase4d4ExternalSkillIds: ["bradyhazell/brady-plugins/review-maintainability"], phase4d4InternalSkillIds: ["architecture-tradeoff-review"] });
    expect(byAgent.get("contract-auditor")).toMatchObject({ existingApprovedSkillIds: ["acceptance-criteria-80493e317476"], phase4d4InternalSkillIds: ["requirements-evidence-traceability"] });
    expect(byAgent.get("code-integration-reviewer")?.phase4d4InternalSkillIds).toEqual(["react-nextjs-integration-review"]);
    expect(byAgent.get("security-reviewer")).toMatchObject({ existingApprovedSkillIds: ["supabase-rls-1e36b217c969"], phase4d4InternalSkillIds: ["auth-storage-security-review"] });
    expect(byAgent.get("test-quality-reviewer")?.phase4d4InternalSkillIds).toEqual(["requirements-evidence-traceability", "behavioral-test-quality-review"]);
  });

  it("preserves all 13 internal checksums and the three existing approved external checksums", async () => {
    const { policy, internal } = await artifacts();
    for (const candidate of internal.candidates) {
      const content = (await readFile(path.join(root, candidate.contentPath), "utf8")).replace(/\r\n?/g, "\n");
      expect(canonicalInternalSkillChecksum(candidate.skillId, candidate.version, content)).toBe(candidate.checksum);
    }
    expect(policy.existingApprovedExternal).toEqual([
      { stagedSkillId: "module-boundaries-fb20497b5c35", externalSkillId: "codybrom/clairvoyance/module-boundaries", targetAgent: "architecture-reviewer", checksum: "5ff94ca54b67326d7c377a33d2e61d108887a96729c2c3ff228b4f3a6ff3c5ff" },
      { stagedSkillId: "acceptance-criteria-80493e317476", externalSkillId: "masanao-ohba/claude-manifests/acceptance-criteria", targetAgent: "contract-auditor", checksum: "2f522f9ef2d167860e613288395b6777dc2f9cb8fb88d67c255fb83986f579ec" },
      { stagedSkillId: "supabase-rls-1e36b217c969", externalSkillId: "sarmakska/slipstream/supabase-rls", targetAgent: "security-reviewer", checksum: "87bc57e597d3eb2e6ec8d4c099684cf4685da84ef45076b14083a7fcc7100877" },
    ]);
  });

  it("does not introduce legal inference or content mutation fields", async () => {
    const { policy } = await artifacts();
    expect(policy.candidates.every((candidate) => !("content" in candidate))).toBe(true);
    expect(policy.candidates.every((candidate) => !candidate.decisionReason.toLowerCase().includes("legally forbidden"))).toBe(true);
    expect(policy.candidates.every((candidate) => !candidate.decisionReason.toLowerCase().includes("incompatible"))).toBe(true);
  });
});
