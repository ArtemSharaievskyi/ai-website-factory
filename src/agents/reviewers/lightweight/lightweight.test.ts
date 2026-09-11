import { describe, expect, it } from "vitest";
import { agentCatalog } from "@/agents/catalog";
import { AgentReviewResultSchema, ReviewActivationPlanSchema, ReviewFindingSchema, ReviewSnapshotSchema, type AgentReviewResult, type ReviewAgentId, type ReviewFinding } from "@/domain/review/lightweight";
import { buildReviewActivationPlan } from "./activation";
import { AccessibilityReviewAgent, AnimationReviewAgent, ArchitectureCriticAgent, BrowserQAAgent, CodeReviewAgent, ContentQualityAgent, DesignReviewAgent, DependencyGuardianAgent, DocumentationAgent, ExploratoryQAAgent, GermanWebComplianceAgent, MotionImprovementAdvisor, AnimationOpportunityFinder, PerformanceReviewAgent, ProductCriticAgent, SecurityReviewAgent, SecurityTestAgent, SEOReviewAgent, UXCriticAgent, VisualRegressionAgent, deterministicLightweightReviewers } from "./agents";
import { correlateReviewFindings, reviewFindingDisposition, reviewFindingsToEscalations, reviewFindingToRegressionLedgerEntry, reviewFindingsToRepairIncidents } from "./correlation";
import { runReviewCycle, type LightweightReviewRunner } from "./orchestrator";
import { assertReviewMutationAllowed, isDocumentationPath, reviewMutationDecision } from "./permissions";
import { evaluateReleaseReadiness } from "./release";
import { buildReviewTaskGraph, buildReviewTaskGraphDocument } from "./taskgraph";
import { executeBoundedExploratoryScenarios } from "./exploratory-harness";
import { EMIL_SKILL_PROVENANCE } from "@/integrations/design/emil";

const projectId = "11111111-1111-4111-8111-111111111111";
const hash = (value: string) => value.repeat(64 / value.length);
const snapshot = (overrides: Record<string, unknown> = {}) => ReviewSnapshotSchema.parse({
  snapshotId: "snapshot-synthetic-a",
  projectId,
  projectVersion: 1,
  implementationChecksum: hash("a"),
  architectureChecksum: hash("b"),
  designChecksum: hash("c"),
  designSystemVersion: "design-system-v1",
  motionTokenChecksum: hash("e"),
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
const sourceSnapshot = (content: string, markers: string[] = [], overrides: Record<string, unknown> = {}) => {
  const current = snapshot({ designSystemVersion: "design-system-v1", motionTokenChecksum: hash("a"), ...overrides });
  return ReviewSnapshotSchema.parse({ ...current, evidencePack: { ...current.evidencePack, sourceFiles: [{ relativePath: "src/app/page.tsx", checksum: hash("d"), lineCount: content.split(/\r?\n/).length, content, markers }] } });
};

describe("lightweight post-implementation review layer", () => {
  it("registers the new inspectors while reusing existing security and code identities", () => {
    expect(agentCatalog.map((agent) => agent.agentId)).toEqual(expect.arrayContaining(["browser-qa", "accessibility-review", "performance-review", "visual-regression", "release-readiness", "seo-review", "content-quality", "dependency-guardian", "documentation", "security-reviewer", "code-integration-reviewer"]));
    expect(agentCatalog.find((agent) => agent.agentId === "security-reviewer")?.allowedSkillIds).toEqual(expect.arrayContaining(["auth-storage-security-review"]));
    expect(agentCatalog.find((agent) => agent.agentId === "code-integration-reviewer")?.allowedSkillIds).toContain("react-nextjs-integration-review");
    expect(agentCatalog.filter((agent) => agent.agentId === "documentation")[0]).toMatchObject({ readOnly: true, canonicalWriteAuthority: false, writeScopes: ["README.md", "docs/**", ".env.example"] });
  });

  it("activates public-site reviewers and skips security without inventing DB/RLS requirements", () => {
    const plan = buildReviewActivationPlan({ implementationComplete: true, capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN", "INTERACTIVE_UI", "PUBLIC_FACTUAL_CONTENT", "DEPENDENCY_DELTA"] });
    expect(plan.required).toEqual(expect.arrayContaining(["browser-qa", "accessibility-review", "performance-review", "visual-regression", "design-review", "code-integration-reviewer", "release-readiness", "seo-review", "content-quality", "dependency-guardian"]));
    expect(plan.required).not.toContain("security-reviewer");
    expect(plan.skipped.find((item) => item.agent === "security-reviewer")?.reason).toMatch(/must not invent/i);
  });

  it("activates animation review only for meaningful motion and preserves a valid no-motion result", async () => {
    const publicPlan = buildReviewActivationPlan({ implementationComplete: true, capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN"], meaningfulMotion: false });
    expect(publicPlan.required).toContain("design-review");
    expect(publicPlan.required).not.toContain("animation-review");
    expect(publicPlan.skipped.find((item) => item.agent === "animation-review")?.reason).toMatch(/no meaningful motion/i);
    const noMotion = await new AnimationReviewAgent().review({ snapshot: sourceSnapshot("export default function CommandPalette(){return <div onKeyDown={() => undefined}>Search</div>}", ["keyboard-interaction"]), agent: "animation-review" });
    expect(noMotion.status).toBe("PASS");
    expect(noMotion.evidenceRefs).toContain("motion:none");
    const visualStateOnly = await new AnimationReviewAgent().review({ snapshot: sourceSnapshot(".button:hover { color: var(--accent); }"), agent: "animation-review" });
    expect(visualStateOnly.status).toBe("PASS");
  });

  it("runs independent design craft review across hierarchy, visual language, responsive quality, and anti-AI-slop evidence", async () => {
    const weak = sourceSnapshot("export default function Page(){return <main><h2>One</h2><div className=\"card\"/><div className=\"card\"/></main>}", ["weak-hierarchy", "weak-typography", "inconsistent-spacing", "generic-card", "weak-color", "weak-iconography", "interaction-rough", "responsive-overflow", "design-generic"]);
    const result = await new DesignReviewAgent().review({ snapshot: weak, agent: "design-review" });
    expect(result.status).toBe("BLOCK");
    expect(result.findings.map((item) => item.category)).toEqual(expect.arrayContaining(["VISUAL_HIERARCHY", "TYPOGRAPHY", "SPACING", "COMPONENT_CONSISTENCY", "COLOR", "ICONOGRAPHY", "INTERACTION_POLISH", "RESPONSIVE_CRAFT", "DESIGN_DISTINCTIVENESS"]));
    expect(result.checksExecuted).toEqual(expect.arrayContaining(["design-system-checklist.evidence", "anti-ai-slop.evidence", "impeccable.evidence", "emil-design-eng"]));
    const strong = sourceSnapshot("export default function Page(){return <main><h1>Signal</h1><p>Clear product context.</p><button type=\"button\">Continue</button></main>}");
    expect((await new DesignReviewAgent().review({ snapshot: strong, agent: "design-review" })).status).toBe("PASS");
    const uxOnly = sourceSnapshot("export default function Page(){return <main><h1>Signal</h1><button type=\"button\">Continue</button></main>}", ["confusing-ux"]);
    expect((await new DesignReviewAgent().review({ snapshot: uxOnly, agent: "design-review" })).status).toBe("PASS");
    expect((await new UXCriticAgent().review({ snapshot: uxOnly, agent: "ux-critic" })).status).toBe("BLOCK");
    const visualOnly = ReviewSnapshotSchema.parse({ ...strong, evidencePack: { ...strong.evidencePack, browser: { ...strong.evidencePack.browser!, visualComparisons: [{ route: "/", screenshotRef: "screenshot:home", approvedDesignRef: "design:home", classification: "DESIGN_CONTRACT_VIOLATION", safeSummary: "Synthetic visual regression." }] } } });
    expect((await new DesignReviewAgent().review({ snapshot: visualOnly, agent: "design-review" })).status).toBe("PASS");
    expect((await new VisualRegressionAgent().review({ snapshot: visualOnly, agent: "visual-regression" })).status).toBe("BLOCK");
  });

  it("strictly blocks poor motion and accepts bounded, interruptible reduced-motion-aware motion", async () => {
    const poor = sourceSnapshot("const CommandPalette = () => <div className=\"popover toast\" onKeyDown={() => undefined}/>;\n" + ".menu { transition: all 500ms ease-in; duration: 500ms; transform: scale(0); transform-origin: center; }\n" + ".layout { transition: width 500ms; }\n" + "@keyframes toast { from { width: 0; opacity: 0; } to { width: 100px; opacity: 1; } }");
    const blocked = await new AnimationReviewAgent().review({ snapshot: poor, agent: "animation-review" });
    expect(blocked.status).toBe("BLOCK");
    expect(blocked.findings.map((item) => item.category)).toEqual(expect.arrayContaining(["MOTION_FREQUENCY", "MOTION_EASING", "MOTION_SCALE", "MOTION_ORIGIN", "MOTION_INTERRUPTIBILITY", "MOTION_PERFORMANCE", "MOTION_REDUCED_MOTION"]));
    expect(blocked.findings.filter((item) => item.category === "MOTION_PERFORMANCE")).toHaveLength(2);
    const good = sourceSnapshot("const Popover = () => <div className=\"popover\"/>;\n" + ".popover { --duration-popover: 180ms; transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1), opacity 180ms cubic-bezier(0.23, 1, 0.32, 1); transform: scale(.95); transform-origin: bottom; }\n" + "@media (prefers-reduced-motion: reduce) { .popover { transition: opacity 120ms linear; transform: none; } }\n" + "@media (hover: hover) and (pointer: fine) { .button:hover { transform: translateY(-1px); } }");
    expect((await new AnimationReviewAgent().review({ snapshot: good, agent: "animation-review" })).status).toBe("PASS");
    const easeInOut = sourceSnapshot(".dialog { transition: transform 180ms cubic-bezier(0.77, 0, 0.175, 1); transform: scale(.95); }\n@media (prefers-reduced-motion: reduce) { .dialog { transform: none; } }");
    expect((await new AnimationReviewAgent().review({ snapshot: easeInOut, agent: "animation-review" })).status).toBe("PASS");
  });

  it("keeps improvement and opportunity advisors read-only, bounded, and checksum-bound", async () => {
    const poor = sourceSnapshot(".toast { transition: all 500ms ease-in; transform: scale(0); }", ["motion"]);
    const improvement = await new MotionImprovementAdvisor().audit(poor);
    expect(improvement.plans.length).toBeGreaterThan(0);
    expect(improvement.binding).toMatchObject({ snapshotId: poor.snapshotId, implementationChecksum: poor.implementationChecksum, skillId: EMIL_SKILL_PROVENANCE[3].registrySkillId, skillChecksum: EMIL_SKILL_PROVENANCE[3].approvedContentChecksum, sourceWriteAuthority: "NONE", canonicalMutationAuthority: "NONE", advisoryOnly: true });
    expect(new MotionImprovementAdvisor().sourceWriteAuthority).toBe("NONE");
    expect(new MotionImprovementAdvisor().canonicalMutationAuthority).toBe("NONE");
    const keyboard = sourceSnapshot("<div aria-expanded=\"false\" onKeyDown={() => undefined}>Menu</div>");
    const opportunities = await new AnimationOpportunityFinder().find(keyboard);
    expect(opportunities.verdict).toBe("NO_ADDITIONAL_MOTION_RECOMMENDED");
    expect(opportunities.suggestions).toHaveLength(0);
    expect(opportunities.rejectedCandidates[0]?.decision).toBe("REJECT");
    expect(new AnimationOpportunityFinder().canonicalMutationAuthority).toBe("NONE");
    const bounded = ReviewSnapshotSchema.parse({ ...keyboard, evidencePack: { ...keyboard.evidencePack, sourceFiles: Array.from({ length: 9 }, (_, index) => ({ relativePath: `src/app/menu-${index}.tsx`, checksum: hash("d"), lineCount: 1, content: '<div aria-expanded="false" onKeyDown={() => undefined}>Menu</div>', markers: [] })) } });
    expect((await new AnimationOpportunityFinder().find(bounded)).rejectedCandidates).toHaveLength(7);
  });

  it("rejects stale Design System and motion-token bindings and blocks release on either new review", async () => {
    const current = sourceSnapshot(".popover { transition: opacity 180ms; }", ["motion"]);
    const activation = ReviewActivationPlanSchema.parse({ required: ["design-review", "animation-review", "release-readiness"], optional: [], skipped: [] });
    await expect(runReviewCycle({ snapshot: current, activation, runners: [new DesignReviewAgent(), new AnimationReviewAgent()], currentDesignSystemVersion: "design-system-v2" })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_STALE" });
    await expect(runReviewCycle({ snapshot: current, activation, runners: [new DesignReviewAgent(), new AnimationReviewAgent()], currentMotionTokenChecksum: hash("z") })).rejects.toMatchObject({ code: "REVIEW_SNAPSHOT_STALE" });
    const design = await new DesignReviewAgent().review({ snapshot: current, agent: "design-review" });
    const poor = await new AnimationReviewAgent().review({ snapshot: sourceSnapshot(".popover { transition: all 500ms ease-in; }", ["motion"]), agent: "animation-review" });
    expect(evaluateReleaseReadiness({ implementationChecksum: current.implementationChecksum, requiredReviews: ["design-review", "animation-review"], reviewResults: [design, poor], qualityGates: [{ id: "build", status: "PASS", evidenceRefs: ["build"] }] }).verdict).toBe("BLOCKED");
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
    expect(plan.required).toContain("security-test");
    expect(plan.required).toContain("architecture-critic");
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

  it("keeps the new assurance reviewers read-only, deterministic, and independently registered", async () => {
    const current = snapshot({
      evidencePack: {
        ...snapshot().evidencePack,
        sourceFiles: [{ relativePath: "src/app/page.tsx", checksum: hash("d"), lineCount: 10, content: "export default function Page(){return <main/>}", markers: ["unsafe-redirect", "confusing-ux", "brief-deviation", "unnecessary-complexity"] }],
        exploratory: { implementationChecksum: hash("a"), targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 1000, requestBudget: 2, nonDestructive: true, scenarios: [{ scenarioId: "scenario:double-submit", route: "/contact", precondition: "The contact form is empty", steps: ["Click submit twice"], expected: "One safe validation response", actual: "Two submissions were accepted", safeEvidence: ["exploratory:double-submit"], status: "FAIL", severity: "HIGH", blocking: true }], capturedAt: "2026-09-11T00:00:00.000Z" },
        securityTests: { implementationChecksum: hash("a"), targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 1000, requestBudget: 1, nonDestructive: true, probes: [{ probeId: "probe:headers", kind: "SECURITY_HEADERS", route: "/", expected: "CSP is present", actual: "CSP is missing", status: "FAIL", severity: "MEDIUM", safeEvidence: ["security:headers"] }], capturedAt: "2026-09-11T00:00:00.000Z" },
      },
      capabilities: ["IMPLEMENTED", "PUBLIC_SITE", "APPROVED_DESIGN", "INTERACTIVE_UI", "PUBLIC_FACTUAL_CONTENT", "DEPENDENCY_DELTA", "AUTH", "DATABASE"],
    });
    const agents = [new SecurityTestAgent(), new GermanWebComplianceAgent(), new ExploratoryQAAgent(), new UXCriticAgent(), new ProductCriticAgent(), new ArchitectureCriticAgent()];
    expect(agents.every((agent) => agent.readOnly)).toBe(true);
    expect((await new SecurityTestAgent().review({ snapshot: current, agent: "security-test" })).findings[0]?.category).toBe("SECURITY_TEST_SECURITY_HEADERS");
    expect((await new ExploratoryQAAgent().review({ snapshot: current, agent: "exploratory-qa" })).findings[0]?.category).toBe("EXPLORATORY_FAILURE");
    expect((await new SecurityReviewAgent().review({ snapshot: current, agent: "security-reviewer" })).findings[0]?.category).toBe("UNSAFE_REDIRECT");
    expect(deterministicLightweightReviewers.map((runner) => runner.agent)).toEqual(expect.arrayContaining(["security-test", "german-web-compliance", "exploratory-qa", "ux-critic", "product-critic", "architecture-critic"]));
  });

  it("routes legal facts and upstream architecture findings away from Safe Repair", () => {
    const legal = finding("german-web-compliance", { id: "legal-facts", category: "LEGAL_DDG", severity: "HIGH", invariant: "legal-user-input-required", repairRequired: false });
    const architecture = finding("architecture-critic", { id: "architecture-upstream", category: "ARCHITECTURE_COMPLEXITY", invariant: "bounded-complexity" });
    expect(reviewFindingDisposition(legal)).toBe("USER_INPUT_REQUIRED");
    expect(reviewFindingDisposition(architecture)).toBe("UPSTREAM_AUTHORITY");
    expect(reviewFindingsToRepairIncidents({ projectId, projectVersion: 1, findings: [legal, architecture] })).toEqual([]);
    expect(reviewFindingsToEscalations([legal, architecture]).map((item) => item.disposition)).toEqual(["USER_INPUT_REQUIRED", "UPSTREAM_AUTHORITY"]);
  });

  it("fails closed for accidental noindex and preserves the shared implementation checksum", async () => {
    const current = snapshot({ evidencePack: { ...snapshot().evidencePack, seo: { implementationChecksum: hash("a"), activated: true, publicSite: true, indexableRoutes: ["/"], noindexRoutes: ["/"], crawlerBlockedRoutes: ["/"], canonicalRoutes: [], sitemapPresent: false, robotsPolicyPresent: false, structuredDataApplicable: false, structuredDataPresent: false, localBusinessApplicable: false, localFactsAuthoritative: true, searchEssentialsAligned: true, noRankingGuarantees: true, doorwayPagePattern: false } } });
    const result = await new SEOReviewAgent().review({ snapshot: current, agent: "seo-review" });
    expect(result.artifactFingerprint).toBe(current.implementationChecksum);
    expect(result.findings.map((item) => item.id)).toEqual(expect.arrayContaining(["seo-accidental-noindex", "seo-blocked-crawler", "seo-canonical-missing", "seo-technical-policy"]));
    expect(() => ReviewSnapshotSchema.parse({ ...current, evidencePack: { ...current.evidencePack, seo: { ...current.evidencePack.seo!, implementationChecksum: hash("b") } } })).toThrow();
  });

  it("records bounded exploratory edge cases and a local security probe portfolio", async () => {
    const exploratory = await executeBoundedExploratoryScenarios({
      implementationChecksum: hash("a"),
      targetBoundary: "LOCAL_TEST_APPLICATION",
      timeoutMs: 100,
      requestBudget: 7,
      scenarios: ["double-submit", "reload-during-mutation", "expired-session", "long-input", "empty-state", "failed-backend", "stale-conflict"].map((id) => ({ scenarioId: `scenario:${id}`, route: "/contact", precondition: "Synthetic local fixture", steps: [id], expected: "Safe bounded outcome", severity: "HIGH" as const, blocking: false })),
      execute: async (scenario) => ({ actual: `Safe outcome for ${scenario.scenarioId}`, status: "PASS" as const, safeEvidence: [`exploratory:${scenario.scenarioId}`] }),
    });
    expect(exploratory.scenarios).toHaveLength(7);
    expect(exploratory.scenarios.every((scenario) => scenario.safeEvidence.length > 0)).toBe(true);
    await expect(executeBoundedExploratoryScenarios({ implementationChecksum: hash("a"), targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 60_001, requestBudget: 1, scenarios: [], execute: async () => ({ actual: "", status: "PASS", safeEvidence: ["x"] }) })).rejects.toThrow("EXPLORATORY_QA_TIMEOUT_OUT_OF_BOUNDS");
  });

  it("executes every newly activated public reviewer through the bounded zero-provider cycle", async () => {
    const current = snapshot({ evidencePack: { ...snapshot().evidencePack, exploratory: { implementationChecksum: hash("a"), targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 1000, requestBudget: 1, nonDestructive: true, scenarios: [{ scenarioId: "scenario:resize", route: "/", precondition: "Synthetic local page is loaded", steps: ["Resize to a narrow viewport"], expected: "Content remains usable", actual: "Content remains usable", safeEvidence: ["exploratory:resize"], status: "PASS", severity: "INFO", blocking: false }], capturedAt: "2026-09-11T00:00:00.000Z" } } });
    const activation = buildReviewActivationPlan({ implementationComplete: true, capabilities: current.capabilities });
    const cycle = await runReviewCycle({ snapshot: current, activation, runners: deterministicLightweightReviewers, maxConcurrency: 3 });
    expect(cycle.providerCalls).toBe(0);
    expect(cycle.results.map((result) => result.agent)).toEqual(expect.arrayContaining(["exploratory-qa", "ux-critic", "product-critic"]));
    expect(cycle.releaseReadiness.missingRequiredReviews).toEqual([]);
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
    await expect(runReviewCycle({ snapshot: current, activation, runners, readCurrentImplementationChecksum: async () => current.implementationChecksum })).resolves.toMatchObject({ providerCalls: 0 });
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
