import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CustomerUxDirectionSchema, emptyFormBehaviorState, CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { deriveCustomerUxDirectionRequirements } from "@/domain/requirements/v3/customer-ux-direction";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ProjectRepository, ProjectVersionRepository, DocumentRepository } from "@/persistence/database/repositories";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { PlanningPackageSchema, type PlannerAgentInput } from "./contracts";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksum } from "./deterministic";
import { correctUnapprovedPlanningPackage } from "./deterministic-correction";
import { normalizePlanningPackageForHost } from "./refresh-admission";
import { PlannerArchitectService } from "./service";
import { FakePlannerMemoryPort } from "./memory";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

const timestamp = "2026-01-01T00:00:00.000Z";
const direction = CustomerUxDirectionSchema.parse({
  metadata: { schemaVersion: 1, source: "CUSTOMER_CONFIRMATION", confirmation: "CUSTOMER_CONFIRMED", status: "ACTIVE", recordedRevisionId: "synthetic-ux-revision-1" },
  visual: { concept: "CLEAN_INDUSTRIAL_PREMIUM", presentationAttributes: ["Clear hierarchy"], dominantSurfaceDirection: "Light neutral surfaces", contrastDirection: "Strong readable contrast", accentTreatment: "One restrained accent", typographyDirection: "Confident readable hierarchy", brandAssetAuthority: "CUSTOMER_SUPPLIED_AUTHORITATIVE", avoidedPatterns: ["Decorative noise"] },
  audienceAndPositioning: { primaryAudienceOrientation: "Local customers", audienceSegments: ["Local homeowners"], desiredPerception: ["Trustworthy"], copyDirection: "Direct factual guidance", prohibitedUnsupportedClaims: ["Invented reviews"] },
  informationArchitecture: { onePage: true, sections: [{ id: "HEADER", order: 1, state: "REQUIRED" }, { id: "HERO", order: 2, state: "REQUIRED" }, { id: "FINAL_CTA", order: 3, state: "REQUIRED" }, { id: "FOOTER", order: 4, state: "REQUIRED" }, { id: "BEFORE_AFTER", order: 5, state: "OMITTED" }, { id: "REAL_PROJECT_GALLERY", order: 6, state: "OMITTED" }] },
  conversionPolicy: { allowedChannels: ["DIRECT_PHONE", "DIRECT_EMAIL"], forbiddenChannels: ["CONTACT_FORM"], primaryCtaIntent: "Start a direct phone or email conversation", dataCollectionForm: "FORBIDDEN" },
  imageEvidencePolicy: { realProjectPhotography: "UNAVAILABLE", beforeAfter: "OMITTED", aiSupportingImagery: "ALLOWED_NON_EVIDENTIARY", stockImagery: "FORBIDDEN", aiOrStockEmployeeRepresentation: "FORBIDDEN", protectedLogo: "AUTHORITATIVE_NON_REPLACEABLE", missingImagery: "NON_BLOCKER" },
  trustPolicy: { allowedTrustSignals: ["Confirmed service scope"], forbiddenUnsupportedTrustSignals: ["Fake reviews"] },
  motionAndInteraction: { allowedInteractionPatterns: ["Purposeful reveal"], avoidedInteractionPatterns: ["Auto-rotate"], reducedMotion: "REQUIRED", keyboardOperability: "REQUIRED", noHoverOnlyCriticalActions: true },
  mobileAccessibility: { mobileFirst: true, directTelephoneEmailActions: true, minimumTargetSizeDirection: "Comfortably tappable controls", overflowAvoidance: "REQUIRED", focusVisibility: "REQUIRED", semanticHtml: "REQUIRED", accessibilityTarget: "WCAG_2_2_AA", altText: "REQUIRED", screenReaderKeyboardConsiderations: ["Preserve reading order"] },
  performance: { coreWebVitalsOrientation: "TARGET_ORIENTED", lcpTargetMs: 2500, clsTarget: 0.1, inpTargetMs: 200, minimalUnnecessaryClientJavascript: true, responsiveImages: "REQUIRED", thirdPartyScriptPolicy: "FORBID_UNAPPROVED", targetsAreNonContractual: true },
  seoAndLocalDirection: { contentLanguage: "en", headingHierarchy: "SEMANTIC_ORDER", localRelevance: "USE_CONFIRMED_GEOGRAPHY", structuredData: "CONFIRMED_FACTS_ONLY", metadataPolicy: "CONFIRMED_CONTENT_ONLY", sitemapRobotsCanonical: "MAINTAIN_CANONICAL_METADATA", keywordStuffing: "FORBIDDEN" },
  creativeFreedom: { hardCustomerInvariants: ["Preserve the protected logo"], creativeDirections: ["Compose a distinctive hero"], implementationFreedom: ["Create custom components"], allowedUiLibrarySelection: "UNRESTRICTED_COMPATIBLE_LIBRARIES", allowedCustomComponents: true, boundedBy: ["Brand", "Accessibility"] },
});

const canonicalBase = {
  ...cleanBriefV3,
  decisions: { ...cleanBriefV3.decisions, form: emptyFormBehaviorState() },
  customerUxDirection: direction,
  contact: {
    publicPhone: { e164: "+4915123456789", display: "+49 151 23456789", telUri: "tel:+4915123456789", confirmation: "CUSTOMER_CONFIRMED", source: "CUSTOMER_CONFIRMATION", publicationAuthorized: true, publicationScopes: ["CONTACT", "IMPRESSUM"] },
    publicEmail: { email: "kontakt@example.test", confirmation: "CUSTOMER_CONFIRMED", source: "CUSTOMER_CONFIRMATION", publicationAuthorized: true, publicationScopes: ["CONTACT", "IMPRESSUM"] },
  },
};
const canonical = CanonicalBriefV3Schema.parse({
  ...canonicalBase,
  requirements: [
    ...canonicalBase.requirements,
    ...deriveCustomerUxDirectionRequirements({ direction, projectId: "00000000-0000-4000-8000-000000000000", projectVersion: 1 }),
  ],
});

function brief(projectId: string) {
  return RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    pages: [{ slug: "home", purpose: "Explain the approved public service." }],
    forms: [],
    features: ["Approved service overview."],
    contentRequirements: ["Preserve the approved service scope."],
    userAcceptanceCriteria: ["Visitors can understand the approved service scope."],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedRequirementsChecksum: "a".repeat(64) },
    briefStatus: "approved",
  });
}

function badPackage(projectId: string) {
  const approvedBrief = brief(projectId);
  const input: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief, canonicalBrief: canonical, approvedBriefChecksum: canonicalBriefChecksum(canonical), originalPromptReference: "synthetic", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_PLANNING_GENERATION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: randomUUID(), expectedRowVersion: 1 };
  const generated = buildPlanningPackage(input);
  return PlanningPackageSchema.parse({
    ...generated,
    profile: { ...generated.profile, selectedProfile: "web-application", rationale: "Synthetic stale stateful profile.", rejectedProfiles: generated.profile.rejectedProfiles },
    architecture: { ...generated.architecture, applicationProfile: "web-application" },
    blockers: ["DATA_MODEL_INCOMPLETE"],
    sitemap: { ...generated.sitemap, routes: generated.sitemap.routes.map((route) => route.path === "/" ? { ...route, primaryCta: "Continue to the primary project action" } : route) },
    pages: { ...generated.pages, pages: generated.pages.pages.map((page) => page.routeId === "route-home" ? { ...page, functionalComponents: [], acceptanceCriteria: [] } : page) },
    userFlows: { ...generated.userFlows, flows: [] },
    updatedAt: timestamp,
  });
}

describe("deterministic correction of an unapproved Planning package", () => {
  it("uses canonical no-backend/direct-contact authority and keeps WhatsApp inactive", () => {
    const projectId = randomUUID();
    const approvedBrief = brief(projectId);
    const input: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief, canonicalBrief: canonical, approvedBriefChecksum: canonicalBriefChecksum(canonical), originalPromptReference: "synthetic", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_PLANNING_GENERATION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: randomUUID(), expectedRowVersion: 1 };
    const generated = buildPlanningPackage(input);
    expect(generated.profile.selectedProfile).toBe("marketing-site");
    expect(generated.architecture.applicationProfile).toBe("marketing-site");
    expect(generated.blockers).not.toContain("DATA_MODEL_INCOMPLETE");
    expect(generated.sitemap.routes.find((route) => route.path === "/")?.primaryCta).toBe("Start a direct phone or email conversation");
    expect(generated.userFlows.flows.map((flow) => flow.id)).toContain("flow-direct-contact");
    expect(JSON.stringify(generated.userFlows.flows)).not.toMatch(/whatsapp:/iu);
    expect(canonical.customerUxDirection?.conversionPolicy.allowedChannels).toEqual(["DIRECT_PHONE", "DIRECT_EMAIL"]);
    expect(canonical.contact?.publicPhone?.publicationAuthorized).toBe(true);
    expect(canonical.contact).not.toHaveProperty("whatsapp");
  });

  it("binds the stable customer UX and contact aliases to safe host references at generation admission", () => {
    const projectId = randomUUID();
    const approvedBrief = brief(projectId);
    const input: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief, canonicalBrief: canonical, approvedBriefChecksum: canonicalBriefChecksum(canonical), originalPromptReference: "synthetic", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_PLANNING_GENERATION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: randomUUID(), expectedRowVersion: 1 };
    const generated = buildPlanningPackage(input);
    const admitted = normalizePlanningPackageForHost({ candidate: generated, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(canonical), canonicalBrief: canonical, timestamp });
    const refs = admitted.traceability.flatMap((entry) => entry.requirementReferences);
    expect(refs).not.toContain("brief:customerUxDirection");
    expect(refs).not.toContain("brief:contact.publicPhone");
    expect(refs).not.toContain("brief:contact.publicEmail");
    expect(refs).toEqual(expect.arrayContaining(canonical.requirements.filter((entry) => entry.sourceRefs.includes("customer-confirmation:ux-direction")).map((entry) => entry.id)));
    expect(refs).toContain("PLANNING:BRIEF_FIELD:contactpublicphone");
    expect(refs).toContain("PLANNING:BRIEF_FIELD:contactpublicemail");
    const unknown = PlanningPackageSchema.parse({ ...generated, traceability: [...generated.traceability, { ...generated.traceability[0], requirementReferences: ["brief:notARealBriefField"] }] });
    expect(() => normalizePlanningPackageForHost({ candidate: unknown, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(canonical), canonicalBrief: canonical, timestamp })).toThrow("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE");
  });

  it("preserves scope and routes while correcting only the proven host defects", () => {
    const projectId = randomUUID();
    const current = badPackage(projectId);
    const corrected = correctUnapprovedPlanningPackage({ current, brief: brief(projectId), canonicalBrief: canonical, operationKey: "planning-correction:synthetic", timestamp });
    expect(corrected.correctionKinds).toEqual(expect.arrayContaining(["PUBLIC_SITE_PROFILE", "REMOVE_FALSE_DATA_MODEL_BLOCKER", "DIRECT_CONTACT_CTA", "DIRECT_CONTACT_FLOW", "NORMALIZE_TRACEABILITY_REFERENCES"]));
    expect(corrected.package.profile.selectedProfile).toBe("marketing-site");
    expect(corrected.package.architecture.applicationProfile).toBe("marketing-site");
    expect(corrected.package.blockers).not.toContain("DATA_MODEL_INCOMPLETE");
    expect(corrected.package.forms.forms).toHaveLength(0);
    expect(corrected.package.userFlows.flows).toHaveLength(1);
    expect(corrected.package.productScope.purpose).toBe(current.productScope.purpose);
    expect(corrected.package.productScope.inScopeCapabilities).toEqual(current.productScope.inScopeCapabilities);
    expect(corrected.package.productScope.outOfScopeCapabilities).toEqual(current.productScope.outOfScopeCapabilities);
    expect(corrected.package.sitemap.routes.map((route) => route.path)).toEqual(current.sitemap.routes.map((route) => route.path));
    expect(JSON.stringify(corrected.package.userFlows.flows)).not.toMatch(/whatsapp:/iu);
    expect(corrected.package.approvedBriefChecksum).toBe(canonicalBriefChecksum(canonical));
    const correctedRefs = corrected.package.traceability.flatMap((entry) => entry.requirementReferences);
    expect(correctedRefs).not.toContain("brief:customerUxDirection");
    expect(correctedRefs).toEqual(expect.arrayContaining(canonical.requirements.filter((entry) => entry.sourceRefs.includes("customer-confirmation:ux-direction")).map((entry) => entry.id)));
  });

  it("persists one versioned correction with immutable prior evidence and replays idempotently without a provider", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = randomUUID();
    const approvedBrief = brief(projectId);
    const briefChecksum = canonicalBriefChecksum(canonical);
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-correction", originalPrompt: "Synthetic correction.", currentVersion: 1, workflowState: "AWAITING_PLANNING_APPROVAL" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_PLANNING_APPROVAL", memoryRootPath: null, requirementsChecksum: briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: canonical, createdAt: timestamp, updatedAt: timestamp });
    await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: briefChecksum } }));
    await new DocumentRepository(database).save(RequirementSpecificationSchema.parse(approvedBrief));
    const current = badPackage(projectId);
    await new DocumentRepository(database).save(current);
    const baseChecksum = planningSemanticChecksum(current);
    const operationKey = `planning-correction:${projectId}:${baseChecksum}`;
    const service = new PlannerArchitectService({ database, memory: new FakePlannerMemoryPort(), provider: { plan: async () => { throw new Error("provider must not be called"); } } });
    const first = await service.correctUnapprovedPlanningDeterministically({ projectId, projectVersion: 1, expectedProjectRowVersion: 1, expectedBriefChecksum: briefChecksum, expectedPlanningSemanticChecksum: baseChecksum, operationKey });
    expect(first.status).toBe("APPLIED");
    expect(first.providerCalls).toBe(0);
    expect(first.previousPlanning.profile.selectedProfile).toBe("web-application");
    const second = await service.correctUnapprovedPlanningDeterministically({ projectId, projectVersion: 1, expectedProjectRowVersion: 1, expectedBriefChecksum: briefChecksum, expectedPlanningSemanticChecksum: baseChecksum, operationKey });
    expect(second.status).toBe("REPLAYED");
    expect(second.providerCalls).toBe(0);
    const currentAfterCorrection = PlanningPackageSchema.parse(await new DocumentRepository(database).get(projectId, 1, "planning-package"));
    const validation = await service.validatePlanningPackage(projectId, 1);
    expect(validation.ready).toBe(true);
    expect(validation.blockers).toEqual([]);
    const stored = await new DocumentRepository(database).getWithMetadata(projectId, 1, "planning-correction-history");
    expect(stored?.document.documentType).toBe("planning-correction-history");
    if (stored?.document.documentType === "planning-correction-history") expect(stored.document.entries).toHaveLength(1);
    expect((await new ProjectRepository(database).getWithVersion(projectId))?.project.workflowState).toBe("AWAITING_PLANNING_APPROVAL");
    expect((await new DocumentRepository(database).get(projectId, 1, "brief-v3"))?.documentType).toBe("brief-v3");
    const accepted = await service.acceptPlanningPackage({ projectId, projectVersion: 1, planningChecksum: planningDocumentChecksum(currentAfterCorrection), acceptedBy: "synthetic-user", acceptedAt: timestamp, expectedRowVersion: 1, idempotencyKey: `planning-accept:${projectId}` });
    expect(accepted.projectState).toBe("ARCHITECTURE_REVIEW");
    expect((await new ProjectRepository(database).getWithVersion(projectId))?.project.workflowState).toBe("ARCHITECTURE_REVIEW");
    expect(checksumPersistedDocument(canonical)).toHaveLength(64);
  });
});
