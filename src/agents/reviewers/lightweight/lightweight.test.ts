import { describe, expect, it } from "vitest";
import { agentCatalog } from "@/agents/catalog";
import { AgentReviewResultSchema, ReviewActivationPlanSchema, ReviewFindingSchema, ReviewSnapshotSchema, type AgentReviewResult, type ReviewAgentId, type ReviewFinding } from "@/domain/review/lightweight";
import { buildReviewActivationPlan } from "./activation";
import { AccessibilityReviewAgent, BrowserQAAgent, CodeReviewAgent, ContentQualityAgent, DependencyGuardianAgent, DocumentationAgent, PerformanceReviewAgent, SecurityReviewAgent, SEOReviewAgent, VisualRegressionAgent } from "./agents";
import { correlateReviewFindings, reviewFindingToRegressionLedgerEntry, reviewFindingsToRepairIncidents } from "./correlation";
import { runReviewCycle, type LightweightReviewRunner } from "./orchestrator";
import { assertReviewMutationAllowed, isDocumentationPath, reviewMutationDecision } from "./permissions";
import { evaluateReleaseReadiness } from "./release";
import { buildReviewTaskGraph, buildReviewTaskGraphDocument } from "./taskgraph";

const projectId = "11111111-1111-4111-8111-111111111111";
const hash = (value: string) => value.repeat(64 / value.length);
const snapshot = (overrides: Record<string, unknown> = {}) => ReviewSnapshotSchema.parse({
  snapshotId: "snapshot-synthetic-a",
  projectId,
  projectVersion: 1,
  implementationChecksum: hash("a"),
  architectureChecksum: hash("b"),
  designChecksum: hash("c"),
  approvedRoutes: ["/", "/contact"],
  approvedUserFlows: ["contact-flow"],
  architectureOperationRefs: ["operation:contact-submit"],
  designInteractionRefs: ["interaction:contact-form"],
  taskRefs: ["task-contact"],
  capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN", "INTERACTIVE_UI", "PUBLIC_FACTUAL_CONTENT", "DEPENDENCY_DELTA"],
  evidencePack: {
    implementationChecksum: hash("a"),
    buildGates: [{ id: "build", status: "PASS", evidenceRefs: ["build:synthetic"] }],
    routeRefs: ["/", "/contact"],
    sourceFiles: [{ relativePath: "src/app/page.tsx", checksum: hash("d"), lineCount: 10, content: "export default function Page(){return <main/>}", markers: [] }],
    browser: { captured: true, routes: ["/", "/contact"], screenshots: ["screenshot:home"], consoleErrors: [], failedRequests: [], viewports: [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }], accessibility: [], visualComparisons: [] },
    dependencyDelta: [{ packageName: "zod", change: "UPDATED", fromVersion: "1.0.0", toVersion: "1.1.0", authorized: true, referenced: true }],
    metrics: { clientJsKb: 120, cumulativeLayoutShift: 0.03 },
    evidenceRefs: ["build:synthetic", "source:src/app/page.tsx"],
  },
  createdAt: "2026-09-11T00:00:00.000Z",
  ...overrides,
});

const passResult = (agent: ReviewAgentId, implementationChecksum = hash("a")): AgentReviewResult => AgentReviewResultSchema.parse({ agent, status: "PASS", findings: [], checksExecuted: ["synthetic.check"], evidenceRefs: ["synthetic:evidence"], artifactFingerprint: implementationChecksum });
const finding = (agent: ReviewAgentId, overrides: Partial<ReviewFinding> = {}): ReviewFinding => ReviewFindingSchema.parse({ id: "shared-defect", agent, category: "AUTHORIZATION", severity: "HIGH", confidence: "HIGH", title: "Shared defect", safeSummary: "A bounded synthetic defect.", affectedArtifacts: ["src/app/contact/page.tsx"], affectedRoutes: ["/contact"], affectedFiles: ["src/app/contact/page.tsx"], evidence: ["src/app/contact/page.tsx:10-12"], blocking: true, repairRequired: true, operation: "contact-submit", invariant: "owner-isolation", ...overrides });

describe("lightweight post-implementation review layer", () => {
  it("registers the new inspectors while reusing existing security and code identities", () => {
    expect(agentCatalog.map((agent) => agent.agentId)).toEqual(expect.arrayContaining(["browser-qa", "accessibility-review", "performance-review", "visual-regression", "release-readiness", "seo-review", "content-quality", "dependency-guardian", "documentation", "security-reviewer", "code-integration-reviewer"]));
    expect(agentCatalog.find((agent) => agent.agentId === "security-reviewer")?.allowedSkillIds).toEqual(expect.arrayContaining(["auth-storage-security-review"]));
    expect(agentCatalog.find((agent) => agent.agentId === "code-integration-reviewer")?.allowedSkillIds).toContain("react-nextjs-integration-review");
    expect(agentCatalog.filter((agent) => agent.agentId === "documentation")[0]).toMatchObject({ readOnly: true, canonicalWriteAuthority: false, writeScopes: ["README.md", "docs/**", ".env.example"] });
  });

  it("activates public-site reviewers and skips security without inventing DB/RLS requirements", () => {
    const plan = buildReviewActivationPlan({ implementationComplete: true, capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN", "INTERACTIVE_UI", "PUBLIC_FACTUAL_CONTENT", "DEPENDENCY_DELTA"] });
    expect(plan.required).toEqual(expect.arrayContaining(["browser-qa", "accessibility-review", "performance-review", "visual-regression", "code-integration-reviewer", "release-readiness", "seo-review", "content-quality", "dependency-guardian"]));
    expect(plan.required).not.toContain("security-reviewer");
    expect(plan.skipped.find((item) => item.agent === "security-reviewer")?.reason).toMatch(/must not invent/i);
  });

  it("runs browser QA for public pages even when the site has no interactive capability", () => {
    const plan = buildReviewActivationPlan({ implementationComplete: true, capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN"] });
    expect(plan.required).toContain("browser-qa");
    expect(plan.required).toContain("accessibility-review");
    expect(plan.required).not.toContain("security-reviewer");
  });

  it("activates security for auth/database and does not activate SEO for a private dashboard", () => {
    const plan = buildReviewActivationPlan({ implementationComplete: true, capabilities: ["IMPLEMENTED", "AUTH", "DATABASE", "INTERACTIVE_UI", "APPROVED_DESIGN"] });
    expect(plan.required).toContain("security-reviewer");
    expect(plan.required).not.toContain("seo-review");
    expect(plan.skipped.find((item) => item.agent === "seo-review")?.reason).toMatch(/not approved as public/i);
  });

  it("enforces docs-only write authority and denies every reviewer canonical/source mutation otherwise", () => {
    for (const agent of ["browser-qa", "security-reviewer", "accessibility-review", "performance-review", "visual-regression", "code-integration-reviewer", "release-readiness", "seo-review", "content-quality", "dependency-guardian"] as const) {
      expect(reviewMutationDecision({ agent, operation: "SOURCE_WRITE", path: "src/app/page.tsx" }).allowed).toBe(false);
      expect(reviewMutationDecision({ agent, operation: "CANONICAL_WRITE", path: "README.md" }).allowed).toBe(false);
    }
    const docs = new DocumentationAgent();
    expect(docs.canWrite("README.md").allowed).toBe(false);
    expect(docs.canWrite("README.md", true).allowed).toBe(true);
    expect(docs.canWrite("docs/qa.md", true).allowed).toBe(true);
    expect(docs.canWrite("src/app/page.tsx").allowed).toBe(false);
    expect(docs.canWrite("package.json").allowed).toBe(false);
    expect(isDocumentationPath("docs/qa.md")).toBe(true);
    expect(isDocumentationPath("docs/../src/app/page.tsx")).toBe(false);
    expect(() => assertReviewMutationAllowed({ agent: "documentation", operation: "SOURCE_WRITE", path: "src/app/page.tsx" })).toThrow("Review");
  });

  it("keeps deterministic reviewers provider-free and produces typed findings", async () => {
    const current = snapshot();
    const agents = [new BrowserQAAgent(), new SecurityReviewAgent(), new AccessibilityReviewAgent(), new PerformanceReviewAgent(), new VisualRegressionAgent(), new CodeReviewAgent(), new SEOReviewAgent(), new ContentQualityAgent(), new DependencyGuardianAgent()];
    for (const agent of agents) {
      const result = await agent.review({ snapshot: current, agent: agent.agent });
      expect(result.artifactFingerprint).toBe(current.implementationChecksum);
      expect(result.agent).toBe(agent.agent);
    }
  });

  it("keeps finding IDs unique across repeated security evidence and visual comparisons", async () => {
    const current = snapshot({
      evidencePack: {
        ...snapshot().evidencePack,
        sourceFiles: [
          { relativePath: "src/app/page.tsx", checksum: hash("d"), lineCount: 10, content: "const key = 'SECRET=synthetic-secret';", markers: ["secret-client-bundle"] },
          { relativePath: "src/app/contact/page.tsx", checksum: hash("e"), lineCount: 10, content: "export default function Contact(){return null}", markers: ["secret-client-bundle"] },
        ],
        browser: {
          ...snapshot().evidencePack.browser!,
          visualComparisons: [
            { route: "/contact", screenshotRef: "screenshot:contact-a", approvedDesignRef: "design:contact", classification: "DESIGN_CONTRACT_VIOLATION", safeSummary: "Synthetic visual defect." },
            { route: "/contact", screenshotRef: "screenshot:contact-b", approvedDesignRef: "design:contact", classification: "DESIGN_CONTRACT_VIOLATION", safeSummary: "Synthetic visual defect." },
          ],
        },
      },
    });
    const security = await new SecurityReviewAgent().review({ snapshot: current, agent: "security-reviewer" });
    const visual = await new VisualRegressionAgent().review({ snapshot: current, agent: "visual-regression" });
    expect(new Set(security.findings.map((item) => item.id)).size).toBe(security.findings.length);
    expect(new Set(visual.findings.map((item) => item.id)).size).toBe(visual.findings.length);
  });

  it("correlates equivalent findings without losing per-agent evidence and creates one RepairIncident", () => {
    const grouped = correlateReviewFindings([finding("browser-qa"), finding("code-integration-reviewer")]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.findings.map((item) => item.agent)).toEqual(["browser-qa", "code-integration-reviewer"]);
    const incidents = reviewFindingsToRepairIncidents({ projectId, projectVersion: 1, findings: [finding("browser-qa"), finding("code-integration-reviewer")], observedAt: "2026-09-11T00:00:00.000Z" });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ failureClass: "POST_IMPLEMENTATION_REVIEW_FINDING", affectedProject: { projectId, projectVersion: 1 } });
  });

  it("normalizes route-shaped browser evidence before Safe Repair admission", async () => {
    const current = snapshot({ evidencePack: { ...snapshot().evidencePack, browser: { ...snapshot().evidencePack.browser!, failedRequests: [{ route: "/contact", safeSummary: "Synthetic request failure." }] } } });
    const result = await new BrowserQAAgent().review({ snapshot: current, agent: "browser-qa" });
    expect(() => reviewFindingsToRepairIncidents({ projectId, projectVersion: 1, findings: result.findings, observedAt: "2026-09-11T00:00:00.000Z" })).not.toThrow();
  });

  it("offers explicit reusable-regression promotion without promoting project-local findings", () => {
    const candidate = reviewFindingToRegressionLedgerEntry({ finding: finding("browser-qa"), regressionId: "REG_REVIEW_AUTH", subsystem: "generated-runtime", regressionTestRef: "lightweight-review.test", reusable: true, runtimeBoundary: "browser-flow" });
    expect(candidate).toMatchObject({ regressionId: "REG_REVIEW_AUTH", status: "ACTIVE", affectedRuntimeBoundaries: ["browser-flow"] });
    expect(reviewFindingToRegressionLedgerEntry({ finding: finding("browser-qa"), regressionId: "REG_PROJECT_LOCAL", subsystem: "generated-runtime", regressionTestRef: "lightweight-review.test", reusable: false })).toBeUndefined();
  });

  it("blocks release on a blocking review, allows warnings, and blocks incomplete required reviews", () => {
    const base = { implementationChecksum: hash("a"), requiredReviews: ["security-reviewer", "code-integration-reviewer"] as const, qualityGates: [{ id: "build", status: "PASS" as const, evidenceRefs: ["build"] }] };
    expect(evaluateReleaseReadiness({ ...base, reviewResults: [passResult("code-integration-reviewer"), AgentReviewResultSchema.parse({ ...passResult("security-reviewer"), status: "BLOCK", findings: [finding("security-reviewer")] })] }).verdict).toBe("BLOCKED");
    expect(evaluateReleaseReadiness({ ...base, reviewResults: [passResult("security-reviewer"), AgentReviewResultSchema.parse({ ...passResult("code-integration-reviewer"), status: "WARN", findings: [finding("code-integration-reviewer", { blocking: false, repairRequired: true, severity: "MEDIUM" })] })] }).verdict).toBe("READY_WITH_WARNINGS");
    expect(evaluateReleaseReadiness({ ...base, reviewResults: [passResult("security-reviewer")] }).verdict).toBe("BLOCKED");
  });

  it("rejects stale snapshot admission and bounds parallel reviewer work", async () => {
    const current = snapshot();
    const activation = ReviewActivationPlanSchema.parse({ required: ["browser-qa", "performance-review", "release-readiness"], optional: [], skipped: [] });
    let active = 0;
    let peak = 0;
    const runnerAgents = ["browser-qa", "performance-review"] as const;
    const runners: LightweightReviewRunner[] = runnerAgents.map((agent): LightweightReviewRunner => ({ agent, async review(input) { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; return passResult(agent, input.snapshot.implementationChecksum); } }));
    const cycle = await runReviewCycle({ snapshot: current, activation, runners, maxConcurrency: 1 });
    expect(peak).toBe(1);
    expect(cycle.releaseReadiness.verdict).toBe("READY");
    expect(cycle.providerBudget.maxCalls).toBe(0);
    expect(cycle.providerCalls).toBe(0);
    await expect(runReviewCycle({ snapshot: current, activation, runners, currentImplementationChecksum: hash("b") })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_STALE" });
    await expect(runReviewCycle({ snapshot: current, activation, runners, currentDesignChecksum: hash("d") })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_STALE" });
    await expect(runReviewCycle({ snapshot: current, activation, runners, readCurrentImplementationChecksum: async () => hash("b") })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_STALE" });
  });

  it("builds a snapshot-bound parallel review task graph with release aggregation last", () => {
    const current = snapshot();
    const activation = buildReviewActivationPlan({ implementationComplete: true, capabilities: current.capabilities });
    const graph = buildReviewTaskGraph({ snapshot: current, activation, maxConcurrency: 3 });
    const release = graph.tasks.find((task) => task.agent === "release-readiness")!;
    expect(graph.maxConcurrency).toBe(3);
    expect(graph.tasks.filter((task) => task.agent !== "release-readiness").every((task) => task.executionMode === "parallel-safe" && task.dependencies.length === 0)).toBe(true);
    expect(release.executionMode).toBe("sequential");
    expect(release.dependencies).toHaveLength(graph.tasks.length - 1);
    expect(graph.tasks.every((task) => task.implementationChecksum === current.implementationChecksum && task.canonicalWriteAuthority === false)).toBe(true);
    const document = buildReviewTaskGraphDocument({ snapshot: current, activation, maxConcurrency: 3 });
    expect(document.documentType).toBe("task-graph");
    expect(document.tasks.every((task) => task.role === "qa-release" && task.allowedSkills.length === 0 && task.fileScopes.length === 0)).toBe(true);
    expect(document.tasks.find((task) => task.taskType === "review-release-readiness")?.dependencies).toHaveLength(document.tasks.length - 1);
    expect(document.readyForExecution).toBe(false);
  });
});
