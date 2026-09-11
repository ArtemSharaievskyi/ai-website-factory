import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  evaluateGermanCompliance,
  GERMAN_PRIMARY_SOURCE_HOSTS,
  OWASP_TOP_10_2025_IDS,
  runSecurityThreatModel,
  SecurityTestEvidenceSchema,
  GermanLegalAuthoritySnapshotSchema,
  type GermanComplianceInput,
} from "./contracts";
import { SecurityThreatModelAgent } from "@/agents/reviewers/security/threat-model";
import { executeBoundedSecurityProbes } from "@/agents/reviewers/security/test-harness";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const implementationChecksum = hash("implementation");
const authority = (domains: GermanComplianceInput["authoritySnapshots"][number]["domains"] = ["DSGVO"]) => GermanLegalAuthoritySnapshotSchema.parse({
  sourceId: "authority:synthetic-current",
  sourceUrl: "https://www.gesetze-im-internet.de/bdsg_2018/",
  retrievedAt: "2026-09-11T00:00:00.000Z",
  legalVersion: "synthetic-current-authority-v1",
  currentness: "CURRENT",
  domains,
  sourceChecksum: hash("authority"),
});
const legalBase = (overrides: Partial<GermanComplianceInput> = {}): GermanComplianceInput => ({
  implementationChecksum,
  publicSite: true,
  germanMarket: true,
  commercial: true,
  siteType: "INFORMATIONAL",
  businessIdentityFactsComplete: true,
  hasImpressumSurface: true,
  hasPrivacySurface: true,
  processingInventory: [{ name: "page-delivery", purpose: "Deliver the public page", category: "STRICTLY_REQUIRED", implementationRefs: ["src/app/page.tsx"], noticeRef: "privacy:page-delivery" }],
  vsbgApplicable: "NOT_APPLICABLE",
  vsbgInformationPresent: false,
  bfsgStatus: "EXEMPT",
  accessibilityEvidenceComplete: true,
  authoritySnapshots: [authority(["DSGVO", "BDSG", "DDG", "TDDDG", "UWG", "VSBG", "BFSG", "BFSGV", "BGB", "EGBGB", "PAngV", "E_COMMERCE", "NEWSLETTER"])],
  ...overrides,
});

describe("production assurance contracts", () => {
  it("runs an architecture-bound OWASP threat model without provider or source-write authority", () => {
    const blocked = runSecurityThreatModel({ architectureChecksum: implementationChecksum, authModel: ["login and session"], roleModel: ["member role"], databaseBoundaries: ["owner records"], securityControls: [] });
    expect(blocked.baselineVersion).toBe("security-baseline-owasp-asvs-5.0.0-top10-2025-v1");
    expect(OWASP_TOP_10_2025_IDS).toHaveLength(10);
    expect(blocked.attackSurfaces.map((surface) => surface.kind)).toEqual(expect.arrayContaining(["AUTH", "AUTHORIZATION", "DATABASE"]));
    expect(blocked.verdict).toBe("BLOCK");
    expect(new SecurityThreatModelAgent().readOnly).toBe(true);
    const mitigated = runSecurityThreatModel({ architectureChecksum: implementationChecksum, authModel: ["login and session"], roleModel: ["member role"], databaseBoundaries: ["owner records"], securityControls: ["authentication session cookie authorization role RLS validation owner isolation"] });
    expect(mitigated.blockingThreats).toEqual([]);
    expect(mitigated.verdict).toBe("WARN");
  });

  it("accepts only approved primary-source legal evidence", () => {
    expect(GERMAN_PRIMARY_SOURCE_HOSTS).toContain("gesetze-im-internet.de");
    expect(GermanLegalAuthoritySnapshotSchema.parse(authority()).currentness).toBe("CURRENT");
    expect(() => GermanLegalAuthoritySnapshotSchema.parse({ ...authority(), sourceUrl: "https://example.invalid/legal" })).toThrow();
  });

  it("keeps informational, contact, and non-commerce applicability capability-driven", () => {
    const informational = evaluateGermanCompliance(legalBase());
    expect(informational.verdict).toBe("COMPLIANT_EVIDENCE_COMPLETE");
    expect(informational.applicableDomains).toEqual(expect.arrayContaining(["DDG", "DSGVO", "BDSG"]));
    const contact = evaluateGermanCompliance(legalBase({ siteType: "CONTACT_FORM", processingInventory: [{ name: "contact-form", purpose: "Receive an approved contact request", category: "STRICTLY_REQUIRED", implementationRefs: ["src/app/contact/page.tsx"], noticeRef: "privacy:contact-form" }] }));
    expect(contact.verdict).toBe("COMPLIANT_EVIDENCE_COMPLETE");
    const nonCommerce = evaluateGermanCompliance(legalBase({ siteType: "CONTENT", commercial: false }));
    expect(nonCommerce.applicableDomains).not.toContain("BGB");
    expect(nonCommerce.applicableDomains).not.toContain("PAngV");
  });

  it("blocks missing facts, consent execution defects, commerce gaps, and fact-dependent legal review", () => {
    expect(evaluateGermanCompliance(legalBase({ businessIdentityFactsComplete: false })).verdict).toBe("BLOCKED_MISSING_FACTS");
    const analytics = { name: "analytics", purpose: "Measure usage", category: "CONSENT_REQUIRED" as const, implementationRefs: ["src/lib/analytics.ts"], noticeRef: "privacy:analytics" };
    expect(evaluateGermanCompliance(legalBase({ processingInventory: [analytics], consentExecution: { required: true, beforeConsentNonEssentialExecuted: true, rejectNonEssentialExecuted: false, acceptNonEssentialMayExecute: true, withdrawStopsSubsequentProcessing: true, evidenceRefs: ["consent:test"] } })).verdict).toBe("BLOCKED_IMPLEMENTATION");
    expect(evaluateGermanCompliance(legalBase({ processingInventory: [analytics], consentExecution: { required: true, beforeConsentNonEssentialExecuted: false, rejectNonEssentialExecuted: false, acceptNonEssentialMayExecute: true, withdrawStopsSubsequentProcessing: true, evidenceRefs: ["consent:test"] } })).verdict).toBe("COMPLIANT_EVIDENCE_COMPLETE");
    expect(evaluateGermanCompliance(legalBase({ siteType: "ECOMMERCE", checkoutInformationComplete: false })).verdict).toBe("BLOCKED_MISSING_FACTS");
    expect(evaluateGermanCompliance(legalBase({ bfsgStatus: "APPLICABLE", accessibilityEvidenceComplete: false })).verdict).toBe("BLOCKED_IMPLEMENTATION");
    expect(evaluateGermanCompliance(legalBase({ bfsgStatus: "EXEMPT" })).verdict).toBe("COMPLIANT_EVIDENCE_COMPLETE");
    expect(evaluateGermanCompliance(legalBase({ newsletterPresent: true, newsletterConsentSeparated: false })).verdict).toBe("BLOCKED_IMPLEMENTATION");
    expect(evaluateGermanCompliance(legalBase({ vsbgApplicable: "APPLICABLE", vsbgInformationPresent: false })).verdict).toBe("LEGAL_REVIEW_REQUIRED");
  });

  it("requires privacy-safe font evidence for German public sites", () => {
    const selfHosted = evaluateGermanCompliance(legalBase({ fontPrivacyEvidence: { provider: "GOOGLE_FONTS", implementation: "NEXT_FONT_GOOGLE_SELF_HOSTED", runtimeExternalRequest: false, browserProviderRequests: false, evidenceRefs: ["font:next-font"] } }));
    expect(selfHosted.findings.some((finding) => finding.code === "FONT_RUNTIME_EXTERNAL_REQUEST")).toBe(false);
    const runtimeRequest = evaluateGermanCompliance(legalBase({ fontPrivacyEvidence: { provider: "GOOGLE_FONTS", implementation: "RUNTIME_STYLESHEET", runtimeExternalRequest: true, browserProviderRequests: true, evidenceRefs: ["font:runtime-request"] } }));
    expect(runtimeRequest.verdict).toBe("BLOCKED_IMPLEMENTATION");
    expect(runtimeRequest.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "FONT_RUNTIME_EXTERNAL_REQUEST", domain: "DSGVO", severity: "BLOCKING" })]));
  });

  it("bounds security probes to local routes, a request budget, and safe evidence", async () => {
    const evidence = await executeBoundedSecurityProbes({
      implementationChecksum,
      targetBoundary: "LOCAL_TEST_APPLICATION",
      timeoutMs: 100,
      requestBudget: 2,
      probes: [
        { probeId: "probe:protected-route", kind: "PROTECTED_ROUTE", route: "/private", expected: "Unauthenticated request is denied", severity: "HIGH" },
        { probeId: "probe:headers", kind: "SECURITY_HEADERS", route: "/", expected: "CSP is present", severity: "MEDIUM" },
      ],
      execute: async (probe) => ({ actual: probe.probeId.endsWith("headers") ? "CSP is missing" : "401", status: probe.probeId.endsWith("headers") ? "FAIL" as const : "PASS" as const, safeEvidence: ["synthetic:evidence"] }),
    });
    expect(evidence.nonDestructive).toBe(true);
    expect(evidence.probes.find((probe) => probe.probeId.endsWith("headers"))?.status).toBe("FAIL");
    expect(() => SecurityTestEvidenceSchema.parse({ ...evidence, implementationChecksum: hash("other") })).not.toThrow();
    await expect(executeBoundedSecurityProbes({ implementationChecksum, targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 100, requestBudget: 1, probes: [{ probeId: "probe:external", kind: "PROTECTED_ROUTE", route: "https://third-party.invalid", expected: "denied", severity: "HIGH" }], execute: async () => ({ actual: "", status: "PASS", safeEvidence: ["x"] }) })).rejects.toThrow("SECURITY_TEST_ROUTE_OUTSIDE_BOUNDARY");
    await expect(executeBoundedSecurityProbes({ implementationChecksum, targetBoundary: "LOCAL_TEST_APPLICATION", timeoutMs: 60_001, requestBudget: 1, probes: [], execute: async () => ({ actual: "", status: "PASS", safeEvidence: ["x"] }) })).rejects.toThrow("SECURITY_TEST_TIMEOUT_OUT_OF_BOUNDS");
    await expect(executeBoundedSecurityProbes({ implementationChecksum, targetBoundary: "EXPLICIT_AUTHORIZED_STAGING", timeoutMs: 100, requestBudget: 1, probes: [], execute: async () => ({ actual: "", status: "PASS", safeEvidence: ["x"] }) })).rejects.toThrow("SECURITY_TEST_TARGET_AUTHORIZATION_REQUIRED");
  });
});
