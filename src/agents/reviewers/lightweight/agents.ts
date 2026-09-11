import { AgentReviewResultSchema, ReviewFindingSchema, type AgentReviewResult, type ReviewFinding, type ReviewSnapshot, type ReviewAgentId, type ReleaseReadinessResult } from "@/domain/review/lightweight";
import { ArchitectureCriticResultSchema, ExploratoryQAEvidenceSchema, GermanComplianceResultSchema, SecurityTestEvidenceSchema, SEOImplementationEvidenceSchema, type ArchitectureCriticResult } from "@/domain/assurance/contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { TechnicalArchitectureSchema, type TechnicalArchitecture } from "@/domain/architecture/schema";
import { executeBoundedExploratoryScenarios } from "./exploratory-harness";
import { executeBoundedSecurityProbes } from "@/agents/reviewers/security/test-harness";
import { SupplyChainSecuritySkill } from "./supply-chain-security-skill";
import { evaluateReleaseReadiness } from "./release";
import { assertReviewMutationAllowed, reviewMutationDecision, DOCUMENTATION_WRITE_SCOPES } from "./permissions";
import type { LightweightReviewInput, LightweightReviewRunner } from "./orchestrator";

const secretPattern = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:SERVICE_ROLE|DATABASE_URL|API_KEY|SECRET|TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{8,})/i;
const text = (value: string) => value.replaceAll(/\s+/g, " ").trim().slice(0, 1000);
const sourceText = (snapshot: ReviewSnapshot) => snapshot.evidencePack.sourceFiles.map((file) => ({ file, content: file.content ?? "" }));
const evidence = (snapshot: ReviewSnapshot, extra: string[] = []) => [...new Set([...snapshot.evidencePack.evidenceRefs, ...snapshot.approvedRoutes, ...extra])].slice(0, 100);
const finding = (agent: ReviewAgentId, input: Omit<ReviewFinding, "agent">) => ReviewFindingSchema.parse({ ...input, agent });
const result = (snapshot: ReviewSnapshot, agent: ReviewAgentId, findings: ReviewFinding[], checksExecuted: string[], evidenceRefs = evidence(snapshot)): AgentReviewResult => AgentReviewResultSchema.parse({ agent, status: findings.some((item) => item.blocking) ? "BLOCK" : findings.length ? "WARN" : "PASS", findings, checksExecuted, evidenceRefs, artifactFingerprint: snapshot.implementationChecksum });

abstract class DeterministicReviewAgent implements LightweightReviewRunner {
  readonly readOnly = true as const;
  abstract readonly agent: ReviewAgentId;
  abstract readonly checksExecuted: string[];
  protected abstract inspect(snapshot: ReviewSnapshot): ReviewFinding[];
  async review(input: LightweightReviewInput) { const findings = this.inspect(input.snapshot); return result(input.snapshot, this.agent, findings, this.checksExecuted); }
}

export class BrowserQAAgent extends DeterministicReviewAgent {
  readonly agent = "browser-qa" as const;
  readonly checksExecuted = ["browser.navigation", "browser.user-flows", "browser.console", "browser.network", "browser.responsive"];
  protected inspect(snapshot: ReviewSnapshot) {
    const browser = snapshot.evidencePack.browser;
    if (!browser?.captured) return [finding(this.agent, { id: "browser-evidence-missing", category: "BROWSER_EVIDENCE", severity: "HIGH", confidence: "HIGH", title: "Browser evidence is missing", safeSummary: "The approved browser QA cycle did not capture runtime evidence for this implementation snapshot.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true })];
    const findings: ReviewFinding[] = [];
    const issueGroups = [
      ["navigationFailures", "BROWSER_NAVIGATION_FAILURE"],
      ["interactionFailures", "BROWSER_INTERACTION_FAILURE"],
      ["flowFailures", "BROWSER_FLOW_MISMATCH"],
      ["redirectFailures", "BROWSER_REDIRECT_FAILURE"],
      ["responsiveFailures", "BROWSER_RESPONSIVE_FAILURE"],
      ["stateFailures", "BROWSER_STATE_FAILURE"],
    ] as const;
    for (const [key, category] of issueGroups) for (const issue of browser[key]) findings.push(finding(this.agent, { id: `browser-${category.toLowerCase()}-${browser[key].indexOf(issue)}`, category, severity: issue.severity, confidence: "HIGH", title: "Browser QA finding", safeSummary: text(issue.safeSummary), affectedArtifacts: [snapshot.snapshotId], affectedRoutes: issue.route ? [issue.route] : undefined, evidence: evidence(snapshot, issue.route ? [issue.route] : []), blocking: issue.blocking, repairRequired: true }));
    for (const route of browser.unexpectedRoutes) findings.push(finding(this.agent, { id: `browser-unexpected-route-${browser.unexpectedRoutes.indexOf(route)}`, category: "UNEXPECTED_ROUTE", severity: "HIGH", confidence: "HIGH", title: "Approved browser flow reached an unexpected route", safeSummary: `The browser evidence reached unapproved route ${route}.`, affectedArtifacts: [snapshot.snapshotId], affectedRoutes: [route], evidence: evidence(snapshot, [route]), blocking: true, repairRequired: true }));
    for (const error of browser.consoleErrors.filter((item) => !item.approvedNoise)) findings.push(finding(this.agent, { id: `browser-${error.kind}-${browser.consoleErrors.indexOf(error)}`, category: error.kind.replaceAll("-", "_").toUpperCase(), severity: error.kind === "server-5xx" || error.kind === "failed-api" ? "HIGH" : "MEDIUM", confidence: "HIGH", title: "Browser runtime error", safeSummary: text(error.safeSummary), affectedArtifacts: [snapshot.snapshotId], affectedRoutes: error.route ? [error.route] : undefined, evidence: evidence(snapshot, error.route ? [error.route] : []), blocking: error.kind === "server-5xx" || error.kind === "failed-api", repairRequired: true }));
    for (const request of browser.failedRequests) findings.push(finding(this.agent, { id: `browser-request-${browser.failedRequests.indexOf(request)}`, category: "NETWORK_FAILURE", severity: "HIGH", confidence: "HIGH", title: "Approved flow contains a failed request", safeSummary: text(request.safeSummary), affectedArtifacts: [snapshot.snapshotId], affectedRoutes: request.route ? [request.route] : undefined, evidence: evidence(snapshot, request.route ? [request.route] : []), blocking: true, repairRequired: true }));
    return findings;
  }
}

export class SecurityReviewAgent extends DeterministicReviewAgent {
  readonly agent = "security-reviewer" as const;
  readonly checksExecuted = ["security.trust-boundaries", "security.secret-exposure", "security.authorization", "security.data-access", "security.authentication", "security.injection", "security.headers", "security.cookies", "security.error-exposure", "security.supply-chain-boundary"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const item of sourceText(snapshot)) {
      const fileId = item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-");
      if (secretPattern.test(item.content) || item.file.markers.includes("secret-client-bundle")) findings.push(finding(this.agent, { id: `security-secret-exposure-${fileId}`, category: "SECRET_EXPOSURE", severity: "CRITICAL", confidence: "HIGH", title: "Secret material is exposed in reviewable client/source evidence", safeSummary: "A deterministic secret-boundary check found a credential-like value in the implementation evidence.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "secret-boundary" }));
      if (item.file.markers.includes("authorization-bypass") || item.file.markers.includes("cross-user-access")) findings.push(finding(this.agent, { id: `security-${item.file.markers.includes("authorization-bypass") ? "authorization-bypass" : "cross-user-access"}-${fileId}`, category: "AUTHORIZATION", severity: "CRITICAL", confidence: "HIGH", title: "Authorization boundary is not preserved", safeSummary: "The deterministic security evidence marks a cross-user or privilege boundary defect.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "owner-isolation" }));
      if (item.file.markers.includes("rls-missing") && snapshot.capabilities.includes("DATABASE")) findings.push(finding(this.agent, { id: `security-rls-contract-${fileId}`, category: "RLS_POLICY", severity: "HIGH", confidence: "HIGH", title: "Database isolation evidence is incomplete", safeSummary: "The approved database surface has no current row-level isolation evidence.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "database-owner-isolation" }));
      const markerRules: Array<[string, string, ReviewFinding["severity"], boolean, string, string]> = [
        ["unsafe-redirect", "UNSAFE_REDIRECT", "HIGH", true, "An unvalidated redirect target is marked in the implementation evidence.", "redirect-validation"],
        ["xss-risk", "XSS", "HIGH", true, "The implementation evidence marks an unsafe output or HTML rendering path.", "output-encoding"],
        ["csrf-missing", "CSRF", "HIGH", true, "A state-changing browser action lacks the required CSRF boundary evidence.", "csrf-protection"],
        ["ssrf-risk", "SSRF", "HIGH", true, "An external fetch path is marked as lacking destination validation.", "outbound-allowlist"],
        ["missing-csp", "SECURITY_HEADERS", "MEDIUM", false, "Security header evidence does not include a current CSP boundary.", "security-headers"],
        ["cors-wildcard", "CORS", "HIGH", true, "A wildcard CORS policy is marked in the implementation evidence.", "cors-allowlist"],
        ["insecure-cookie", "COOKIE_FLAGS", "HIGH", true, "A session cookie is marked without secure browser flags.", "secure-cookie"],
        ["service-role-client", "PRIVILEGED_DATA_EXPOSURE", "CRITICAL", true, "A privileged service role is marked in client-visible evidence.", "server-secret-boundary"],
        ["error-leakage", "ERROR_EXPOSURE", "MEDIUM", false, "The implementation evidence marks an unsafe error or stack exposure path.", "safe-errors"],
        ["weak-crypto", "CRYPTOGRAPHIC_MISUSE", "HIGH", true, "The implementation evidence marks weak or unsuitable cryptographic handling.", "approved-cryptography"],
        ["unsafe-logging", "LOGGING_SECURITY", "HIGH", true, "The implementation evidence marks sensitive or security-relevant data entering unsafe logs.", "redacted-logging"],
        ["rate-limit-missing", "RATE_LIMIT", "HIGH", true, "The implementation evidence marks an abuse-prone operation without the required rate controls.", "abuse-controls"],
        ["session-invalidation-missing", "SESSION_SECURITY", "HIGH", true, "The implementation evidence marks a session that cannot be invalidated at the required boundary.", "session-invalidation"],
        ["injection-risk", "INJECTION", "HIGH", true, "The implementation evidence marks untrusted input reaching a query or command boundary.", "parameterized-input"],
        ["privilege-escalation", "PRIVILEGE_ESCALATION", "CRITICAL", true, "The implementation evidence marks a privilege escalation path.", "server-authorization"],
        ["user-id-spoofing", "USER_ID_SPOOFING", "CRITICAL", true, "The implementation evidence marks caller-controlled user identity at a trusted boundary.", "trusted-identity"],
        ["file-upload-risk", "FILE_UPLOAD", "HIGH", true, "The implementation evidence marks an unsafe file-upload or storage path.", "file-validation"],
        ["third-party-unsafe", "THIRD_PARTY_INTEGRATION", "HIGH", true, "The implementation evidence marks an unsafe third-party integration boundary.", "integration-allowlist"],
      ];
      for (const [marker, category, severity, blocking, safeSummary, invariant] of markerRules) if (item.file.markers.includes(marker)) findings.push(finding(this.agent, { id: `security-${marker}-${fileId}`, category, severity, confidence: "HIGH", title: "Security control evidence requires review", safeSummary, affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking, repairRequired: true, invariant }));
    }
    return findings;
  }
}

export class SecurityTestAgent extends DeterministicReviewAgent {
  readonly agent = "security-test" as const;
  readonly checksExecuted = ["security-test.target-boundary", "security-test.request-budget", "security-test.authorization", "security-test.input", "security-test.headers", "security-test.cookies"];
  executeProbes(input: Parameters<typeof executeBoundedSecurityProbes>[0]) { return executeBoundedSecurityProbes(input); }
  protected inspect(snapshot: ReviewSnapshot) {
    const raw = snapshot.evidencePack.securityTests;
    if (!raw) return [finding(this.agent, { id: "security-test-evidence-missing", category: "SECURITY_TEST_EVIDENCE", severity: "HIGH", confidence: "HIGH", title: "Bounded security-test evidence is missing", safeSummary: "Security testing was activated but no local/disposable target evidence was supplied.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "security-test-evidence" })];
    const testEvidence = SecurityTestEvidenceSchema.parse(raw);
    const findings: ReviewFinding[] = [];
    if (testEvidence.targetBoundary !== "LOCAL_TEST_APPLICATION" && testEvidence.targetBoundary !== "DISPOSABLE_TEST_APPLICATION" && testEvidence.targetBoundary !== "EXPLICIT_AUTHORIZED_STAGING") findings.push(finding(this.agent, { id: "security-test-target-boundary", category: "SECURITY_TEST_BOUNDARY", severity: "CRITICAL", confidence: "HIGH", title: "Security test target is outside the approved boundary", safeSummary: "Security probes may run only against a local, disposable, or explicitly authorized staging application.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: false, invariant: "authorized-security-target" }));
    for (const probe of testEvidence.probes.filter((item) => item.status === "FAIL")) findings.push(finding(this.agent, { id: `security-test-${probe.probeId}`, category: `SECURITY_TEST_${probe.kind}`, severity: probe.severity, confidence: "HIGH", title: "Bounded adversarial security probe failed", safeSummary: probe.actual, affectedArtifacts: [probe.route], affectedRoutes: [probe.route], evidence: evidence(snapshot, probe.safeEvidence), blocking: ["HIGH", "CRITICAL"].includes(probe.severity), repairRequired: true, invariant: "security-control" }));
    return findings;
  }
}

export class GermanWebComplianceAgent extends DeterministicReviewAgent {
  readonly agent = "german-web-compliance" as const;
  readonly checksExecuted = ["legal.primary-source-currentness", "legal.impressum", "legal.privacy-inventory", "legal.consent-execution", "legal.ecommerce", "legal.bfsg-applicability", "legal.newsletter", "legal.vsbg"];
  protected inspect(snapshot: ReviewSnapshot) {
    const raw = snapshot.evidencePack.germanCompliance;
    if (!raw) return [finding(this.agent, { id: "german-compliance-evidence-missing", category: "LEGAL_COMPLIANCE", severity: "HIGH", confidence: "HIGH", title: "Current German compliance evidence is missing", safeSummary: "A German public-site review requires current primary-source evidence and an implementation-derived applicability result.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: false, invariant: "legal-currentness" })];
    const compliance = GermanComplianceResultSchema.parse(raw);
    if (compliance.verdict === "NOT_APPLICABLE") return [];
    return compliance.findings.filter((item) => item.status !== "NOT_APPLICABLE").map((item) => finding(this.agent, { id: item.id, category: `LEGAL_${item.domain}`, severity: item.severity === "BLOCKING" ? "HIGH" : item.severity === "WARNING" ? "MEDIUM" : "LOW", confidence: "HIGH", title: "German web compliance finding", safeSummary: item.summary, affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot, item.evidenceRefs), blocking: item.severity === "BLOCKING" || ["USER_INPUT_REQUIRED", "LEGAL_REVIEW_REQUIRED"].includes(item.status), repairRequired: item.status === "IMPLEMENTATION_MISMATCH", invariant: item.status === "USER_INPUT_REQUIRED" ? "legal-user-input-required" : item.status === "LEGAL_REVIEW_REQUIRED" ? "legal-professional-review" : "legal-implementation" }));
  }
}

export class ExploratoryQAAgent extends DeterministicReviewAgent {
  readonly agent = "exploratory-qa" as const;
  readonly checksExecuted = ["exploratory.edge-cases", "exploratory.recovery", "exploratory.navigation", "exploratory.resize", "exploratory.keyboard"];
  executeScenarios(input: Parameters<typeof executeBoundedExploratoryScenarios>[0]) { return executeBoundedExploratoryScenarios(input); }
  protected inspect(snapshot: ReviewSnapshot) {
    const raw = snapshot.evidencePack.exploratory;
    if (!raw) return [finding(this.agent, { id: "exploratory-evidence-missing", category: "EXPLORATORY_EVIDENCE", severity: "HIGH", confidence: "HIGH", title: "Exploratory QA evidence is missing", safeSummary: "An implemented interactive/public site requires a bounded exploratory QA cycle in addition to deterministic Browser QA.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "exploratory-qa-evidence" })];
    const exploratory = ExploratoryQAEvidenceSchema.parse(raw);
    return exploratory.scenarios.filter((scenario) => scenario.status === "FAIL").map((scenario) => { const blocking = scenario.blocking || ["HIGH", "CRITICAL"].includes(scenario.severity); return finding(this.agent, { id: `exploratory-${scenario.scenarioId}`, category: "EXPLORATORY_FAILURE", severity: scenario.severity, confidence: "HIGH", title: "Exploratory edge-case failure", safeSummary: `${scenario.actual} Expected: ${scenario.expected}`, affectedArtifacts: [scenario.route], affectedRoutes: [scenario.route], evidence: evidence(snapshot, scenario.safeEvidence), blocking, repairRequired: blocking, invariant: "exploratory-recovery" }); });
  }
}

function criticFindings(snapshot: ReviewSnapshot, agent: ReviewAgentId, checks: Array<[string, string, ReviewFinding["severity"], boolean, string, string]>) {
  const findings: ReviewFinding[] = [];
  for (const item of sourceText(snapshot)) for (const [marker, category, severity, blocking, safeSummary, invariant] of checks) if (item.file.markers.includes(marker)) findings.push(finding(agent, { id: `${agent}-${marker}-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category, severity, confidence: "HIGH", title: `${agent} finding`, safeSummary, affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking, repairRequired: blocking, invariant }));
  return findings;
}

export class UXCriticAgent extends DeterministicReviewAgent {
  readonly agent = "ux-critic" as const;
  readonly checksExecuted = ["ux.clarity", "ux.navigation", "ux.cognitive-load", "ux.forms", "ux.recovery", "ux.mobile"];
  protected inspect(snapshot: ReviewSnapshot) { return criticFindings(snapshot, this.agent, [["confusing-ux", "UX_CLARITY", "HIGH", true, "The implementation evidence marks a user path as confusing or ambiguous.", "user-clarity"], ["unclear-cta", "UX_AFFORDANCE", "MEDIUM", false, "The primary action lacks a clear affordance in the bounded UX evidence.", "cta-clarity"], ["excessive-steps", "UX_FRICTION", "MEDIUM", false, "The user flow contains unnecessary steps or friction.", "flow-friction"], ["mobile-ux-failure", "UX_MOBILE", "HIGH", true, "The bounded evidence marks the mobile interaction as difficult to use.", "mobile-usability"]]); }
}

export class ProductCriticAgent extends DeterministicReviewAgent {
  readonly agent = "product-critic" as const;
  readonly checksExecuted = ["product.brief-alignment", "product.audience", "product.outcomes", "product.scope", "product.content"];
  protected inspect(snapshot: ReviewSnapshot) { return criticFindings(snapshot, this.agent, [["brief-deviation", "PRODUCT_SCOPE_MISMATCH", "HIGH", true, "The implementation evidence marks behavior that deviates from the approved Brief or required outcome.", "brief-alignment"], ["missing-approved-outcome", "PRODUCT_OUTCOME_MISSING", "HIGH", true, "A required user outcome is marked as absent from the implementation.", "required-outcome"], ["audience-mismatch", "PRODUCT_AUDIENCE_MISMATCH", "MEDIUM", false, "The implementation evidence marks a mismatch with the approved audience.", "audience-fit"]]); }
}

export class ArchitectureCriticAgent extends DeterministicReviewAgent {
  readonly agent = "architecture-critic" as const;
  readonly checksExecuted = ["architecture.ownership", "architecture.trust-boundaries", "architecture.failure-modes", "architecture.consistency", "architecture.complexity"];
  reviewApprovedArchitecture(input: { architecture: TechnicalArchitecture }): ArchitectureCriticResult {
    const architecture = TechnicalArchitectureSchema.parse(input.architecture);
    const architectureChecksum = checksumPersistedDocument(architecture);
    const evidenceRefs = [`architecture:${architectureChecksum.slice(0, 16)}`];
    const findings: ArchitectureCriticResult["findings"] = [];
    const add = (item: ArchitectureCriticResult["findings"][number]) => findings.push(item);
    const stateful = architecture.serverActions.length > 0 || architecture.routeHandlers.length > 0 || architecture.schemaPlan.length > 0 || architecture.supabaseDatabaseRequirements.length > 0 || architecture.authenticationPlan.toLowerCase() !== "none";
    const duplicateBoundaries = architecture.componentBoundaries.filter((boundary, index) => architecture.componentBoundaries.indexOf(boundary) !== index);
    if (!architecture.acceptance.accepted) add({ id: "architecture-critic-not-approved", category: "OWNERSHIP", severity: "CRITICAL", summary: "The architecture critic received an architecture without host approval.", requiredAction: "Return to the canonical Architecture approval boundary before implementation.", evidenceRefs });
    if (duplicateBoundaries.length) add({ id: "architecture-critic-duplicate-boundary", category: "OWNERSHIP", severity: "HIGH", summary: "The approved architecture contains duplicate component ownership boundaries.", requiredAction: "Assign each component boundary to one stable owner before implementation.", evidenceRefs });
    if (architecture.componentDecisions.some((decision) => decision.serverOrClient === "client" && /secret|database|service role|private key|credential/i.test(decision.rationale))) add({ id: "architecture-critic-client-trust-boundary", category: "TRUST_BOUNDARY", severity: "CRITICAL", summary: "A client architecture decision describes a secret or privileged server responsibility.", requiredAction: "Move the privileged responsibility behind the approved server boundary.", evidenceRefs });
    const unownedAreas = architecture.componentDecisions.map((decision) => decision.area).filter((area) => !architecture.componentBoundaries.includes(area));
    if (unownedAreas.length) add({ id: "architecture-critic-unowned-area", category: "OWNERSHIP", severity: "MEDIUM", summary: "Architecture decisions include areas without a matching declared component owner.", requiredAction: "Bind each architecture decision to one explicit component or specialist owner.", evidenceRefs });
    if (stateful && architecture.securityControls.length === 0) add({ id: "architecture-critic-security-controls", category: "TRUST_BOUNDARY", severity: "HIGH", summary: "A stateful architecture has no explicit security-control plan.", requiredAction: "Define the minimal approved authentication, authorization, data, error, and boundary controls before implementation.", evidenceRefs });
    if (stateful && architecture.testStrategy.length === 0) add({ id: "architecture-critic-failure-recovery", category: "FAILURE_RECOVERY", severity: "HIGH", summary: "A stateful architecture has no explicit validation or recovery strategy.", requiredAction: "Define tests and recovery behavior for the stateful operations before implementation.", evidenceRefs });
    const blockingFindings = findings.filter((finding) => ["HIGH", "CRITICAL"].includes(finding.severity)).map((finding) => finding.id);
    return ArchitectureCriticResultSchema.parse({ architectureChecksum, findings, blockingFindings, verdict: blockingFindings.length ? "BLOCK" : findings.length ? "WARN" : "PASS" });
  }
  assertApprovedArchitectureReady(input: { architecture: TechnicalArchitecture }) {
    const result = this.reviewApprovedArchitecture(input);
    if (result.verdict === "BLOCK") throw new Error("ARCHITECTURE_CRITIC_BLOCKED");
    return result;
  }
  protected inspect(snapshot: ReviewSnapshot) { return criticFindings(snapshot, this.agent, [["unnecessary-complexity", "ARCHITECTURE_COMPLEXITY", "HIGH", true, "The implementation evidence marks unnecessary architecture or coupling for the approved scope.", "bounded-complexity"], ["trust-boundary-breach", "ARCHITECTURE_TRUST_BOUNDARY", "CRITICAL", true, "The implementation evidence marks a trust-boundary breach.", "trust-boundary"], ["missing-failure-mode", "ARCHITECTURE_FAILURE_MODE", "HIGH", true, "A relevant failure or recovery path is missing from the architecture evidence.", "failure-recovery"], ["client-server-coupling", "ARCHITECTURE_CLIENT_SERVER", "MEDIUM", false, "The client/server split is marked as unnecessarily coupled.", "client-server-boundary"]]); }
}

export function runPreImplementationArchitectureCritic(input: { architecture: TechnicalArchitecture }) {
  return new ArchitectureCriticAgent().assertApprovedArchitectureReady(input);
}

export class AccessibilityReviewAgent extends DeterministicReviewAgent {
  readonly agent = "accessibility-review" as const;
  readonly checksExecuted = ["a11y.names", "a11y.labels", "a11y.keyboard", "a11y.focus", "a11y.errors", "a11y.contrast"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const issue of snapshot.evidencePack.browser?.accessibility ?? []) {
      const blocking = issue.impact === "CRITICAL" || issue.impact === "HIGH";
      findings.push(finding(this.agent, { id: `a11y-${issue.rule}-${snapshot.evidencePack.browser?.accessibility.indexOf(issue) ?? 0}`, category: `WCAG_${issue.rule.toUpperCase().replaceAll("-", "_")}`, severity: issue.impact, confidence: "HIGH", title: "Accessibility audit finding", safeSummary: text(issue.safeSummary), affectedArtifacts: [snapshot.snapshotId], affectedRoutes: issue.route ? [issue.route] : undefined, evidence: evidence(snapshot, issue.route ? [issue.route] : []), blocking, repairRequired: blocking || issue.impact !== "INFO" }));
    }
    return findings;
  }
}

export class PerformanceReviewAgent extends DeterministicReviewAgent {
  readonly agent = "performance-review" as const;
  readonly checksExecuted = ["performance.bundle", "performance.client-boundaries", "performance.images", "performance.requests", "performance.layout-shift"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    const metrics = snapshot.evidencePack.metrics;
    if (metrics.clientJsKb !== undefined && metrics.clientJsKb > 500) findings.push(finding(this.agent, { id: "performance-client-js", category: "CLIENT_BUNDLE_SIZE", severity: "MEDIUM", confidence: "HIGH", title: "Client JavaScript exceeds the review budget", safeSummary: `Measured client JavaScript is ${metrics.clientJsKb} KiB, above the 500 KiB review threshold.`, affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: false, repairRequired: true, invariant: "bounded-client-javascript" }));
    if (metrics.cumulativeLayoutShift !== undefined && metrics.cumulativeLayoutShift > 0.25) findings.push(finding(this.agent, { id: "performance-layout-shift", category: "LAYOUT_SHIFT", severity: "HIGH", confidence: "HIGH", title: "Measured layout shift is excessive", safeSummary: `Measured cumulative layout shift is ${metrics.cumulativeLayoutShift}, above the 0.25 review threshold.`, affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "stable-layout" }));
    for (const item of sourceText(snapshot)) if (item.file.markers.includes("unnecessary-use-client")) findings.push(finding(this.agent, { id: `performance-use-client-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "UNNECESSARY_CLIENT_COMPONENT", severity: "MEDIUM", confidence: "MEDIUM", title: "Client boundary may be broader than the interaction requires", safeSummary: "The bounded source evidence marks a use-client boundary without a recorded interaction need; architecture remains the authority for the final judgment.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: false, repairRequired: true, architectureRefs: snapshot.architectureOperationRefs }));
    return findings;
  }
}

export class VisualRegressionAgent extends DeterministicReviewAgent {
  readonly agent = "visual-regression" as const;
  readonly checksExecuted = ["visual.layout", "visual.hierarchy", "visual.responsive", "visual.components", "visual.overflow"];
  protected inspect(snapshot: ReviewSnapshot) {
    if (!snapshot.designChecksum) return [finding(this.agent, { id: "visual-design-binding-missing", category: "DESIGN_BINDING", severity: "HIGH", confidence: "HIGH", title: "Visual review has no approved Design binding", safeSummary: "Visual comparison cannot be admitted without the approved Design checksum.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true })];
    const findings: ReviewFinding[] = [];
    for (const [index, comparison] of (snapshot.evidencePack.browser?.visualComparisons ?? []).entries()) if (comparison.classification === "DESIGN_CONTRACT_VIOLATION") findings.push(finding(this.agent, { id: `visual-${comparison.route.replaceAll(/[^a-z0-9]+/gi, "-")}-${index}`, category: "DESIGN_CONTRACT_VIOLATION", severity: "HIGH", confidence: "HIGH", title: "Implemented visual behavior violates the approved Design", safeSummary: text(comparison.safeSummary), affectedArtifacts: [comparison.approvedDesignRef, comparison.screenshotRef], affectedRoutes: [comparison.route], evidence: evidence(snapshot, [comparison.screenshotRef, comparison.approvedDesignRef]), blocking: true, repairRequired: true, designRefs: [comparison.approvedDesignRef] }));
    return findings;
  }
}

export class CodeReviewAgent extends DeterministicReviewAgent {
  readonly agent = "code-integration-reviewer" as const;
  readonly checksExecuted = ["code.module-boundaries", "code.types", "code.errors", "code.client-server", "code.secrets", "code.dead-code"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const item of sourceText(snapshot)) {
      const rules: Array<[string, string, ReviewFinding["severity"], boolean, string]> = [["production-todo", "TODO_IN_PRODUCTION", "LOW", false, "Production source contains an unfinished TODO marker."], ["unsafe-any", "UNSAFE_TYPE_ESCAPE", "MEDIUM", false, "Production source contains an unsafe type escape marker."], ["wrong-client-server-import", "SERVER_CLIENT_BOUNDARY", "HIGH", true, "Source evidence marks an invalid server/client import boundary."], ["secret-client-bundle", "SECRET_EXPOSURE", "CRITICAL", true, "Source evidence marks secret material in a client bundle."], ["swallowed-error", "ERROR_HANDLING", "MEDIUM", false, "Source evidence marks an error that is swallowed without a recovery path."]];
      for (const [marker, category, severity, blocking, summary] of rules) if (item.file.markers.includes(marker)) findings.push(finding(this.agent, { id: `code-${marker}-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category, severity, confidence: severity === "LOW" ? "MEDIUM" : "HIGH", title: "Code review finding", safeSummary: summary, affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking, repairRequired: true, architectureRefs: snapshot.architectureOperationRefs }));
    }
    return findings;
  }
}

export class SEOReviewAgent extends DeterministicReviewAgent {
  readonly agent = "seo-review" as const;
  readonly checksExecuted = ["seo.title", "seo.description", "seo.canonical", "seo.robots", "seo.sitemap", "seo.social-metadata", "seo.indexability", "seo.search-essentials", "seo.structured-data", "seo.local-facts"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    const seo = snapshot.evidencePack.seo ? SEOImplementationEvidenceSchema.parse(snapshot.evidencePack.seo) : undefined;
    if (seo?.publicSite && seo.indexableRoutes.some((route) => seo.noindexRoutes.includes(route))) findings.push(finding(this.agent, { id: "seo-accidental-noindex", category: "ACCIDENTAL_NOINDEX", severity: "HIGH", confidence: "HIGH", title: "An intended public route is marked noindex", safeSummary: "SEO evidence marks an indexable route as noindex.", affectedArtifacts: [snapshot.snapshotId], affectedRoutes: seo.indexableRoutes.filter((route) => seo.noindexRoutes.includes(route)), evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "public-indexability" }));
    if (seo?.publicSite && seo.indexableRoutes.some((route) => seo.crawlerBlockedRoutes.includes(route))) findings.push(finding(this.agent, { id: "seo-blocked-crawler", category: "BLOCKED_CRAWLER", severity: "HIGH", confidence: "HIGH", title: "An intended public route is blocked from crawling", safeSummary: "SEO evidence marks an intended public route as blocked by the crawler policy.", affectedArtifacts: [snapshot.snapshotId], affectedRoutes: seo.indexableRoutes.filter((route) => seo.crawlerBlockedRoutes.includes(route)), evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "public-crawlability" }));
    if (seo?.activated && seo.publicSite && seo.indexableRoutes.some((route) => !seo.canonicalRoutes.includes(route))) findings.push(finding(this.agent, { id: "seo-canonical-missing", category: "MISSING_CANONICAL", severity: "HIGH", confidence: "HIGH", title: "An indexable route has no canonical evidence", safeSummary: "Every intended indexable route needs an implementation-bound canonical policy.", affectedArtifacts: [snapshot.snapshotId], affectedRoutes: seo.indexableRoutes.filter((route) => !seo.canonicalRoutes.includes(route)), evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "canonical-indexability" }));
    if (seo?.activated && seo.publicSite && (!seo.sitemapPresent || !seo.robotsPolicyPresent || !seo.searchEssentialsAligned || !seo.noRankingGuarantees)) findings.push(finding(this.agent, { id: "seo-technical-policy", category: "SEO_POLICY_INCOMPLETE", severity: "HIGH", confidence: "HIGH", title: "Technical SEO policy evidence is incomplete", safeSummary: "SEO implementation must provide crawl/index controls and avoid ranking guarantees.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "search-essentials-alignment" }));
    if (seo?.structuredDataApplicable && !seo.structuredDataPresent) findings.push(finding(this.agent, { id: "seo-structured-data-missing", category: "STRUCTURED_DATA", severity: "MEDIUM", confidence: "MEDIUM", title: "Applicable structured-data evidence is missing", safeSummary: "The approved page/entity model calls for structured data, but no bounded implementation evidence is present.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: false, repairRequired: true }));
    if (seo?.localBusinessApplicable && !seo.localFactsAuthoritative) findings.push(finding(this.agent, { id: "seo-local-facts", category: "LOCAL_FACTS", severity: "HIGH", confidence: "HIGH", title: "Local SEO facts are not authoritative", safeSummary: "Local SEO must use supplied business identity and coverage facts; locations must not be invented.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: false, invariant: "local-fact-authenticity" }));
    if (seo?.doorwayPagePattern) findings.push(finding(this.agent, { id: "seo-doorway-pages", category: "DOORWAY_PAGES", severity: "HIGH", confidence: "HIGH", title: "A doorway-page pattern is present", safeSummary: "Near-duplicate location pages are not an acceptable SEO implementation strategy.", affectedArtifacts: [snapshot.snapshotId], evidence: evidence(snapshot), blocking: true, repairRequired: true, invariant: "people-first-content" }));
    const publicFiles = sourceText(snapshot).filter(({ file }) => file.relativePath.includes("/app/") || file.relativePath.startsWith("src/app/") || file.relativePath.includes("metadata"));
    for (const route of snapshot.approvedRoutes) {
      const matching = publicFiles.filter(({ file }) => file.content?.includes(route) || file.relativePath.includes(route.replaceAll("/", "-")));
      if (matching.length && !matching.some(({ content }) => /title|metadata|<title>/i.test(content))) findings.push(finding(this.agent, { id: `seo-title-${route.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "MISSING_TITLE", severity: "MEDIUM", confidence: "MEDIUM", title: "Public route is missing title evidence", safeSummary: `No bounded title or metadata evidence was found for approved route ${route}.`, affectedArtifacts: [route], affectedRoutes: [route], evidence: evidence(snapshot, [route]), blocking: false, repairRequired: true }));
    }
    return findings;
  }
}

export class ContentQualityAgent extends DeterministicReviewAgent {
  readonly agent = "content-quality" as const;
  readonly checksExecuted = ["content.placeholder", "content.provenance", "content.factual-claims", "content.brief-consistency"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const item of sourceText(snapshot)) {
      const content = item.content;
      if (/lorem ipsum|your company|john doe|placeholder text/i.test(content) || item.file.markers.includes("placeholder-content")) findings.push(finding(this.agent, { id: `content-placeholder-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "PLACEHOLDER_CONTENT", severity: "MEDIUM", confidence: "HIGH", title: "Placeholder content remains in the implementation", safeSummary: "The content check found a known placeholder token or an explicit placeholder provenance marker.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: false, repairRequired: true }));
      if (item.file.markers.some((marker) => ["fake-statistic", "fake-certification", "fake-testimonial", "fake-legal-information", "fake-address", "fake-phone", "placeholder-email", "brief-contradiction"].includes(marker))) findings.push(finding(this.agent, { id: `content-fabricated-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "FABRICATED_FACTUAL_CLAIM", severity: "HIGH", confidence: "HIGH", title: "Unapproved factual content is present", safeSummary: "The content provenance evidence marks a factual claim that is neither user-supplied nor approved.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true }));
    }
    return findings;
  }
}

export class DependencyGuardianAgent extends DeterministicReviewAgent {
  readonly agent = "dependency-guardian" as const;
  readonly checksExecuted = ["dependencies.authorization", "dependencies.duplicates", "dependencies.reference-usage", "dependencies.client-boundary", ...SupplyChainSecuritySkill.checks];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const dependency of snapshot.evidencePack.dependencyDelta) {
      if (!dependency.authorized) findings.push(finding(this.agent, { id: `dependency-unauthorized-${dependency.packageName}`, category: "UNAUTHORIZED_DEPENDENCY", severity: "HIGH", confidence: "HIGH", title: "Dependency delta lacks approval", safeSummary: `Dependency ${dependency.packageName} was changed without an Architecture, TaskGraph, or approved change reference.`, affectedArtifacts: [dependency.packageName], evidence: evidence(snapshot, [dependency.packageName]), blocking: true, repairRequired: true, architectureRefs: dependency.architectureRef ? [dependency.architectureRef] : undefined, invariant: "dependency-authority" }));
      else if (!dependency.referenced) findings.push(finding(this.agent, { id: `dependency-unused-${dependency.packageName}`, category: "UNREFERENCED_DEPENDENCY", severity: "MEDIUM", confidence: "HIGH", title: "Dependency delta is not referenced", safeSummary: `Dependency ${dependency.packageName} is present in the delta but has no bounded source reference.`, affectedArtifacts: [dependency.packageName], evidence: evidence(snapshot, [dependency.packageName]), blocking: false, repairRequired: true }));
    }
    for (const item of sourceText(snapshot)) {
      const content = item.content;
      if (item.file.markers.includes("lockfile-drift")) findings.push(finding(this.agent, { id: `dependency-lockfile-drift-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "LOCKFILE_DRIFT", severity: "HIGH", confidence: "HIGH", title: "Lockfile drift is marked in the evidence", safeSummary: "The dependency graph and lockfile are not aligned at the reviewed snapshot.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "lockfile-integrity" }));
      if (item.file.markers.includes("committed-secret") || secretPattern.test(content)) findings.push(finding(this.agent, { id: `dependency-secret-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category: "COMMITTED_SECRET", severity: "CRITICAL", confidence: "HIGH", title: "A credential-like value is present in dependency/source evidence", safeSummary: "The supply-chain check detected secret-shaped material without exposing its value.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "secret-boundary" }));
      const supplyChainMarkers: Array<[string, string, ReviewFinding["severity"], boolean, string]> = [
        ["vulnerable-dependency", "VULNERABLE_DEPENDENCY", "CRITICAL", true, "Dependency evidence marks a known vulnerability that must be resolved or explicitly risk-accepted."],
        ["deprecated-dependency", "DEPRECATED_DEPENDENCY", "HIGH", true, "Dependency evidence marks an abandoned or deprecated package in the implementation surface."],
        ["typosquatting-indicator", "TYPOSQUATTING_INDICATOR", "HIGH", true, "Dependency evidence marks a package-name similarity or provenance concern."],
        ["runtime-dev-confusion", "RUNTIME_DEV_CONFUSION", "HIGH", true, "A development-only dependency is marked as leaking into the runtime surface."],
        ["client-server-package-leakage", "CLIENT_SERVER_PACKAGE_LEAKAGE", "HIGH", true, "A server-only package is marked in a client-visible dependency boundary."],
        ["dependency-integrity-mismatch", "DEPENDENCY_INTEGRITY", "HIGH", true, "Dependency integrity evidence does not match the approved lockfile or manifest."],
        ["unnecessary-dependency", "UNNECESSARY_DEPENDENCY", "MEDIUM", false, "Dependency evidence marks a package with no approved runtime or development purpose."],
      ];
      for (const [marker, category, severity, blocking, safeSummary] of supplyChainMarkers) if (item.file.markers.includes(marker)) findings.push(finding(this.agent, { id: `dependency-${marker}-${item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-")}`, category, severity, confidence: "HIGH", title: "Supply-chain dependency finding", safeSummary, affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking, repairRequired: true, invariant: "supply-chain-integrity" }));
      if (item.file.relativePath === "package.json") {
        try {
          const packageJson = JSON.parse(content) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
          if (Object.keys(packageJson.scripts ?? {}).some((name) => /^(preinstall|install|postinstall)$/i.test(name))) findings.push(finding(this.agent, { id: "dependency-lifecycle-script", category: "LIFECYCLE_SCRIPT", severity: "MEDIUM", confidence: "MEDIUM", title: "A dependency lifecycle script requires supply-chain review", safeSummary: "Install-time scripts expand the supply-chain execution surface and require explicit review.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: false, repairRequired: true, invariant: "dependency-lifecycle" }));
          if ([...Object.entries(packageJson.dependencies ?? {}), ...Object.entries(packageJson.devDependencies ?? {})].some(([name, spec]) => /^(?:https?:|git\+|file:)/i.test(name) || (typeof spec === "string" && /^(?:https?:|git\+|file:)/i.test(spec)))) findings.push(finding(this.agent, { id: "dependency-remote-source", category: "REMOTE_CODE_SOURCE", severity: "HIGH", confidence: "HIGH", title: "A dependency uses a remote or local code source", safeSummary: "Remote/local dependency sources need explicit authorization and integrity evidence.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "authorized-dependencies" }));
        } catch { /* package validation owns malformed package.json errors */ }
      }
    }
    return findings;
  }
}

export class DocumentationAgent extends DeterministicReviewAgent {
  readonly agent = "documentation" as const;
  readonly checksExecuted = ["documentation.setup", "documentation.environment", "documentation.validation-commands"];
  readonly allowedWriteScopes = DOCUMENTATION_WRITE_SCOPES;
  protected inspect() { return []; }
  canWrite(path: string, authorized = false) { return reviewMutationDecision({ agent: this.agent, operation: "SOURCE_WRITE", path, documentationWriteAuthorized: authorized }); }
  assertCanWrite(path: string, authorized = false) { return assertReviewMutationAllowed({ agent: this.agent, operation: "SOURCE_WRITE", path, documentationWriteAuthorized: authorized }); }
}

export class ReleaseReadinessAgent {
  readonly agent = "release-readiness" as const;
  evaluate(input: Parameters<typeof evaluateReleaseReadiness>[0]): ReleaseReadinessResult { return evaluateReleaseReadiness(input); }
}

export const deterministicLightweightReviewers: readonly LightweightReviewRunner[] = [
  new BrowserQAAgent(),
  new SecurityReviewAgent(),
  new SecurityTestAgent(),
  new GermanWebComplianceAgent(),
  new ExploratoryQAAgent(),
  new UXCriticAgent(),
  new ProductCriticAgent(),
  new ArchitectureCriticAgent(),
  new AccessibilityReviewAgent(),
  new PerformanceReviewAgent(),
  new VisualRegressionAgent(),
  new CodeReviewAgent(),
  new SEOReviewAgent(),
  new ContentQualityAgent(),
  new DependencyGuardianAgent(),
  new DocumentationAgent(),
];
