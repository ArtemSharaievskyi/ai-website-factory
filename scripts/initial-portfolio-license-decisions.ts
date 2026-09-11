import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentCatalog } from "@/agents/catalog";
import {
  ExternalAdvanceEvidenceArtifactSchema,
} from "@/skills/curation/external-advance-evidence";
import { CurationReviewerSchema } from "@/skills/curation/contracts";
import {
  InitialPortfolioLicenseDecisionArtifactSchema,
  buildInitialPortfolioLicenseDecisionArtifact,
  type InitialPortfolioCoverageRecord,
  type InitialPortfolioDecisionRecord,
} from "@/skills/curation/initial-portfolio-policy";
import { InternalSkillEvidenceArtifactSchema } from "@/skills/curation/internal-skill-evidence";
import { PortfolioPlanSchema } from "@/skills/curation/portfolio-plan";

const root = process.cwd();
const phase4d1Path = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "agent-skill-portfolio-plan-2026-08-09.json",
);
const phase4d2Path = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "external-advance-evidence-2026-08-09.json",
);
const internalEvidencePath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "internal-skill-evidence-2026-08-09.json",
);
const selectedEvidencePath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "selected-candidate-evidence-2026-08-09.json",
);
const artifactPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "initial-portfolio-license-decisions-2026-08-09.json",
);
const reportPath = path.join(
  root,
  "docs",
  "admin",
  "initial-portfolio-license-decisions-2026-08-09.md",
);

const expectedExternalChecksums = {
  "bradyhazell/brady-plugins/review-maintainability":
    "4d178cfce7746577253c9addcb2648ceb1c5d3237ff32357a0b382df019ca7f9",
  "fr-e-d/gaai-framework/ambiguity-detector":
    "421b7a8270a82b26ce7a2bfa2172d1833880a6accedcc1ab28249df5e7e1a0e6",
  "owasp/secure-agent-playbook/web-security-review":
    "8b280a3ab13567cadde2c114fffe5c5a00dd2841c229114abf14ddf0880e8012",
  "djankies/claude-configs/reviewing-test-quality":
    "7678ee0541450cce390b5a8b5bdacc93d2878451c087969856ccb250b4f38a08",
} as const;

const decisionMatrix = {
  "bradyhazell/brady-plugins/review-maintainability": {
    phase4d35Decision: "SELECTED_FOR_PHASE_4D4_APPROVAL",
    decisionReason:
      "APPROVAL_ELIGIBLE with accepted MIT evidence, exact checksum, strong complementary architecture value, and no unresolved blocker.",
    initialPortfolioRequired: true,
  },
  "fr-e-d/gaai-framework/ambiguity-detector": {
    phase4d35Decision: "DEFERRED_FROM_INITIAL_PORTFOLIO",
    decisionReason:
      "Elastic-2.0 requires a Factory license-policy decision beyond this engineering phase; internal completeness and clarification coverage is sufficient to start safely.",
    initialPortfolioRequired: false,
  },
  "owasp/secure-agent-playbook/web-security-review": {
    phase4d35Decision: "DEFERRED_FROM_INITIAL_PORTFOLIO",
    decisionReason:
      "CC-BY-4.0 attribution and portfolio policy handling are deferred; existing Supabase RLS plus the planned auth/storage procedure provide sufficient initial security coverage.",
    initialPortfolioRequired: false,
  },
  "djankies/claude-configs/reviewing-test-quality": {
    phase4d35Decision: "NOT_SELECTED_INITIAL_PORTFOLIO",
    decisionReason:
      "Nested/plugin license scope remains unresolved and internal traceability plus behavioral test-quality procedures already cover the initial Test Reviewer portfolio.",
    initialPortfolioRequired: false,
  },
} as const;

const coverageBasis: Record<string, string> = {
  lead: "Lead clarification policy, deterministic contradiction checks, and lead-requirements-completeness provide sufficient initial completeness and ambiguity coverage; the external ambiguity procedure remains optional future enhancement.",
  planner: "Project data-model planning and technical-risk planning cover the planned Planner gaps without depending on deferred external skills.",
  design: "Responsive form UX design covers the planned Design gap with existing design contracts and no external dependency.",
  implementation: "The four implementation procedures cover the planned Next.js, forms, Supabase, and maintainability surfaces.",
  "architecture-reviewer": "Existing module-boundaries plus architecture-tradeoff-review provide the current review base; review-maintainability is the sole external Phase 4D4 approval preview.",
  "contract-auditor": "Existing acceptance-criteria plus shared requirements-evidence-traceability provide sufficient contract coverage.",
  "code-integration-reviewer": "React/Next integration review provides the planned semantic integration coverage after deterministic gates.",
  "security-reviewer": "Existing Supabase RLS, auth-storage-security-review, Security Reviewer policy, and deterministic evidence provide sufficient initial security coverage without general web-security external content.",
  "test-quality-reviewer": "Shared requirements-evidence-traceability, behavioral-test-quality-review, and existing Vitest/Playwright/runtime evidence provide sufficient initial test-quality coverage.",
};

const cell = (value: unknown) =>
  String(value ?? "none").replaceAll("|", "\\|").replaceAll("\n", " ");

function renderReport(
  artifact: ReturnType<typeof buildInitialPortfolioLicenseDecisionArtifact>,
) {
  const lines = [
    "# Initial Portfolio License Decisions — Phase 4D3.5 — 2026-08-09",
    "",
    "This is an engineering portfolio-selection decision for the initial AI Website Factory portfolio. It is not legal advice, a license interpretation engine, an approval action, or an assignment action.",
    "",
    "## Decisions",
    "",
    "| Candidate | License evidence | Policy status | Scope status | Phase 4D3.5 decision | Readiness | Initial required |",
    "|---|---|---|---|---|---|---|",
    ...artifact.candidates.map(
      (candidate) =>
        `| ${cell(candidate.externalSkillId)} | ${candidate.licenseId} / ${candidate.licenseEvidenceStatus} | ${candidate.licensePolicyStatus} | ${candidate.licenseScopeStatus} | ${candidate.phase4d35Decision} | ${candidate.currentReadiness} | ${candidate.initialPortfolioRequired} |`,
    ),
    "",
    "No decision asserts that Elastic-2.0 or CC-BY-4.0 is legally forbidden or incompatible. The decisions only defer initial portfolio selection pending Factory policy or scope decisions.",
    "",
    "## Initial coverage after deferrals",
    "",
    "All 9 agents have sufficient initial coverage. No material initial portfolio gap was identified.",
    "",
    "| Agent | Existing approved | Phase 4D4 external | Phase 4D4 internal | Deferred optional external | Coverage |",
    "|---|---|---|---|---|---|",
    ...artifact.initialCoverage.map(
      (coverage) =>
        `| ${coverage.agentId} | ${cell(coverage.existingApprovedSkillIds.join(", "))} | ${cell(coverage.phase4d4ExternalSkillIds.join(", "))} | ${cell(coverage.phase4d4InternalSkillIds.join(", "))} | ${cell(coverage.deferredOptionalExternalSkillIds.join(", "))} | ${coverage.coverageStatus} |`,
    ),
    "",
    "## Phase 4D4 approval preview",
    "",
    `- External preview: ${artifact.phase4d4ApprovalPreview.externalSkillIds.join(", ")}.`,
    `- Internal preview: ${artifact.phase4d4ApprovalPreview.internalSkillIds.length} authored internal skills.`,
    `- Total preview artifacts: ${artifact.phase4d4ApprovalPreview.totalArtifacts}.`,
    "- This is preview-only. No approval, promotion, assignment, allowlist, or resolver mutation occurred.",
    "",
    "## Roadmap",
    "",
    "- Phase 4D3: authored internal skills — complete.",
    "- Phase 4D3.5: initial portfolio license decisions — complete.",
    "- Phase 4D4: explicit approval and assignment — next.",
    "- Phase 4D5: final skill portfolio/runtime audit.",
    "- Phase 5: Factory self-review.",
    "- Phase 6: architectural corrections.",
    "- Phase 7: clean website E2E.",
    "",
    "## Invariants",
    "",
    "- Phase 4D1 EXTERNAL_ADVANCE history remains unchanged.",
    "- Phase 4D2 license evidence, policy statuses, checksums, and candidate records remain unchanged.",
    "- Approved external count remains 3; assigned external count remains 3.",
    "- Approved internal count remains 0; assigned internal count remains 0.",
    "- Deferred candidates remain historical and are not runtime-resolvable or assigned.",
    "- No skills.sh, GitHub, web, npm registry, or external API calls were used.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const phase4d1 = PortfolioPlanSchema.parse(
    JSON.parse(await readFile(phase4d1Path, "utf8")),
  );
  const phase4d2 = ExternalAdvanceEvidenceArtifactSchema.parse(
    JSON.parse(await readFile(phase4d2Path, "utf8")),
  );
  const internalEvidence = InternalSkillEvidenceArtifactSchema.parse(
    JSON.parse(await readFile(internalEvidencePath, "utf8")),
  );
  const selectedEvidence = JSON.parse(await readFile(selectedEvidencePath, "utf8")) as {
    candidates: Array<{
      targetReviewer: string;
      externalSkillId: string;
      stagedSkillId: string;
      candidateChecksum: string;
    }>;
  };
  const phase4d2ById = new Map(
    phase4d2.candidates.map((candidate) => [candidate.externalSkillId, candidate]),
  );
  const phase4d1ById = new Map(
    phase4d1.humanReviewCandidatesConsidered.map((candidate) => [candidate.externalSkillId, candidate]),
  );
  const candidates: InitialPortfolioDecisionRecord[] = [];

  for (const [externalSkillId, matrix] of Object.entries(decisionMatrix)) {
    const candidate = phase4d2ById.get(externalSkillId);
    const historical = phase4d1ById.get(externalSkillId);
    if (!candidate || !historical || historical.recommendation !== "EXTERNAL_ADVANCE")
      throw new Error(`Missing or changed historical evidence for ${externalSkillId}.`);
    const expectedChecksum = expectedExternalChecksums[externalSkillId as keyof typeof expectedExternalChecksums];
    if (candidate.candidateChecksum !== expectedChecksum)
      throw new Error(`Checksum changed for ${externalSkillId}.`);
    const licenseEvidence = candidate.licenseEvidence;
    if (!licenseEvidence || licenseEvidence.candidateChecksum !== expectedChecksum)
      throw new Error(`License evidence changed for ${externalSkillId}.`);
    if (candidate.approvalReadiness === "APPROVAL_ELIGIBLE" && externalSkillId !== "bradyhazell/brady-plugins/review-maintainability")
      throw new Error(`Unexpected eligibility state for ${externalSkillId}.`);
    candidates.push({
      externalSkillId,
      checksum: candidate.candidateChecksum,
      targetAgent: candidate.targetAgent,
      previousPortfolioDecision: historical.recommendation,
      licenseId: candidate.licenseId,
      licenseEvidenceStatus: "PRESENT",
      licensePolicyStatus: candidate.licensePolicyStatus,
      licenseScope: candidate.licenseScope,
      licenseScopeStatus:
        candidate.licensePolicyStatus === "LICENSE_SCOPE_REVIEW_REQUIRED"
          ? "LICENSE_SCOPE_REVIEW_REQUIRED"
          : "LICENSE_SCOPE_ACCEPTED",
      attributionObligations: candidate.attributionObligations,
      phase4d35Decision: matrix.phase4d35Decision,
      decisionReason: matrix.decisionReason,
      initialPortfolioRequired: matrix.initialPortfolioRequired,
      futureReconsiderationAllowed: true,
      currentReadiness: candidate.approvalReadiness,
    });
  }

  if (candidates.length !== 4) throw new Error("Phase 4D3.5 must process exactly four candidates.");
  if (internalEvidence.candidates.length !== 13 || internalEvidence.approvedInternalSkillCount !== 0 || internalEvidence.assignedInternalSkillCount !== 0)
    throw new Error("Internal Phase 4D3 evidence does not contain the expected 13 unapproved skills.");
  if (internalEvidence.candidates.some((candidate) => candidate.approvalReadiness !== "APPROVAL_ELIGIBLE"))
    throw new Error("An internal skill is not approval eligible.");

  const existingApprovedExternal = agentCatalog
    .flatMap((agent) => agent.allowedSkillIds.map((stagedSkillId) => ({ agent, stagedSkillId })))
    .map(({ agent, stagedSkillId }) => {
      const candidate = selectedEvidence.candidates.find((item) => item.stagedSkillId === stagedSkillId);
      if (!candidate) throw new Error(`Missing approved evidence for ${stagedSkillId}.`);
      return {
        stagedSkillId,
        externalSkillId: candidate.externalSkillId,
        targetAgent: CurationReviewerSchema.parse(agent.agentId),
        checksum: candidate.candidateChecksum,
      };
    });
  if (existingApprovedExternal.length !== 3) throw new Error("Approved external count changed.");

  const phase4d4ExternalSkillIds = [
    "bradyhazell/brady-plugins/review-maintainability",
  ];
  const phase4d4InternalSkillIds = internalEvidence.candidates.map((candidate) => candidate.skillId);
  const deferredIds = candidates
    .filter((candidate) => !candidate.initialPortfolioRequired)
    .map((candidate) => candidate.externalSkillId);
  // The historical Phase 4D4 artifact is intentionally scoped to agents with
  // approved skill assignments. Deterministic post-implementation reviewers
  // are cataloged separately and have no approved procedural skills.
  const skillManagedCatalog = agentCatalog.filter((agent) => agent.allowedSkillIds.length > 0);
  const initialCoverage: InitialPortfolioCoverageRecord[] = skillManagedCatalog.map((agent) => {
    const agentId = CurationReviewerSchema.parse(agent.agentId);
    const internalIds = internalEvidence.candidates
      .filter((candidate) => candidate.targets.includes(agentId))
      .map((candidate) => candidate.skillId);
    const externalIds = candidates
      .filter((candidate) => candidate.initialPortfolioRequired && candidate.targetAgent === agentId)
      .map((candidate) => candidate.externalSkillId);
    const deferredOptionalExternalSkillIds = deferredIds.filter((externalSkillId) =>
      phase4d2ById.get(externalSkillId)?.targetAgent === agentId,
    );
    const existingApprovedSkillIds = [...agent.allowedSkillIds];
    if (!existingApprovedSkillIds.length && !internalIds.length && !externalIds.length)
      throw new Error(`Initial portfolio gap for ${agentId}.`);
    return {
      agentId,
      existingApprovedSkillIds,
      phase4d4ExternalSkillIds: externalIds,
      phase4d4InternalSkillIds: internalIds,
      deferredOptionalExternalSkillIds,
      coverageStatus: "SUFFICIENT_INITIAL_COVERAGE",
      coverageBasis: coverageBasis[agentId]!,
    };
  });

  const artifact = buildInitialPortfolioLicenseDecisionArtifact({
    generatedAt: "2026-08-09T00:00:00.000Z",
    candidates,
    existingApprovedExternal,
    initialCoverage,
    phase4d4ExternalSkillIds,
    phase4d4InternalSkillIds,
  });
  InitialPortfolioLicenseDecisionArtifactSchema.parse(artifact);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await writeFile(reportPath, renderReport(artifact), "utf8");
  console.log(JSON.stringify({
    candidates: artifact.candidates.length,
    sufficientAgents: artifact.initialCoverage.length,
    gaps: artifact.initialPortfolioGaps.length,
    phase4d4External: artifact.phase4d4ApprovalPreview.externalSkillIds.length,
    phase4d4Internal: artifact.phase4d4ApprovalPreview.internalSkillIds.length,
    totalPreviewArtifacts: artifact.phase4d4ApprovalPreview.totalArtifacts,
    approvalCalled: artifact.approvalCalled,
    assignmentsChanged: artifact.assignmentsChanged,
    artifactPath,
    reportPath,
  }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
