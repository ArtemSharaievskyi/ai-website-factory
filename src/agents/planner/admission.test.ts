import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakePlannerMemoryPort } from "./memory";
import { PlannerArchitectService } from "./service";
import { buildPlanningPackage } from "./deterministic";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FactoryProjectSchema } from "@/domain/project/schema";
import type { RequirementSpecification } from "@/domain/requirements/schema";

const id = randomUUID;
const brief = (): RequirementSpecification => ({
  schemaVersion: 1,
  documentType: "requirements",
  projectId: id(),
  projectVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectSummary: "Serve local customers",
  protectedFunctionalityRequired: false,
  imagesRequired: false,
  businessGoals: ["Serve local customers"],
  targetAudiences: ["Local customers"],
  pages: [{ slug: "home", purpose: "Introduce the business" }],
  userRoles: [],
  features: ["Contact form"],
  forms: ["Contact form"],
  contentRequirements: [],
  backendRequirements: [],
  supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first",
  storageDecision: "not-needed",
  emailDecision: "not-needed",
  administrationDecision: "not-needed",
  seoRequirements: ["Page titles"],
  localization: { locales: ["en"], defaultLocale: "en" },
  imageSourceDecision: "pending",
  suppliedBrandInformation: { status: "missing" },
  suppliedLogoLocation: { status: "missing" },
  technicalConstraints: [],
  explicitExclusions: [],
  userAcceptanceCriteria: ["Visitor can submit contact request"],
  unresolvedItems: [],
  approval: {
    approved: true,
    approvedAt: "2026-01-01T00:00:00.000Z",
    approvedBy: "user",
    approvedRequirementsChecksum: "a".repeat(64),
  },
  contactFacts: [],
  legalFacts: [],
  brandFacts: [],
  logoMetadata: [],
  imageSourcingNotes: [],
  evidence: [],
  recommendations: [],
  briefStatus: "approved",
  briefVersion: 1,
});

async function prepareProject(database: InMemoryPersistenceDatabase, projectId: string) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  await new ProjectRepository(database).create(FactoryProjectSchema.parse({
    schemaVersion: 1,
    documentType: "factory-project",
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    id: projectId,
    slug: "admission-test",
    origin: "USER",
    siteLanguage: "UNRESOLVED",
    originalPrompt: "Synthetic admission test",
    currentVersion: 1,
    workflowState: "AWAITING_PLANNING_GENERATION",
  }));
  await new ProjectVersionRepository(database).create({
    id: id(),
    projectId,
    versionNumber: 1,
    state: "AWAITING_PLANNING_GENERATION",
    memoryRootPath: null,
    requirementsChecksum: null,
    selectedDesignChecksum: null,
    architectureChecksum: null,
    releasedAt: null,
    immutable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    rowVersion: 1,
  });
}

describe("Planner deterministic admission", () => {
  it("rejects invalid provider dependencies before the planning package is persisted", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = id();
    await prepareProject(database, projectId);
    const approvedBrief = { ...brief(), projectId };
    const input: PlannerAgentInput = {
      projectId,
      projectVersion: 1,
      approvedBrief,
      approvedBriefChecksum: checksumPersistedDocument(approvedBrief),
      originalPromptReference: "original-prompt.md",
      clarificationEvidenceReferences: ["clarification-log.json"],
      currentWorkflowState: "AWAITING_PLANNING_GENERATION",
      existingDecisions: [],
      suppliedFiles: [],
      allowedSkills: [],
      idempotencyKey: `admission-${id()}`,
      expectedRowVersion: 1,
    };
    const valid = buildPlanningPackage(input);
    const invalid = PlanningPackageSchema.parse({
      ...valid,
      dependencies: {
        ...valid.dependencies,
        dependencies: valid.dependencies.dependencies.map((dependency) => ({
          ...dependency,
          name: "unknown-package@1.0.0",
        })),
      },
      architecture: {
        ...valid.architecture,
        dependencies: valid.architecture.dependencies.map((dependency) => ({
          ...dependency,
          name: "unknown-package@1.0.0",
        })),
      },
    });
    const planner = new PlannerArchitectService({
      database,
      memory: new FakePlannerMemoryPort(),
      provider: { plan: async () => invalid as PlanningPackage },
    });

    await expect(planner.planApprovedProject(input)).rejects.toMatchObject({
      code: "PLANNING_PACKAGE_INVALID",
    });
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toBeNull();
  });
});
