import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { buildPhase7CContractPackage } from "@/domain/contracts/phase7c";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import type { ArchitectureReviewResult } from "@/domain/review/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { buildPlanningPackage, evaluatePlanningAcceptanceReadiness, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "@/agents/planner/contracts";
import { architectureReviewerAgentDefinition } from "@/agents/catalog";
import { rolePrompt } from "@/integrations/openai/prompts";
import { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import { FACTORY_ARCHITECTURE_STACK, type ArchitectureReviewInput } from "./contracts";
import { ArchitectureReviewError } from "./errors";
import { canonicalArchitectureEvidence, deterministicArchitectureReview } from "./deterministic";
import { ArchitectureReviewService } from "./service";
import { createReviewEvidenceCatalog, evidenceIdFor } from "../evidence";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";

const id = () => randomUUID();
const timestamp = "2026-08-23T12:00:00.000Z";

const baseBrief = (overrides: Partial<RequirementSpecification> = {}): RequirementSpecification => RequirementSpecificationSchema.parse({
  schemaVersion: 1, documentType: "requirements", projectId: id(), projectVersion: 1, createdAt: timestamp, updatedAt: timestamp,
  projectSummary: "A public information site", protectedFunctionalityRequired: false, imagesRequired: true,
  businessGoals: ["Explain the service"], targetAudiences: ["Visitors"], pages: [{ slug: "home", purpose: "Explain the service" }, { slug: "impressum", purpose: "Show legal information placeholders" }, { slug: "datenschutz", purpose: "Show privacy information placeholders" }],
  userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
  localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "custom", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" },
  technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home loads"], unresolvedItems: [],
  approval: { approved: true, approvedAt: timestamp, approvedBy: "user" }, briefStatus: "approved", briefVersion: 1,
  contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [],
  legalComplianceConstraints: { constraints: [], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  ...overrides,
});

const plannerInput = (brief: RequirementSpecification): PlannerAgentInput => ({
  projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief),
  originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION",
  existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: id(), expectedRowVersion: 1,
});

const acceptedPlanning = (brief: RequirementSpecification, changes: Partial<PlanningPackage> = {}) => {
  const planning = buildPlanningPackage(plannerInput(brief));
  return {
    ...planning,
    ...changes,
    accepted: true,
    acceptance: { acceptedAt: timestamp, acceptedBy: "user", checksum: checksumPersistedDocument(planning) },
    architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "user" } },
    assets: { ...planning.assets, entries: planning.assets.entries.map((entry) => ({ ...entry, generationStatus: "pending-approval" as const, userApprovalRequired: true })) },
    blockers: ["Final legal address and registry facts must replace explicit placeholders before public publication.", "Rights and licenses for future additional photography must be checked and documented before publication."],
  } as PlanningPackage;
};

const reviewInput = (brief: RequirementSpecification, planning: PlanningPackage, overrides: Partial<ArchitectureReviewInput> = {}): ArchitectureReviewInput => ({
  projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief),
  acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning),
  factoryArchitecturePolicy: { policyVersion: "factory-architecture-v1", stack: [...FACTORY_ARCHITECTURE_STACK], prohibitedTechnologies: ["redis", "nestjs"], serverActionPreference: "preferred", routeHandlerPreference: "second", packageManager: "npm" },
  relevantProjectConstraints: [], idempotencyKey: id(), expectedRowVersion: 1, ...overrides,
});

async function createFixture(database: PersistenceDatabase = new InMemoryPersistenceDatabase()) {
  const initialBrief = baseBrief();
  const initialV3 = createBriefV3Document({ projectId: initialBrief.projectId, projectVersion: 1, brief: migrateLegacyBriefToCanonicalBriefV3(initialBrief), createdAt: timestamp, updatedAt: timestamp });
  const brief = RequirementSpecificationSchema.parse({ ...initialBrief, approval: { ...initialBrief.approval, approvedRequirementsChecksum: initialV3.briefChecksum } });
  const briefV3 = createBriefV3Document({ projectId: brief.projectId, projectVersion: 1, brief: migrateLegacyBriefToCanonicalBriefV3(brief), createdAt: timestamp, updatedAt: timestamp });
  const approvedBriefV3 = { ...briefV3, approval: { approved: true as const, approvedAt: timestamp, approvedBy: "user", approvedCanonicalChecksum: briefV3.briefChecksum } };
  const planning = acceptedPlanning(brief);
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: brief.projectId, slug: `architecture-review-${brief.projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic Architecture Review transaction fixture.", currentVersion: 1, workflowState: "ARCHITECTURE_REVIEW" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: id(), projectId: brief.projectId, versionNumber: 1, state: "ARCHITECTURE_REVIEW", memoryRootPath: null, requirementsChecksum: approvedBriefV3.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  await documents.save(brief);
  await documents.save(approvedBriefV3);
  await documents.save(planning);
  await documents.save(planning.architecture);
  await documents.save(planning.content);
  await documents.save(planning.assets);
  const input = reviewInput(brief, planning, { approvedBriefChecksum: approvedBriefV3.briefChecksum });
  const phase7c = buildPhase7CContractPackage({ projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: input.approvedBriefChecksum, planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: "0".repeat(64), planning });
  await documents.save(phase7c);
  return { database, brief, briefV3: approvedBriefV3, planning, input };
}

async function stateOf(database: PersistenceDatabase, projectId: string) {
  return database.transaction(async (tx) => ({
    project: await tx.getProject(projectId),
    brief: await tx.getDocument(projectId, 1, "requirements"),
    briefV3: await tx.getDocument(projectId, 1, "brief-v3"),
    planning: await tx.getDocument(projectId, 1, "planning-package"),
    phase7c: await tx.getDocument(projectId, 1, "phase-7c-contract-package"),
    review: await tx.getDocument(projectId, 1, "architecture-review"),
    history: await tx.getDocument(projectId, 1, "architecture-review-history"),
    decisions: await tx.listDecisions(projectId, 1),
    events: await tx.listWorkflowEvents(projectId, 1),
  }));
}

const deterministicProvider = { promptVersion: "architecture-reviewer.v2", review: async (input: ArchitectureReviewInput) => deterministicArchitectureReview(input) };

describe("Architecture Reviewer", () => {
  it("has a read-only catalog definition and review-only prompt", () => {
    expect(architectureReviewerAgentDefinition.readOnly).toBe(true);
    expect(architectureReviewerAgentDefinition.allowedTools).toEqual(["openai-generation"]);
    const prompt = rolePrompt("architecture-reviewer", {});
    expect(prompt.system).toMatch(/do not.*write project state/i);
  });

  it("approves a minimal valid architecture deterministically", async () => {
    const fixture = await createFixture();
    expect(deterministicArchitectureReview(fixture.input).verdict).toBe("APPROVED");
  });

  it("does not infer persistence from lossless client-only form wording", () => {
    const v2 = emptyBriefV2Fields();
    const brief = baseBrief({
      ...v2,
      forms: ["The contact submission is simulated locally and is never transmitted."],
      formBehaviorRequirements: {
        ...v2.formBehaviorRequirements,
        formPresent: true,
        validation: "ACTIVE",
        successUx: "SIMULATED",
        dataTransmission: "NONE",
        persistence: "NONE",
        thirdParty: "NONE",
        privacyCheckbox: "REQUIRED",
      },
    });
    const planning = PlanningPackageSchema.parse({ ...acceptedPlanning(brief), blockers: [] });
    const result = deterministicArchitectureReview(reviewInput(brief, planning));

    expect(result.verdict).toBe("APPROVED");
    expect(result.findings.map((item) => item.findingId)).not.toContain("missing-persistence-architecture");
  });

  it("allows the bounded transport layer to compact duplicated supporting context", async () => {
    const fixture = await createFixture();
    const expandedCompatibilityBrief = RequirementSpecificationSchema.parse({
      ...fixture.input.approvedBrief,
      technicalConstraints: Array.from({ length: 40 }, (_, index) => `Synthetic constraint ${index} ${"x".repeat(3500)}`),
    });
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    await expect(service.review({ ...fixture.input, approvedBrief: expandedCompatibilityBrief })).resolves.toMatchObject({ verdict: "APPROVED" });
  });

  it("flags backend priority when a no-backend Brief is paired with an active priority list", async () => {
    const fixture = await createFixture();
    const planning = PlanningPackageSchema.parse({ ...fixture.planning, architecture: { ...fixture.planning.architecture, backendPriority: ["server-actions", "route-handlers", "supabase-services"] } });
    const result = deterministicArchitectureReview(reviewInput(fixture.brief, planning, { approvedBriefChecksum: fixture.input.approvedBriefChecksum }));
    expect(result.findings.map((item) => item.findingId)).toContain("architecture-backend-priority-conflict");
  });
  it("treats unresolved frontend-only form submission as a contradictory decision", () => {
    const v2 = emptyBriefV2Fields();
    const brief = baseBrief({ ...v2, forms: ["Contact form"], pages: [{ slug: "home", purpose: "Explain the service" }, { slug: "contact", purpose: "Contact form" }], formBehaviorRequirements: { ...v2.formBehaviorRequirements, formPresent: true, validation: "ACTIVE", successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "REQUIRED" } });
    const planning = PlanningPackageSchema.parse({ ...acceptedPlanning(brief), blockers: [] });
    const initialReview = deterministicArchitectureReview(reviewInput(brief, planning));
    expect(initialReview.verdict).toBe("APPROVED");
    const pending = PlanningPackageSchema.parse({ ...planning, forms: { ...planning.forms, forms: planning.forms.forms.map((form) => ({ ...form, submissionMechanism: "pending-decision" as const })) } });
    const review = deterministicArchitectureReview(reviewInput(brief, pending));
    expect(review.verdict).toBe("CHANGES_REQUIRED");
    expect(review.findings.map((finding) => finding.findingId)).toContain("architecture-review-local-form-submission-decision");
  });

  it("keeps reviewer proposal output separate from canonical persistence", async () => {
    const fixture = await createFixture();
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    await expect(service.review(fixture.input)).resolves.toMatchObject({ verdict: "APPROVED" });
    expect((await stateOf(fixture.database, fixture.brief.projectId)).review).toBeNull();
  });

  it("stamps host policy and canonical identity after a semantic provider proposal", async () => {
    const fixture = await createFixture();
    const policy = "architecture-review-p1";
    const authority = () => policy;
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider, policyVersion: authority });
    const result = await new ArchitectureReviewOrchestrationService(fixture.database, service, { policyVersion: authority }).reviewAndRoute(fixture.input);
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(result.result.policyVersion).toBe("architecture-review-p1");
    expect(state.review?.payload).toMatchObject({ projectId: fixture.brief.projectId, projectVersion: 1, policyVersion: "architecture-review-p1", approvedBriefChecksum: fixture.input.approvedBriefChecksum, acceptedPlanningChecksum: fixture.input.acceptedPlanningChecksum, reviewerAgentId: "architecture-reviewer", capability: "review.architecture" });
    expect((state.review?.payload as { evidenceCatalogId?: string; evidenceCatalogChecksum?: string; evidenceProvenance?: unknown[] } | undefined)?.evidenceCatalogId).toMatch(/^evidence-catalog-[0-9a-f]{16}$/);
    expect((state.review?.payload as { evidenceCatalogChecksum?: string } | undefined)?.evidenceCatalogChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect((state.review?.payload as { evidenceProvenance?: unknown[] } | undefined)?.evidenceProvenance?.length).toBeGreaterThan(0);
    expect((state.review?.payload as { result?: { policyVersion?: string } } | undefined)?.result?.policyVersion).toBe("architecture-review-p1");
    expect(state.events[0]).toMatchObject({ toState: "AWAITING_DESIGN_SELECTION" });
  });

  it("rejects a provider-authored legacy policy field as an invalid semantic proposal", async () => {
    const fixture = await createFixture();
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => ({ ...deterministicArchitectureReview(fixture.input), policyVersion: "provider-authored-old-policy" } as unknown as ReturnType<typeof deterministicArchitectureReview>) };
    await expect(new ArchitectureReviewService(fixture.database, { provider }).review(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_OUTPUT_INVALID" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a malformed semantic proposal without canonical writes", async () => {
    const fixture = await createFixture();
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => ({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: [] } as never) };
    await expect(new ArchitectureReviewService(fixture.database, { provider }).review(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_OUTPUT_INVALID" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a provider-authored canonical evidence path without canonical writes", async () => {
    const fixture = await createFixture();
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => ({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["acceptedPlanningPackage.architecture"] }) as never };
    await expect(new ArchitectureReviewService(fixture.database, { provider }).review(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_OUTPUT_INVALID" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a P1 proposal when host policy changes to P2 before commit", async () => {
    const fixture = await createFixture();
    let policy = "architecture-review-p1";
    const authority = () => policy;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { policy = "architecture-review-p2"; return deterministicArchitectureReview(fixture.input); } };
    const service = new ArchitectureReviewService(fixture.database, { provider, policyVersion: authority });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, service, { policyVersion: authority }).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE", message: expect.stringMatching(/policy changed/i) });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.history).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("commits PASS result, history, decision, event, and routing together", async () => {
    const fixture = await createFixture();
    const result = await new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider: deterministicProvider })).reviewAndRoute(fixture.input);
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(result).toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION", rowVersion: 2 });
    expect(state.project).toMatchObject({ workflow_state: "AWAITING_DESIGN_SELECTION", row_version: 2 });
    expect(state.review?.documentType).toBe("architecture-review");
    expect(state.review?.payload).toMatchObject({ architectureChecksum: checksumPersistedDocument(fixture.planning.architecture), phase7cChecksum: expect.stringMatching(/^[a-f0-9]{64}$/), reviewInputChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(state.briefV3?.payload).toMatchObject({ documentType: "brief-v3", approval: { approved: true, approvedCanonicalChecksum: fixture.briefV3.briefChecksum }, briefChecksum: fixture.input.approvedBriefChecksum });
    expect(state.history?.documentType).toBe("architecture-review-history");
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({ category: "architecture-review", actorIdentifier: "architecture-reviewer" });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ fromState: "ARCHITECTURE_REVIEW", toState: "AWAITING_DESIGN_SELECTION" });
    expect(evaluatePlanningAcceptanceReadiness({ planningPackage: fixture.planning }).deferredItems.map((item) => item.id)).toEqual(["FINAL_LEGAL_FACTS_REQUIRED", "PHOTO_RIGHTS_PROVENANCE_REQUIRED"]);
    expect(state.brief?.checksum).toBe(checksumPersistedDocument(fixture.brief));
    expect(state.planning?.checksum).toBe(checksumPersistedDocument(fixture.planning));
  });

  it("keeps Phase 7C and Architecture Review current across an envelope-only PlanningPackage change", async () => {
    const fixture = await createFixture();
    const documents = new DocumentRepository(fixture.database);
    const original = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!original || original.documentType !== "planning-package") throw new Error("fixture planning missing");
    await documents.save({ ...original, updatedAt: "2026-08-23T12:00:01.000Z" });
    const current = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!current || current.documentType !== "planning-package") throw new Error("current planning missing");
    expect(planningSemanticChecksum(current)).toBe(planningSemanticChecksum(fixture.planning));
    expect(checksumPersistedDocument(current)).not.toBe(checksumPersistedDocument(fixture.planning));
    const input = { ...fixture.input, acceptedPlanningPackage: current, acceptedPlanningChecksum: checksumPersistedDocument(current) };
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => { providerCalls += 1; return deterministicArchitectureReview(reviewInput); } };
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider })).reviewAndRoute(input)).resolves.toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(providerCalls).toBe(1);
    expect(state.phase7c?.payload).toMatchObject({ planningChecksum: planningSemanticChecksum(current), currentness: { status: "CURRENT", derivedFromChecksum: planningSemanticChecksum(current) } });
  });

  it("rejects a semantic PlanningPackage change before provider execution", async () => {
    const fixture = await createFixture();
    const documents = new DocumentRepository(fixture.database);
    const current = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!current || current.documentType !== "planning-package") throw new Error("fixture planning missing");
    const changed = PlanningPackageSchema.parse({ ...current, sitemap: { ...current.sitemap, routes: current.sitemap.routes.map((route, index) => index === 0 ? { ...route, titlePurpose: `${route.titlePurpose} (semantic change)` } : route) }, updatedAt: "2026-08-23T12:00:01.000Z" });
    await documents.save(changed);
    const input = { ...fixture.input, acceptedPlanningPackage: changed, acceptedPlanningChecksum: checksumPersistedDocument(changed) };
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => { providerCalls += 1; return deterministicArchitectureReview(reviewInput); } };
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider })).reviewAndRoute(input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(providerCalls).toBe(0);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a mismatched canonical Brief payload before provider execution", async () => {
    const fixture = await createFixture();
    const input = {
      ...fixture.input,
      canonicalBrief: { ...fixture.briefV3.brief, summary: "Synthetic stale canonical payload." },
    };
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => { providerCalls += 1; return deterministicArchitectureReview(reviewInput); } };
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider })).reviewAndRoute(input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    expect(providerCalls).toBe(0);
    expect((await stateOf(fixture.database, fixture.brief.projectId)).review).toBeNull();
  });

  it("rejects a Phase 7C binding that uses the Planning document checksum", async () => {
    const fixture = await createFixture();
    const documents = new DocumentRepository(fixture.database);
    const phase7c = await documents.get(fixture.brief.projectId, 1, "phase-7c-contract-package");
    if (!phase7c || phase7c.documentType !== "phase-7c-contract-package") throw new Error("fixture Phase 7C package missing");
    const planningDocumentChecksum = checksumPersistedDocument(fixture.planning);
    await documents.save({ ...phase7c, planningChecksum: planningDocumentChecksum, currentness: { ...phase7c.currentness, derivedFromChecksum: planningDocumentChecksum }, updatedAt: "2026-08-23T12:00:01.000Z" });
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => { providerCalls += 1; return deterministicArchitectureReview(reviewInput); } };
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider })).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE", message: expect.stringMatching(/Phase 7C/) });
    expect(providerCalls).toBe(0);
    expect((await stateOf(fixture.database, fixture.brief.projectId)).review).toBeNull();
  });

  it.each(["BLOCKED", "CHANGES_REQUIRED"] as const)("persists %s without advancing Design eligibility", async (label) => {
    const fixture = await createFixture();
    const catalog = createReviewEvidenceCatalog({ projectId: fixture.input.projectId, projectVersion: fixture.input.projectVersion, evidenceRefs: canonicalArchitectureEvidence(fixture.input), requestContext: fixture.input });
    const planningArchitectureId = evidenceIdFor({}, "planning:architecture", catalog);
    const providerResult = label === "BLOCKED"
      ? { verdict: "BLOCKED" as const, findings: [], reviewedArtifactRefs: [planningArchitectureId], blockedReason: "Synthetic canonical evidence block." }
      : { verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: "missing-decision", category: "MISSING_DECISION" as const, severity: "ERROR" as const, summary: "A decision is missing.", evidenceRefs: [planningArchitectureId], affectedArtifacts: [planningArchitectureId], recommendedAction: "Resolve the decision." }], reviewedArtifactRefs: [planningArchitectureId] };
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => providerResult as unknown as ArchitectureReviewResult };
    const result = await new ArchitectureReviewOrchestrationService(fixture.database, new ArchitectureReviewService(fixture.database, { provider })).reviewAndRoute(fixture.input);
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(result.projectState).toBe("ARCHITECTURE_REVIEW");
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 1 });
    expect(state.review).not.toBeNull();
    expect(state.decisions).toHaveLength(1);
    expect(state.events).toHaveLength(0);
  });

  it.each(["after-review-result-write", "after-review-history-write", "after-decision-write", "before-workflow-transition"] as const)("rolls back every canonical consequence at %s", async (point) => {
    const fixture = await createFixture();
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, service, { faultInjector: { hit: async (current) => { if (current === point) throw new Error(`synthetic-${point}`); } } }).reviewAndRoute(fixture.input)).rejects.toThrow(`synthetic-${point}`);
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 1 });
    expect(state.review).toBeNull();
    expect(state.history).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a currentness conflict after the provider returns without canonical writes", async () => {
    const fixture = await createFixture();
    const semanticBefore = planningSemanticChecksum(fixture.planning);
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { providerCalls += 1; const current = await new DocumentRepository(fixture.database).get(fixture.brief.projectId, 1, "planning-package"); if (!current || current.documentType !== "planning-package") throw new Error("fixture planning missing"); await new DocumentRepository(fixture.database).save({ ...current, updatedAt: "2026-08-23T12:01:00.000Z" }); return deterministicArchitectureReview(fixture.input); } };
    const service = new ArchitectureReviewService(fixture.database, { provider });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, service).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    const current = await new DocumentRepository(fixture.database).get(fixture.brief.projectId, 1, "planning-package");
    if (!current || current.documentType !== "planning-package") throw new Error("current planning missing");
    expect(providerCalls).toBe(1);
    expect(planningSemanticChecksum(current)).toBe(semanticBefore);
    expect(checksumPersistedDocument(current)).not.toBe(fixture.input.acceptedPlanningChecksum);
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it.each(["architecture", "phase-7c-contract-package"] as const)("rejects a stale %s artifact at the commit boundary", async (documentType) => {
    const fixture = await createFixture();
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { const current = await new DocumentRepository(fixture.database).get(fixture.brief.projectId, 1, documentType); if (!current) throw new Error("fixture document missing"); await new DocumentRepository(fixture.database).save({ ...current, updatedAt: "2026-08-23T12:01:00.000Z" }); return deterministicArchitectureReview(fixture.input); } };
    const service = new ArchitectureReviewService(fixture.database, { provider });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, service).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a stale project-version row at the commit boundary", async () => {
    const fixture = await createFixture();
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => {
      await fixture.database.transaction((tx) => tx.updateVersionRequirementsChecksum({ projectId: fixture.brief.projectId, version: 1, expectedRowVersion: 1, checksum: "a".repeat(64), updatedAt: "2026-08-23T12:01:00.000Z" }));
      return deterministicArchitectureReview(fixture.input);
    } };
    const service = new ArchitectureReviewService(fixture.database, { provider });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, service).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("replays a committed review after a fresh service reconstruction without provider work", async () => {
    const fixture = await createFixture();
    const first = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, first).reviewAndRoute(fixture.input)).resolves.toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION" });
    const second = new ArchitectureReviewService(fixture.database, { provider: { promptVersion: "architecture-reviewer.v2", review: async () => { throw new Error("provider must not run on replay"); } } });
    await expect(new ArchitectureReviewOrchestrationService(fixture.database, second).reviewAndRoute(fixture.input)).resolves.toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION", projectionStatus: "REPLAYED" });
    const state = await stateOf(fixture.database, fixture.brief.projectId);
    expect(state.decisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("rejects idempotency reuse when bounded review context changes", async () => {
    const fixture = await createFixture();
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    await service.review({ ...fixture.input, idempotencyKey: "same-review" });
    await expect(service.review({ ...fixture.input, idempotencyKey: "same-review", relevantProjectConstraints: ["Preserve the public boundary."] })).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT" });
  });

  it("enforces bounded correction cycles", () => {
    const service = new ArchitectureReviewService(new InMemoryPersistenceDatabase());
    const projectId = id();
    service.recordCorrectionCycle(projectId, 1);
    service.recordCorrectionCycle(projectId, 1);
    expect(() => service.recordCorrectionCycle(projectId, 1)).toThrowError(ArchitectureReviewError);
  });

  it("recovers a failed derived decision projection without rerunning review", async () => {
    const fixture = await createFixture();
    class FailingProjection extends FakeProjectMemorySyncPort {
      fail = true;
      override async appendDecision(projectId: string, version: number, decision: Parameters<FakeProjectMemorySyncPort["appendDecision"]>[2]) { if (this.fail) throw new Error("synthetic-projection-failure"); return super.appendDecision(projectId, version, decision); }
    }
    const projection = new FailingProjection();
    const service = new ArchitectureReviewService(fixture.database, { provider: deterministicProvider });
    const orchestration = new ArchitectureReviewOrchestrationService(fixture.database, service, { projection });
    await expect(orchestration.reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_PROJECTION_FAILED" });
    expect((await stateOf(fixture.database, fixture.brief.projectId)).decisions).toHaveLength(1);
    projection.fail = false;
    await expect(orchestration.reconcileArchitectureReviewProjection(fixture.brief.projectId, 1)).resolves.toMatchObject({ projectionStatus: "SYNCED", decisionCount: 1 });
    expect(projection.decisions.get(`${fixture.brief.projectId}:1`)).toHaveLength(1);
  });

  it("keeps alternate production entrypoints on the atomic orchestration boundary", () => {
    const workbench = readFileSync("src/runtime/workbench/application.ts", "utf8");
    const alternate = readFileSync("src/runtime/production-e2e-stage-runner.ts", "utf8");
    expect(workbench).toContain("scope.architectureReviewer.reviewAndRoute");
    expect(alternate).toContain("scope.architectureReviewer.reviewAndRoute");
    expect(readFileSync("src/orchestration/architecture-review/service.ts", "utf8")).not.toContain("workflow.transition");
  });
});

function configuredDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*DATABASE_URL\s*=/.test(candidate));
    const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
}

const databaseUrl = configuredDatabaseUrl();
const describePostgres = describe.skipIf(!databaseUrl);
const postgresProjectIds: string[] = [];

async function cleanupPostgres(pool: Pool) {
  for (const projectId of postgresProjectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM workflow_events WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM decision_records WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM workflow_documents WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM project_versions WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM factory_projects WHERE id=$1", [projectId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

describePostgres("Architecture Review real Postgres certification", () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let database: PostgresPersistenceDatabase;

  beforeAll(() => {
    pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
    database = new PostgresPersistenceDatabase(pool);
  });

  afterAll(async () => {
    await cleanupPostgres(pool);
    await pool.end();
  });

  it("commits the production-shaped PASS on real Postgres", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider: deterministicProvider })).reviewAndRoute(fixture.input)).resolves.toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION" });
    const state = await stateOf(database, fixture.brief.projectId);
    const planning = await new DocumentRepository(database).get(fixture.brief.projectId, 1, "planning-package");
    const phase7c = await new DocumentRepository(database).get(fixture.brief.projectId, 1, "phase-7c-contract-package");
    expect(state.project).toMatchObject({ workflow_state: "AWAITING_DESIGN_SELECTION", row_version: 2 });
    expect(state.review).not.toBeNull();
    expect(state.decisions).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(planning && phase7c && planning.documentType === "planning-package" && phase7c.documentType === "phase-7c-contract-package").toBe(true);
    if (planning?.documentType === "planning-package" && phase7c?.documentType === "phase-7c-contract-package") {
      expect(planningSemanticChecksum(planning)).toBe(phase7c.planningChecksum);
      expect(checksumPersistedDocument(planning)).not.toBe(phase7c.planningChecksum);
    }
  });

  it("rejects an unknown issued-looking evidence ID before any canonical Postgres write", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => {
      providerCalls += 1;
      return { ...deterministicArchitectureReview(reviewInput), reviewedArtifactRefs: [`E${"f".repeat(16)}-999`] };
    } };
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider })).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_OUTPUT_INVALID" });
    const state = await stateOf(database, fixture.brief.projectId);
    expect(providerCalls).toBe(1);
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 1 });
    expect(state.review).toBeNull();
    expect(state.history).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("passes real Postgres currentness after an envelope-only PlanningPackage change", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    const documents = new DocumentRepository(database);
    const original = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!original || original.documentType !== "planning-package") throw new Error("fixture planning missing");
    await documents.save({ ...original, updatedAt: "2026-08-23T12:00:01.000Z" });
    const current = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!current || current.documentType !== "planning-package") throw new Error("current planning missing");
    const input = { ...fixture.input, acceptedPlanningPackage: current, acceptedPlanningChecksum: checksumPersistedDocument(current) };
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider: deterministicProvider })).reviewAndRoute(input)).resolves.toMatchObject({ projectState: "AWAITING_DESIGN_SELECTION" });
    expect(planningSemanticChecksum(current)).toBe(planningSemanticChecksum(fixture.planning));
    expect(checksumPersistedDocument(current)).not.toBe(checksumPersistedDocument(fixture.planning));
  });

  it("rejects a real Postgres semantic PlanningPackage change before provider execution", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    const documents = new DocumentRepository(database);
    const current = await documents.get(fixture.brief.projectId, 1, "planning-package");
    if (!current || current.documentType !== "planning-package") throw new Error("fixture planning missing");
    const changed = PlanningPackageSchema.parse({ ...current, sitemap: { ...current.sitemap, routes: current.sitemap.routes.map((route, index) => index === 0 ? { ...route, titlePurpose: `${route.titlePurpose} (semantic change)` } : route) }, updatedAt: "2026-08-23T12:00:01.000Z" });
    await documents.save(changed);
    const input = { ...fixture.input, acceptedPlanningPackage: changed, acceptedPlanningChecksum: checksumPersistedDocument(changed) };
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (reviewInput: ArchitectureReviewInput) => { providerCalls += 1; return deterministicArchitectureReview(reviewInput); } };
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider })).reviewAndRoute(input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    expect(providerCalls).toBe(0);
    expect((await stateOf(database, fixture.brief.projectId)).review).toBeNull();
  });

  it("rejects a real Postgres envelope change at commit even when semantic planning is unchanged", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { providerCalls += 1; const current = await new DocumentRepository(database).get(fixture.brief.projectId, 1, "planning-package"); if (!current || current.documentType !== "planning-package") throw new Error("fixture planning missing"); await new DocumentRepository(database).save({ ...current, updatedAt: "2026-08-23T12:01:00.000Z" }); return deterministicArchitectureReview(fixture.input); } };
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider })).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    expect(providerCalls).toBe(1);
    const state = await stateOf(database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a real Postgres P1 proposal after the host policy changes to P2", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    let policy = "architecture-review-p1";
    const authority = () => policy;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { policy = "architecture-review-p2"; return deterministicArchitectureReview(fixture.input); } };
    const service = new ArchitectureReviewService(database, { provider, policyVersion: authority });
    await expect(new ArchitectureReviewOrchestrationService(database, service, { policyVersion: authority }).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE" });
    const state = await stateOf(database, fixture.brief.projectId);
    expect(state.review).toBeNull();
    expect(state.history).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rejects a real Postgres PlanningPackage row-version change with identical document semantics", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    let providerCalls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async () => { providerCalls += 1; const current = await new DocumentRepository(database).get(fixture.brief.projectId, 1, "planning-package"); if (!current || current.documentType !== "planning-package") throw new Error("fixture planning missing"); await new DocumentRepository(database).save(current); return deterministicArchitectureReview(fixture.input); } };
    await expect(new ArchitectureReviewOrchestrationService(database, new ArchitectureReviewService(database, { provider })).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "ARCHITECTURE_REVIEW_STALE", message: "The accepted PlanningPackage row is stale." });
    expect(providerCalls).toBe(1);
    const state = await stateOf(database, fixture.brief.projectId);
    expect(state.planning?.rowVersion).toBe(2);
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rolls back real Postgres writes after the decision boundary", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    const service = new ArchitectureReviewService(database, { provider: deterministicProvider });
    await expect(new ArchitectureReviewOrchestrationService(database, service, { faultInjector: { hit: async (point) => { if (point === "after-decision-write") throw new Error("synthetic-postgres-rollback"); } } }).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await stateOf(database, fixture.brief.projectId);
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 1 });
    expect(state.review).toBeNull();
    expect(state.history).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("rolls back real Postgres writes when workflow transition persistence fails", async () => {
    const fixture = await createFixture(database);
    postgresProjectIds.push(fixture.brief.projectId);
    const failingDatabase: PersistenceDatabase = {
      transaction: (work) => database.transaction((tx) => work({ ...tx, updateProjectState: async () => { throw new Error("synthetic-transition-failure"); } })),
    };
    const service = new ArchitectureReviewService(failingDatabase, { provider: deterministicProvider });
    await expect(new ArchitectureReviewOrchestrationService(failingDatabase, service).reviewAndRoute(fixture.input)).rejects.toMatchObject({ code: "PERSISTENCE_PROVIDER_ERROR" });
    const state = await stateOf(database, fixture.brief.projectId);
    expect(state.project).toMatchObject({ workflow_state: "ARCHITECTURE_REVIEW", row_version: 1 });
    expect(state.review).toBeNull();
    expect(state.decisions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});

if (!databaseUrl) console.log("ARCHITECTURE REVIEW POSTGRES CERTIFICATION: SKIPPED (DATABASE_URL unavailable)");
else console.log("ARCHITECTURE REVIEW POSTGRES CERTIFICATION: ENABLED");
