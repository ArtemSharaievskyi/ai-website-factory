import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakePlannerMemoryPort } from "./memory";
import { PlannerArchitectService } from "./service";
import { buildPlanningPackage, evaluatePlanningAcceptanceReadiness } from "./deterministic";
import { PlanningPackageSchema, type PlannerAgentInput } from "./contracts";

const brief = (overrides: Partial<RequirementSpecification> = {}): RequirementSpecification => RequirementSpecificationSchema.parse({
  schemaVersion: 1,
  documentType: "requirements",
  projectId: randomUUID(),
  projectVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectSummary: "Synthetic service site",
  protectedFunctionalityRequired: false,
  imagesRequired: true,
  businessGoals: ["Explain the service"],
  targetAudiences: ["Visitors"],
  pages: [
    { slug: "home", purpose: "Explain the service" },
    { slug: "impressum", purpose: "Show legal information placeholders" },
    { slug: "datenschutz", purpose: "Show privacy information placeholders" },
  ],
  userRoles: [],
  features: [],
  forms: [],
  contentRequirements: [],
  backendRequirements: [],
  supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first",
  storageDecision: "not-needed",
  emailDecision: "not-needed",
  administrationDecision: "not-needed",
  seoRequirements: [],
  localization: { locales: ["en"], defaultLocale: "en" },
  imageSourceDecision: "custom",
  suppliedBrandInformation: { status: "missing" },
  suppliedLogoLocation: { status: "missing" },
  technicalConstraints: [],
  explicitExclusions: [],
  userAcceptanceCriteria: ["Visitors can read the service information"],
  unresolvedItems: [],
  approval: { approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "synthetic", approvedRequirementsChecksum: "a".repeat(64) },
  contactFacts: [],
  legalFacts: [],
  brandFacts: [],
  logoMetadata: [],
  imageSourcingNotes: [],
  evidence: [],
  recommendations: [],
  briefStatus: "approved",
  briefVersion: 1,
  ...overrides,
});

const plannerInput = (value: RequirementSpecification): PlannerAgentInput => ({
  projectId: value.projectId,
  projectVersion: 1,
  approvedBrief: value,
  approvedBriefChecksum: checksumPersistedDocument(value),
  originalPromptReference: "synthetic-prompt.md",
  clarificationEvidenceReferences: ["synthetic-clarification-log.json"],
  currentWorkflowState: "AWAITING_DESIGN_SELECTION",
  existingDecisions: [],
  suppliedFiles: [],
  allowedSkills: [],
  idempotencyKey: "synthetic-planning-acceptance",
  expectedRowVersion: 1,
});

function deferredPackage() {
  const value = brief();
  const packageValue = buildPlanningPackage(plannerInput(value));
  return PlanningPackageSchema.parse({
    ...packageValue,
    assets: {
      ...packageValue.assets,
      entries: packageValue.assets.entries.map((entry) => entry.isLogo ? entry : { ...entry, generationStatus: "pending-approval" as const, userApprovalRequired: true }),
    },
    blockers: [
      "Final legal address and registry facts must replace explicit placeholders before public publication.",
      "Rights and licenses for future additional photography must be checked and documented before publication.",
    ],
  });
}

describe("Planning Acceptance readiness ownership", () => {
  it("defers legal publication facts and future photography rights while keeping them visible", () => {
    const packageValue = deferredPackage();
    const result = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context: { legalPlaceholderPolicy: "USE_EXPLICIT_PLACEHOLDERS" } });

    expect(result.readyForAcceptance).toBe(true);
    expect(result.blockingItems).toEqual([]);
    expect(result.deferredItems.map((item) => [item.id, item.classification, item.deferredStage])).toEqual([
      ["FINAL_LEGAL_FACTS_REQUIRED", "D", "PUBLICATION"],
      ["PHOTO_RIGHTS_PROVENANCE_REQUIRED", "B", "DESIGN"],
    ]);
    expect(result.deferredItems.every((item) => item.publicationSafetyRequired)).toBe(true);
    expect(packageValue.blockers).toHaveLength(2);
  });

  it("keeps a genuine technical blocker blocking acceptance", () => {
    const packageValue = PlanningPackageSchema.parse({ ...deferredPackage(), blockers: ["EMAIL_PROVIDER_PENDING"] });
    const result = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue });

    expect(result.readyForAcceptance).toBe(false);
    expect(result.blockingItems).toMatchObject([{ id: "PACKAGE_BLOCKER_1", classification: "A", sourcePath: "planning-package.blockers[0]" }]);
    expect(result.deferredItems).toEqual([]);
  });

  it("does not turn a legal technical dependency into a publication deferral", () => {
    const packageValue = PlanningPackageSchema.parse({ ...deferredPackage(), blockers: ["Legal API provider must be configured before public publication."] });
    const result = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context: { legalPlaceholderPolicy: "USE_EXPLICIT_PLACEHOLDERS" } });

    expect(result.readyForAcceptance).toBe(false);
    expect(result.blockingItems[0]).toMatchObject({ id: "PACKAGE_BLOCKER_1", classification: "A" });
    expect(result.deferredItems).toEqual([]);
  });

  it("does not defer legal facts when the Brief disallows placeholders", () => {
    const packageValue = PlanningPackageSchema.parse({ ...deferredPackage(), blockers: [deferredPackage().blockers[0]!] });
    const result = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context: { legalPlaceholderPolicy: "NO_PLACEHOLDERS" } });

    expect(result.readyForAcceptance).toBe(false);
    expect(result.blockingItems[0]).toMatchObject({ id: "PACKAGE_BLOCKER_1", classification: "A" });
  });

  it("keeps a concrete rejected asset as an earlier technical blocker", () => {
    const original = deferredPackage();
    const packageValue = PlanningPackageSchema.parse({
      ...original,
      assets: { ...original.assets, entries: original.assets.entries.map((entry, index) => index === 0 ? { ...entry, generationStatus: "rejected" as const } : entry) },
      blockers: ["Concrete photo asset is rejected and unusable under the current asset policy."],
    });
    const result = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue });

    expect(result.readyForAcceptance).toBe(false);
    expect(result.blockingItems.map((item) => item.id)).toEqual(expect.arrayContaining(["CONCRETE_ASSET_INVALID", "ASSET_MANIFEST_INVALID"]));
    expect(result.deferredItems).toEqual([]);
  });

  it("uses the same authority at the Planner service acceptance boundary", async () => {
    const packageValue = deferredPackage();
    const database = new InMemoryPersistenceDatabase();
    await new DocumentRepository(database).save(packageValue);
    const service = new PlannerArchitectService({ database, memory: new FakePlannerMemoryPort() });

    const result = await service.validatePlanningPackage(packageValue.projectId, packageValue.projectVersion);

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.deferredItems).toHaveLength(2);
    expect(result.package.blockers).toEqual(packageValue.blockers);
  });
});
