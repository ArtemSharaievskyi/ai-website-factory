import { describe, expect, it } from "vitest";
import { buildPlanningPackage, validatePlanningDependencies } from "./deterministic";
import { PlannerAgentInputSchema } from "./contracts";
import { canonicalBriefToPlannerBrief } from "./brief-context";
import { representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FakePlannerMemoryPort } from "./memory";
import { PlannerArchitectService } from "./service";
import type { PlannerAgentInput } from "./contracts";
import { approvedBriefForDownstream } from "@/runtime/workbench/application";
import { boundedRolePrompt } from "@/runtime/context/bridge";

const furniture = [
  "Haus & Montage — Transport von Möbeln",
  "Haus & Montage — Abholung und Lieferung",
  "Haus & Montage — Hilfe beim Be- und Entladen",
  "Haus & Montage — auf Wunsch Auf- und Abbau von Möbeln",
];

const canonical = (): CanonicalBriefV3 => CanonicalBriefV3Schema.parse({
  schemaVersion: 3,
  summary: "Synthetic local service website with a bounded Haus & Montage offer.",
  title: "Synthetic Haus Service",
  scope: { protectedFunctionality: false, images: { required: true, sourceStrategy: "USER_SUPPLIED" } },
  pages: [{ id: "PAGE:home", slug: "home", purpose: "Explain the synthetic service.", sourceRefs: ["fixture:page"] }],
  requirements: [
    { id: "REQUIREMENT:existing-service", category: "FEATURE", statement: "Synthetic garden service overview.", sourceRefs: ["fixture:service"] },
    ...furniture.map((statement, index) => ({ id: `REQUIREMENT:furniture-${index}`, category: "CONTENT" as const, statement, sourceRefs: ["fixture:furniture"] })),
    { id: "REQUIREMENT:restricted", category: "EXCLUSION", statement: "Do not expand restricted repair wording into full trade services.", sourceRefs: ["fixture:restriction"] },
    { id: "REQUIREMENT:brand", category: "BRAND_VISUAL", statement: "Use the supplied synthetic green visual direction.", sourceRefs: ["fixture:brand"] },
    { id: "REQUIREMENT:seo", category: "SEO", statement: "Use the synthetic local search wording.", sourceRefs: ["fixture:seo"] },
  ],
  decisions: {
    form: {
      mode: "SIMULATED",
      formPresent: true,
      validation: "ACTIVE",
      simulatedSuccessPolicy: "ALLOWED",
      transmissionMode: "NONE",
      persistenceMode: "NONE",
      serverProcessingMode: "NONE",
      externalProviderMode: "NONE",
      privacyConsentMode: "REQUIRED",
      interactionStates: [],
    },
    database: { mode: "NONE" },
    auth: { mode: "NONE" },
    analytics: { mode: "NONE" },
    routePolicy: { mode: "SINGLE_PAGE" },
  },
  assets: [{ id: "ASSET_COMPANY_LOGO", reference: "asset:synthetic-logo", role: "logo", usage: "Use the supplied synthetic logo.", replacementPolicy: "FORBIDDEN", sourceRefs: ["fixture:logo"] }],
  brand: { referenceStrategy: "USER_SUPPLIED", suppliedInformation: "Synthetic green identity.", suppliedLogoDescription: "Synthetic supplied logo." },
  seo: { primaryKeywords: ["synthetic service"], exactTitle: "Synthetic Service", exactMetaDescription: "Synthetic local service.", locationTargeting: [], pageMetadata: [] },
  legal: { placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsPolicy: "FORBIDDEN" },
  localization: { locales: ["de"], defaultLocale: "de" },
  evidence: [],
  unresolved: [],
});

const input = (brief: CanonicalBriefV3) => PlannerAgentInputSchema.parse({
  projectId: representativeV1Brief.projectId,
  projectVersion: 1,
  approvedBrief: representativeV1Brief,
  canonicalBrief: brief,
  approvedBriefChecksum: "a".repeat(64),
  originalPromptReference: "original-prompt.md",
  clarificationEvidenceReferences: [],
  currentWorkflowState: "AWAITING_PLANNING_GENERATION",
  existingDecisions: [],
  suppliedFiles: [],
  allowedSkills: [],
  idempotencyKey: "synthetic-canonical-planner-boundary",
  expectedRowVersion: 1,
});

describe("canonical Brief to Planner boundary", () => {
  it("keeps current V3 requirements authoritative over stale legacy fields", () => {
    const brief = canonical();
    const staleLegacy = { ...representativeV1Brief, features: ["STALE LEGACY SERVICE MUST NOT WIN"] };
    const view = canonicalBriefToPlannerBrief(brief, staleLegacy);
    expect(view.features).toEqual(["Synthetic garden service overview."]);
    expect(view.features).not.toContain("STALE LEGACY SERVICE MUST NOT WIN");
    expect(view.contentRequirements).toEqual(furniture);
    expect(view.brandVisualRequirements?.spacingLayoutDirection.map((entry) => entry.statement)).toContain("Use the supplied synthetic green visual direction.");
    expect(view.seoMetadata?.exactTitle).toBe("Synthetic Service");
  });

  it("preserves all furniture scope points and the no-backend form decision in deterministic Planning", () => {
    const planning = buildPlanningPackage(input(canonical()));
    expect(furniture.every((statement) => planning.productScope.inScopeCapabilities.includes(statement))).toBe(true);
    expect(planning.productScope.inScopeCapabilities).toContain("Synthetic garden service overview.");
    expect(planning.architecture.backendPriority).toEqual([]);
    expect(planning.dataModel.entities).toHaveLength(0);
    expect(planning.supabase).toMatchObject({ postgres: false, auth: false, storage: false, realtime: false });
    expect(planning.authentication.decision).toBe("none");
    expect(planning.forms.forms[0]?.submissionMechanism).toBe("client-only");
    expect(planning.architecture.serverActions).toEqual([]);
    expect(planning.architecture.routeHandlers).toEqual([]);
  });

  it("does not infer Supabase from stale backend-looking requirements when canonical Database and Auth are NONE", () => {
    const brief = CanonicalBriefV3Schema.parse({
      ...canonical(),
      requirements: [
        ...canonical().requirements,
        { id: "REQUIREMENT:stale-backend-signal", category: "BACKEND" as const, statement: "Synthetic external request boundary; no persistence is approved.", sourceRefs: ["fixture:backend"] },
      ],
    });
    const planning = buildPlanningPackage(input(brief));
    expect(planning.dataModel.entities).toHaveLength(0);
    expect(planning.supabase).toMatchObject({ postgres: false, auth: false, storage: false, realtime: false, environmentVariables: [] });
    expect(planning.dependencies.dependencies.map((dependency) => dependency.name)).toEqual(["zod@^4.4.3"]);
    expect(planning.architecture.dependencies.map((dependency) => dependency.name)).toEqual(["zod@^4.4.3"]);
  });

  it("adds only pinned Supabase database dependencies for an approved database-only decision", () => {
    const base = canonical();
    const brief = CanonicalBriefV3Schema.parse({
      ...base,
      requirements: [...base.requirements, { id: "REQUIREMENT:persistence", category: "DATABASE" as const, statement: "Persist synthetic requests in the approved database.", sourceRefs: ["fixture:database"] }],
      decisions: { ...base.decisions, database: { mode: "SUPABASE" as const } },
    });
    const planning = buildPlanningPackage(input(brief));
    expect(planning.supabase).toMatchObject({ postgres: true, auth: false });
    expect(planning.dependencies.dependencies.map((dependency) => dependency.name)).toEqual(["zod@^4.4.3", "@supabase/supabase-js@2.114.0"]);
    expect(validatePlanningDependencies(planning).every((decision) => decision.approved)).toBe(true);
  });

  it("adds the approved pinned auth and SSR dependencies for an auth-required project", () => {
    const base = canonical();
    const brief = CanonicalBriefV3Schema.parse({ ...base, decisions: { ...base.decisions, auth: { mode: "REQUIRED" as const } } });
    const planning = buildPlanningPackage(input(brief));
    expect(planning.supabase).toMatchObject({ postgres: false, auth: true });
    expect(planning.dependencies.dependencies.map((dependency) => dependency.name)).toEqual(["zod@^4.4.3", "@supabase/supabase-js@2.114.0", "@supabase/ssr@0.12.6"]);
  });

  it("carries the full canonical Brief on the typed Planner input", () => {
    const brief = canonical();
    const parsed = input(brief);
    expect(parsed.canonicalBrief?.requirements).toEqual(brief.requirements);
    expect(JSON.stringify(parsed.canonicalBrief)).toContain("Haus & Montage — Hilfe beim Be- und Entladen");
  });

  it("runs the production-shaped Planner service from the persisted approved V3 Brief", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = representativeV1Brief.projectId;
    const timestamp = "2026-01-01T00:00:00.000Z";
    const project = FactoryProjectSchema.parse({
      schemaVersion: 1,
      documentType: "factory-project",
      projectId,
      projectVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      id: projectId,
      slug: "synthetic-canonical-planner-boundary",
      origin: "USER",
      originalPrompt: "Synthetic service planning boundary fixture.",
      currentVersion: 1,
      workflowState: "AWAITING_PLANNING_GENERATION",
    });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({
      id: "00000000-0000-4000-8000-000000000001",
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

    const brief = canonical();
    const createdV3 = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
    const approvedV3 = BriefV3DocumentSchema.parse({
      ...createdV3,
      approval: {
        approved: true,
        approvedAt: timestamp,
        approvedBy: "synthetic-user",
        approvedCanonicalChecksum: createdV3.briefChecksum,
      },
    });
    const staleLegacy = { ...representativeV1Brief, features: ["STALE LEGACY SERVICE"], forms: [], contentRequirements: [] };
    await new DocumentRepository(database).save(staleLegacy);
    await new DocumentRepository(database).save(approvedV3);
    const workbenchView = approvedBriefForDownstream(staleLegacy, approvedV3);
    expect(workbenchView.contentRequirements).toEqual(furniture);
    expect(workbenchView.features).not.toContain("STALE LEGACY SERVICE");

    let providerInput: PlannerAgentInput | undefined;
    let providerCalls = 0;
    const service = new PlannerArchitectService({
      database,
      memory: new FakePlannerMemoryPort(),
      provider: {
        plan: async (received) => {
          providerCalls += 1;
          providerInput = received;
          return buildPlanningPackage(received);
        },
      },
    });
    const plannerInput = PlannerAgentInputSchema.parse({
      ...input(brief),
      projectId,
      approvedBrief: staleLegacy,
      approvedBriefChecksum: approvedV3.briefChecksum,
      idempotencyKey: "synthetic-production-planner-refresh",
    });
    const planning = await service.planApprovedProject(plannerInput);

    expect(providerCalls).toBe(1);
    expect(providerInput?.canonicalBrief).toEqual(approvedV3.brief);
    const plannerPrompt = boundedRolePrompt("planner", providerInput);
    expect(furniture.every((statement) => plannerPrompt.user.includes(statement))).toBe(true);
    expect(providerInput?.approvedBrief.contentRequirements).toEqual(furniture);
    expect(providerInput?.approvedBrief.features).toContain("Synthetic garden service overview.");
    expect(providerInput?.approvedBrief.features).not.toContain("STALE LEGACY SERVICE");
    expect(providerInput?.approvedBrief.explicitExclusions).toContain("Do not expand restricted repair wording into full trade services.");
    expect(providerInput?.approvedBrief.seoMetadata?.exactTitle).toBe("Synthetic Service");
    expect(providerInput?.approvedBrief.brandVisualRequirements?.spacingLayoutDirection.map((entry) => entry.statement)).toContain("Use the supplied synthetic green visual direction.");
    expect(planning.approvedBriefChecksum).toBe(approvedV3.briefChecksum);
    expect(furniture.every((statement) => planning.productScope.inScopeCapabilities.includes(statement))).toBe(true);
    expect(planning.architecture.backendPriority).toEqual([]);
    expect(planning.forms.forms[0]?.submissionMechanism).toBe("client-only");
    expect(planning.dataModel.entities).toHaveLength(0);
    expect(planning.authentication.decision).toBe("none");
    expect(planning.supabase).toMatchObject({ postgres: false, auth: false, storage: false, realtime: false });
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toMatchObject({ approvedBriefChecksum: approvedV3.briefChecksum });

    const staleCanonical = CanonicalBriefV3Schema.parse({ ...brief, summary: "Changed after approval." });
    await expect(service.planApprovedProject({ ...plannerInput, canonicalBrief: staleCanonical, idempotencyKey: "synthetic-stale-canonical" })).rejects.toMatchObject({ code: "BRIEF_CHECKSUM_MISMATCH" });
    expect(providerCalls).toBe(1);
  });
});
