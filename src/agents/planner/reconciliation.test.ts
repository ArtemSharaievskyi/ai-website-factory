import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalRequirementEntries, createV3RequirementId, mapCanonicalBriefRequirementIds } from "@/domain/requirements/v3/identity";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksumForPolicy } from "./deterministic";
import { admitPlanningRefresh, analyzePlanningRequirementCoverage, normalizePlanningPackageForHost } from "./refresh-admission";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";
import {
  applyPlanningReconciliationProposal,
  buildPlanningReconciliationProviderEnvelope,
  derivePlanningReconciliationScope,
  planningRequirementOwnership,
  PlanningReconciliationProviderProposalSchema,
  type PlanningReconciliationCurrentness,
} from "./reconciliation";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY } from "./semantic-checksum";

const projectId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-08-29T12:00:00.000Z";

function asV3Brief(brief: CanonicalBriefV3): CanonicalBriefV3 {
  const mappings = new Map(canonicalRequirementEntries(brief).map((entry, index) => [entry.id, createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: `synthetic:${index}:${entry.id}` })]));
  return mapCanonicalBriefRequirementIds(brief, mappings);
}

const baseBrief = asV3Brief(cleanBriefV3);

function fixtureBrief(overrides: Partial<CanonicalBriefV3> = {}) {
  return CanonicalBriefV3Schema.parse({
    ...baseBrief,
    decisions: {
      ...baseBrief.decisions,
      form: { ...baseBrief.decisions.form, privacyConsentMode: "REQUIRED" },
    },
    ...overrides,
  });
}

function plannerInput(brief: CanonicalBriefV3): PlannerAgentInput {
  const compatibility = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(brief) },
    briefStatus: "approved",
  });
  return {
    projectId,
    projectVersion: 1,
    approvedBrief: compatibility,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-reconciliation-prompt",
    clarificationEvidenceReferences: ["synthetic-clarification"],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-reconciliation",
    expectedRowVersion: 1,
  };
}

function currentness(brief: CanonicalBriefV3, planning: PlanningPackage, overrides: Partial<PlanningReconciliationCurrentness> = {}): PlanningReconciliationCurrentness {
  const briefChecksum = canonicalBriefChecksum(brief);
  return {
    projectId,
    projectVersion: 1,
    projectRowVersion: 1,
    projectVersionRowVersion: 1,
    workflowState: "AWAITING_DESIGN_SELECTION",
    brief: {
      rowVersion: 1,
      semanticChecksum: briefChecksum,
      documentChecksum: checksumPersistedDocument(brief),
      approved: true,
      approvedSemanticChecksum: briefChecksum,
    },
    planning: {
      rowVersion: 1,
      semanticChecksum: planningSemanticChecksumForPolicy(planning, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY),
      documentChecksum: planningDocumentChecksum(planning),
      semanticChecksumPolicy: CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY,
      approvedBriefChecksum: briefChecksum,
      accepted: false,
    },
    historicalDeltaAvailable: false,
    ...overrides,
  };
}

function fixture() {
  const missingId = createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: "synthetic:reconciliation:missing" });
  const incompleteId = createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: "synthetic:reconciliation:incomplete" });
  const brief = fixtureBrief({
    requirements: [
      ...baseBrief.requirements,
      { id: missingId, category: "FEATURE", statement: "Provide the synthetic reconciliation capability.", sourceRefs: ["fixture:reconciliation:missing"] },
      { id: incompleteId, category: "FEATURE", statement: "Expose the synthetic reconciliation evidence contract.", sourceRefs: ["fixture:reconciliation:incomplete"] },
    ],
  });
  const input = plannerInput(fixtureBrief());
  const built = buildPlanningPackage(input);
  const basePlanning = normalizePlanningPackageForHost({ candidate: built, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(fixtureBrief()), canonicalBrief: fixtureBrief(), timestamp });
  const currentPlanning = PlanningPackageSchema.parse({
    ...basePlanning,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    forms: {
      ...basePlanning.forms,
      forms: basePlanning.forms.forms.map((form) => ({ ...form, consentRequirements: form.consentRequirements.length ? form.consentRequirements : ["Required privacy consent"] })),
    },
    traceability: [...basePlanning.traceability, {
      decisionId: randomUUID(),
      category: "synthetic-fixture",
      requirementReferences: [incompleteId],
      systemConstraintReferences: [],
      rationale: "Synthetic reference without semantic evidence.",
      confidence: "high" as const,
      userConfirmationRequired: false,
    }],
  });
  const boundCurrentness = currentness(brief, currentPlanning);
  const evidence = analyzePlanningRequirementCoverage({ candidate: currentPlanning, canonicalBrief: brief });
  return { brief, planning: currentPlanning, currentness: boundCurrentness, evidence, missingId, incompleteId };
}

function scopeFor() {
  const value = fixture();
  return { value, scope: derivePlanningReconciliationScope({ currentApprovedBrief: value.brief, currentPlanning: value.planning, currentness: value.currentness, coverageEvidence: value.evidence }) };
}

describe("host-owned Planning reconciliation scope", () => {
  it("CASE A prefers a recoverable historical delta", () => {
    const value = fixture();
    const scope = derivePlanningReconciliationScope({
      currentApprovedBrief: value.brief,
      currentPlanning: value.planning,
      currentness: { ...value.currentness, historicalDeltaAvailable: true },
      coverageEvidence: value.evidence,
    });
    expect(scope.blockers).toContain("RECONCILIATION_HISTORICAL_DELTA_PREFERRED");
    expect(scope.admissibleForProviderCall).toBe(false);
  });

  it("CASE B derives exact current-state scope without fabricating history", () => {
    const { value, scope } = scopeFor();
    expect(scope.provenanceMode).toBe("CURRENT_STATE_RECONCILIATION");
    expect(scope.currentnessStates).toMatchObject({ boundToBrief: true, checksumValid: true, provenanceCertified: false, accepted: false });
    expect(scope.unresolvedRequirementIds).toEqual(expect.arrayContaining([value.missingId, value.incompleteId]));
    expect(scope.authorizedRequirementIds).toEqual(expect.arrayContaining([value.missingId, value.incompleteId]));
    expect(scope.authorizedPathFamilies).toContain("planning.productScope.inScopeCapabilities[]");
    expect(scope.authorizedDomains).toContain("product-scope");
    expect(scope.deletionAllowed).toBe(false);
  });

  it("CASE C produces a bounded semantic-synthesis provider envelope", () => {
    const { value, scope } = scopeFor();
    const envelope = buildPlanningReconciliationProviderEnvelope({ scope, canonicalBrief: value.brief, currentPlanning: value.planning });
    expect(envelope.scopeChecksum).toBe(scope.scopeChecksum);
    expect(envelope.authorizedRequirementIds).toEqual(scope.authorizedRequirementIds);
    expect(envelope.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ id: value.missingId }), expect.objectContaining({ id: value.incompleteId })]));
    expect(envelope.planningContext).toHaveProperty("productScope");
    expect(envelope.immutableConstraints.join(" ")).toMatch(/may not author scope/i);
  });

  it("CASE D fails closed on an ambiguous host evidence record", () => {
    const value = fixture();
    const evidence = value.evidence.map((entry) => entry.requirementId === value.missingId ? { ...entry, ambiguity: "AMBIGUOUS" as const } : entry);
    const scope = derivePlanningReconciliationScope({ currentApprovedBrief: value.brief, currentPlanning: value.planning, currentness: value.currentness, coverageEvidence: evidence });
    expect(scope.findings).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: value.missingId, reason: "AMBIGUOUS", classification: "NOT_REPAIRABLE_WITHOUT_USER_DECISION" })]));
    expect(scope.admissibleForProviderCall).toBe(false);
  });

  it("distinguishes the repository ownership policy and validator false positives", () => {
    expect(planningRequirementOwnership("IMAGE_NOTE")).toBe("NON_PLANNING_OWNED");
    expect(planningRequirementOwnership("FEATURE")).toBe("PLANNING_OWNED");
    const value = fixture();
    const validatorFalsePositiveId = value.evidence.find((entry) => entry.referencePresent && entry.semanticEvidence === "FULL")!.requirementId;
    const evidence = value.evidence.map((entry) => entry.requirementId === validatorFalsePositiveId
      ? { ...entry, validatorFinding: "MISSING_SEMANTIC_EVIDENCE" as const }
      : entry);
    const scope = derivePlanningReconciliationScope({ currentApprovedBrief: value.brief, currentPlanning: value.planning, currentness: value.currentness, coverageEvidence: evidence });
    expect(scope.findings).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: validatorFalsePositiveId, reason: "VALIDATOR_FALSE_POSITIVE", classification: "VALIDATOR_DEFECT" })]));
    expect(scope.admissibleForProviderCall).toBe(false);
  });

  it("CASE E does not authorize an unbounded category or full replacement", () => {
    const value = fixture();
    const administrationId = createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: "synthetic:reconciliation:administration" });
    const brief = fixtureBrief({ requirements: [...value.brief.requirements, { id: administrationId, category: "ADMINISTRATION", statement: "Manage a synthetic administration surface.", sourceRefs: ["fixture:reconciliation:administration"] }] });
    const evidence = analyzePlanningRequirementCoverage({ candidate: value.planning, canonicalBrief: brief });
    const scope = derivePlanningReconciliationScope({ currentApprovedBrief: brief, currentPlanning: value.planning, currentness: currentness(brief, value.planning), coverageEvidence: evidence });
    expect(scope.findings).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: administrationId, classification: "NOT_REPAIRABLE_WITHOUT_USER_DECISION", permittedPathFamilies: [] })]));
    expect(scope.admissibleForProviderCall).toBe(false);
    expect(() => applyPlanningReconciliationProposal({ scope: scopeFor().scope, current: value.planning, canonicalBrief: value.brief, proposal: value.planning, timestamp })).toThrow();
  });

  it("CASE F rejects a provider operation whose semantic path is unrelated", () => {
    const { value, scope } = scopeFor();
    expect(() => applyPlanningReconciliationProposal({
      scope,
      current: value.planning,
      canonicalBrief: value.brief,
      proposal: { contractVersion: 1, changes: [{ kind: "set-architecture-field", field: "securityControls", value: ["Unrelated synthetic change."], requirementReferences: [value.missingId] }] },
      timestamp,
    })).toThrow(/RECONCILIATION_PROVIDER_OPERATION_UNAUTHORIZED/);
  });

  it("authorizes semantic paths against the referenced finding, not the scope-wide union", () => {
    const value = fixture();
    const seoId = createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: "synthetic:reconciliation:seo" });
    const brief = fixtureBrief({
      requirements: [...value.brief.requirements, { id: seoId, category: "SEO", statement: "Provide the synthetic search indexing contract for this reconciliation test.", sourceRefs: ["fixture:reconciliation:seo"] }],
    });
    const planning = PlanningPackageSchema.parse({
      ...value.planning,
      approvedBriefChecksum: canonicalBriefChecksum(brief),
      pages: { ...value.planning.pages, pages: value.planning.pages.pages.map((page, index) => index === 0 ? { ...page, requirementReferences: [seoId] } : page) },
    });
    const scope = derivePlanningReconciliationScope({ currentApprovedBrief: brief, currentPlanning: planning, currentness: currentness(brief, planning), coverageEvidence: analyzePlanningRequirementCoverage({ candidate: planning, canonicalBrief: brief }) });
    const page = planning.pages.pages[0]!;
    expect(() => applyPlanningReconciliationProposal({
      scope,
      current: planning,
      canonicalBrief: brief,
      proposal: { contractVersion: 1, changes: [{ kind: "upsert-page", value: { ...page, functionalComponents: [...page.functionalComponents, "Unrelated functional change."], requirementReferences: [seoId] } }] },
      timestamp,
    })).toThrow(/RECONCILIATION_PROVIDER_PATH_UNAUTHORIZED/);
  });

  it("CASE G rejects a provider full-package replacement", () => {
    const { value, scope } = scopeFor();
    expect(() => PlanningReconciliationProviderProposalSchema.parse(value.planning)).toThrow();
    expect(() => applyPlanningReconciliationProposal({ scope, current: value.planning, canonicalBrief: value.brief, proposal: value.planning, timestamp })).toThrow();
  });

  it("CASE H rejects provider-authored requirement IDs", () => {
    const { value, scope } = scopeFor();
    expect(() => applyPlanningReconciliationProposal({
      scope,
      current: value.planning,
      canonicalBrief: value.brief,
      proposal: { contractVersion: 1, changes: [{ kind: "set-product-scope-field", field: "inScopeCapabilities", value: [...value.planning.productScope.inScopeCapabilities, "Invented"], requirementReferences: ["REQUIREMENT:v3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }] },
      timestamp,
    })).toThrow(/RECONCILIATION_PROVIDER_REFERENCE_UNAUTHORIZED/);
  });

  it("CASE I rejects deletion even when the legacy operation shape is valid", () => {
    const { value, scope } = scopeFor();
    expect(() => applyPlanningReconciliationProposal({
      scope,
      current: value.planning,
      canonicalBrief: value.brief,
      proposal: { contractVersion: 1, changes: [{ kind: "remove-page", pageId: value.planning.pages.pages[0]!.id, requirementReferences: [value.missingId] }] },
      timestamp,
    })).toThrow(/RECONCILIATION_PROVIDER_DELETION_FORBIDDEN/);
  });

  it("CASE J keeps checksum binding separate from coverage and lifecycle readiness", () => {
    const { value, scope } = scopeFor();
    expect(scope.currentnessStates.boundToBrief).toBe(true);
    expect(scope.currentnessStates.checksumValid).toBe(true);
    expect(scope.currentnessStates.provenanceCertified).toBe(false);
    expect(scope.currentnessStates.coverageCertified).toBe(false);
    expect(scope.currentnessStates.accepted).toBe(false);
    expect(scope.admissibleForProviderCall).toBe(true);
    expect(admitPlanningRefresh({
      candidate: value.planning,
      current: value.planning,
      canonicalBrief: value.brief,
      projectId,
      projectVersion: 1,
      approvedBriefChecksum: scope.currentness.brief.semanticChecksum,
    }).blockers.some((blocker) => blocker.startsWith("PLANNING_REQUIREMENT_COVERAGE_MISSING:"))).toBe(true);
  });

  it("applies only host-authorized additions and preserves core decisions", () => {
    const { value, scope } = scopeFor();
    const nextCapabilities = [...value.planning.productScope.inScopeCapabilities, "Provide the synthetic reconciliation capability.", "Expose the synthetic reconciliation evidence contract."];
    const result = applyPlanningReconciliationProposal({
      scope,
      current: value.planning,
      canonicalBrief: value.brief,
      proposal: { contractVersion: 1, changes: [{ kind: "set-product-scope-field", field: "inScopeCapabilities", value: nextCapabilities, requirementReferences: [value.missingId, value.incompleteId] }] },
      timestamp,
    });
    expect(result.blockers).toEqual([]);
    expect(result.candidate.accepted).toBe(false);
    expect(result.candidate.approvedBriefChecksum).toBe(scope.currentness.brief.semanticChecksum);
    expect(result.candidate.authentication.decision).toBe("none");
    expect(result.candidate.supabase.postgres).toBe(false);
    expect(result.candidate.architecture.serverActions).toEqual([]);
    expect(result.postApplyCoverage.filter((entry) => entry.requirementId === value.missingId || entry.requirementId === value.incompleteId)).toEqual(expect.arrayContaining([expect.objectContaining({ semanticEvidence: "FULL", referencePresent: true })]));
  });

  it("does not let Project Memory or a stale evidence list authorize scope", () => {
    const value = fixture();
    const staleEvidence = value.evidence.filter((entry) => entry.requirementId !== value.missingId);
    expect(() => derivePlanningReconciliationScope({ currentApprovedBrief: value.brief, currentPlanning: value.planning, currentness: value.currentness, coverageEvidence: staleEvidence })).toThrow(/RECONCILIATION_COVERAGE_EVIDENCE_STALE/);
  });
});
