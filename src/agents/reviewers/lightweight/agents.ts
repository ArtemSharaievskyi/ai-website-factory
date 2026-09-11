import { AgentReviewResultSchema, ReviewFindingSchema, type AgentReviewResult, type ReviewFinding, type ReviewSnapshot, type ReviewAgentId, type ReleaseReadinessResult } from "@/domain/review/lightweight";
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
  readonly checksExecuted = ["security.trust-boundaries", "security.secret-exposure", "security.authorization", "security.data-access"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const item of sourceText(snapshot)) {
      const fileId = item.file.relativePath.replaceAll(/[^a-z0-9]+/gi, "-");
      if (secretPattern.test(item.content) || item.file.markers.includes("secret-client-bundle")) findings.push(finding(this.agent, { id: `security-secret-exposure-${fileId}`, category: "SECRET_EXPOSURE", severity: "CRITICAL", confidence: "HIGH", title: "Secret material is exposed in reviewable client/source evidence", safeSummary: "A deterministic secret-boundary check found a credential-like value in the implementation evidence.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "secret-boundary" }));
      if (item.file.markers.includes("authorization-bypass") || item.file.markers.includes("cross-user-access")) findings.push(finding(this.agent, { id: `security-${item.file.markers.includes("authorization-bypass") ? "authorization-bypass" : "cross-user-access"}-${fileId}`, category: "AUTHORIZATION", severity: "CRITICAL", confidence: "HIGH", title: "Authorization boundary is not preserved", safeSummary: "The deterministic security evidence marks a cross-user or privilege boundary defect.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "owner-isolation" }));
      if (item.file.markers.includes("rls-missing") && snapshot.capabilities.includes("DATABASE")) findings.push(finding(this.agent, { id: `security-rls-contract-${fileId}`, category: "RLS_POLICY", severity: "HIGH", confidence: "HIGH", title: "Database isolation evidence is incomplete", safeSummary: "The approved database surface has no current row-level isolation evidence.", affectedArtifacts: [item.file.relativePath], affectedFiles: [item.file.relativePath], evidence: evidence(snapshot, [item.file.relativePath]), blocking: true, repairRequired: true, invariant: "database-owner-isolation" }));
    }
    return findings;
  }
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
  readonly checksExecuted = ["seo.title", "seo.description", "seo.canonical", "seo.robots", "seo.sitemap", "seo.social-metadata", "seo.indexability"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
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
  readonly checksExecuted = ["dependencies.authorization", "dependencies.duplicates", "dependencies.reference-usage", "dependencies.client-boundary"];
  protected inspect(snapshot: ReviewSnapshot) {
    const findings: ReviewFinding[] = [];
    for (const dependency of snapshot.evidencePack.dependencyDelta) {
      if (!dependency.authorized) findings.push(finding(this.agent, { id: `dependency-unauthorized-${dependency.packageName}`, category: "UNAUTHORIZED_DEPENDENCY", severity: "HIGH", confidence: "HIGH", title: "Dependency delta lacks approval", safeSummary: `Dependency ${dependency.packageName} was changed without an Architecture, TaskGraph, or approved change reference.`, affectedArtifacts: [dependency.packageName], evidence: evidence(snapshot, [dependency.packageName]), blocking: true, repairRequired: true, architectureRefs: dependency.architectureRef ? [dependency.architectureRef] : undefined, invariant: "dependency-authority" }));
      else if (!dependency.referenced) findings.push(finding(this.agent, { id: `dependency-unused-${dependency.packageName}`, category: "UNREFERENCED_DEPENDENCY", severity: "MEDIUM", confidence: "HIGH", title: "Dependency delta is not referenced", safeSummary: `Dependency ${dependency.packageName} is present in the delta but has no bounded source reference.`, affectedArtifacts: [dependency.packageName], evidence: evidence(snapshot, [dependency.packageName]), blocking: false, repairRequired: true }));
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
  new AccessibilityReviewAgent(),
  new PerformanceReviewAgent(),
  new VisualRegressionAgent(),
  new CodeReviewAgent(),
  new SEOReviewAgent(),
  new ContentQualityAgent(),
  new DependencyGuardianAgent(),
  new DocumentationAgent(),
];
