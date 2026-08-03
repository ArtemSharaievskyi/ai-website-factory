import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TechnicalArchitectureSchema } from "./architecture/schema";
import { AssetManifestSchema } from "./assets/schema";
import { DesignDirectionSchema, DesignDirectionSetSchema, SelectedDesignSchema } from "./design/schema";
import { FactoryProjectSchema } from "./project/schema";
import { RequirementSpecificationSchema } from "./requirements/schema";
import { QualityReportSchema } from "./quality/schema";
import { ReleaseReportSchema } from "./release/schema";
import { AgentTaskSchema, TaskGraphSchema } from "./tasks/schema";
import { DomainError, serializeDomainError } from "./shared/errors";
import { transitionWorkflow } from "./workflow/engine";

const id = () => randomUUID();
const base = (documentType: string) => ({ schemaVersion: 1 as const, documentType, projectId: id(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const requirements = (approved = true) => RequirementSpecificationSchema.parse({ ...base("requirements"), projectSummary: "A clear project", protectedFunctionalityRequired: false, imagesRequired: true, businessGoals: ["Serve customers"], targetAudiences: ["Customers"], pages: [{ slug: "home", purpose: "Entry point" }], userRoles: [], features: ["Contact"], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [], localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "user-supplied", suppliedBrandInformation: { status: "provided", value: "Brand facts" }, suppliedLogoLocation: { status: "provided", value: "logo.svg" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home renders"], unresolvedItems: [], approval: approved ? { approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "user", approvedRequirementsChecksum: "a".repeat(64) } : { approved: false } });
const direction = () => DesignDirectionSchema.parse({ id: id(), label: "Editorial", concept: "Editorial clarity", rationale: "Readable", mood: "Calm", colorStrategy: "Ink and cyan", typographyStrategy: "Strong sans", layoutStrategy: "Grid", heroStrategy: "Focused", sectionRhythm: "Alternating", componentCharacter: "Quiet", imageArtDirection: "Documentary", motionPolicy: "Purposeful only", responsivePrinciples: ["Stack on mobile"], antiTemplateRules: ["No generic gradients"], advantages: ["Clear"], risks: ["Needs content"], requirementReferences: [] });
const architecture = () => TechnicalArchitectureSchema.parse({ ...base("architecture"), applicationProfile: "business-site", packageManager: "npm", routes: [{ path: "/", responsibility: "Home" }], componentBoundaries: ["Header"], componentDecisions: [{ area: "Header", serverOrClient: "server", rationale: "No interaction" }], serverActions: [], routeHandlers: [], backendPriority: ["server-actions", "route-handlers", "supabase-services"], supabaseDatabaseRequirements: [], schemaPlan: [], rlsRequirements: [], authenticationPlan: "None", storagePlan: "None", emailPlan: "None", environmentVariables: [], dependencies: [], npmScripts: { build: "next build" }, testStrategy: ["Unit"], securityControls: ["Validation"], rejectedInfrastructure: ["Redis"], acceptance: { accepted: true, acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "user" } });
const task = (overrides: Record<string, unknown> = {}) => AgentTaskSchema.parse({ id: id(), projectId: id(), projectVersion: 1, role: "lead", taskType: "brief", title: "Brief", objective: "Collect facts", inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: [], fileScopes: [], dependencies: [], status: "ready", attempt: 0, maxAttempts: 1, createdAt: "2026-01-01T00:00:00.000Z", ...overrides });

describe("domain contracts", () => {
  it("parses a valid FactoryProject and rejects unsafe slugs", () => {
    const project = FactoryProjectSchema.parse({ ...base("factory-project"), id: id(), slug: "cafe-site", originalPrompt: "Build this\nsite", currentVersion: 1, workflowState: "DRAFT" });
    expect(project.slug).toBe("cafe-site");
    expect(() => FactoryProjectSchema.parse({ ...project, slug: "../escape" })).toThrow();
  });

  it("rejects unknown strict contract fields", () => {
    expect(() => FactoryProjectSchema.parse({ ...base("factory-project"), id: id(), slug: "safe", originalPrompt: "x", currentVersion: 1, workflowState: "DRAFT", extra: true })).toThrow();
  });

  it("requires approval and unresolved-item resolution", () => {
    const pending = requirements(false);
    expect(() => transitionWorkflow("AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION", { requirements: pending, requirementsChecksum: "a".repeat(64) })).toThrowError(DomainError);
    const blocked = RequirementSpecificationSchema.parse({ ...requirements(true), unresolvedItems: [{ id: id(), description: "Need legal fact", blocking: true }] });
    expect(() => transitionWorkflow("CLARIFYING", "AWAITING_BRIEF_APPROVAL", { requirements: blocked })).toThrowError(/Blocking/);
  });

  it("enforces requirement checksums and exactly three unique directions", () => {
    const req = requirements(true);
    expect(() => transitionWorkflow("AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION", { requirements: req, requirementsChecksum: "b".repeat(64) })).toThrowError(/checksum/i);
    const dirs = [direction(), direction(), direction()];
    const set = DesignDirectionSetSchema.parse({ ...base("design-directions"), setId: id(), directions: dirs, generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "system", readyForSelection: true });
    expect(set.directions).toHaveLength(3);
    expect(() => DesignDirectionSetSchema.parse({ ...set, directions: dirs.slice(0, 2) })).toThrow();
    expect(() => DesignDirectionSetSchema.parse({ ...set, directions: [dirs[0], dirs[0], dirs[2]] })).toThrow();
  });

  it("requires current design selection and accepted architecture", () => {
    const req = requirements(true); const dirs = [direction(), direction(), direction()]; const set = DesignDirectionSetSchema.parse({ ...base("design-directions"), setId: id(), directions: dirs, generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "system", readyForSelection: true });
    const selected = SelectedDesignSchema.parse({ ...base("selected-design"), projectId: set.projectId, projectVersion: set.projectVersion, directionSetId: id(), selectedDirectionId: dirs[0].id, selectedAt: "2026-01-01T00:00:00.000Z", selectedBy: "user", selectionNotes: "Use first", selectedDirectionChecksum: "c".repeat(64) });
    expect(() => transitionWorkflow("AWAITING_DESIGN_SELECTION", "READY_FOR_IMPLEMENTATION", { requirements: req, designSet: set, selectedDesign: selected, selectedDirectionChecksum: "c".repeat(64), architecture: architecture() })).toThrowError(/current design/i);
    const current = SelectedDesignSchema.parse({ ...selected, directionSetId: set.setId });
    expect(transitionWorkflow("AWAITING_DESIGN_SELECTION", "READY_FOR_IMPLEMENTATION", { requirements: req, designSet: set, selectedDesign: current, selectedDirectionChecksum: "c".repeat(64), architecture: architecture() })).toBe("READY_FOR_IMPLEMENTATION");
  });

  it("rejects fixed-stack violations and AI-generated logos", () => {
    expect(() => TechnicalArchitectureSchema.parse({ ...architecture(), dependencies: [{ name: "redis", purpose: "queue" }] })).toThrow();
    expect(() => AssetManifestSchema.parse({ ...base("asset-manifest"), entries: [{ id: id(), purpose: "Logo", targetPage: "/", sourceDecision: "ai-generated", subject: "Logo", styleDirection: "Simple", aspectRatio: "1:1", targetDimensions: { width: 100, height: 100 }, format: "svg", filename: "logo.svg", relativeOutputPath: "images/logo.svg", altText: "Logo", generationStatus: "planned", userApprovalRequired: true, isLogo: true }] })).toThrow();
  });

  it("rejects missing dependencies and cycles, but accepts a valid graph", () => {
    const first = task(); const second = task({ dependencies: [first.id] }); const graph = { ...base("task-graph"), tasks: [first, second] };
    expect(TaskGraphSchema.parse(graph).tasks).toHaveLength(2);
    expect(() => TaskGraphSchema.parse({ ...graph, tasks: [task({ dependencies: [id()] })] })).toThrow();
    const a = task(); const b = task({ dependencies: [a.id] }); const c = task({ dependencies: [b.id] });
    expect(() => TaskGraphSchema.parse({ ...graph, tasks: [{ ...a, dependencies: [c.id] }, b, c] })).toThrow();
  });

  it("guards implementation, release quality, known errors, and immutability", () => {
    const req = requirements(true); const arch = architecture();
    expect(() => transitionWorkflow("READY_FOR_IMPLEMENTATION", "IMPLEMENTING", { requirements: req, architecture: arch, decisions: [{ id: id(), timestamp: "2026-01-01T00:00:00.000Z", actorType: "agent", actorIdentifier: "planner", category: "requirements", decision: "Change", rationale: "Reason", affectedDocuments: ["requirements.json"], requirementChange: true, userApprovalRequired: true, userApprovalStatus: "pending" }] })).toThrowError(/unapproved/i);
    expect(() => transitionWorkflow("PROJECT_READY", "VALIDATING")).toThrowError(/immutable/i);
    const quality = QualityReportSchema.parse({ ...base("quality-report"), checks: [{ name: "lint", status: "failed", attempt: 1, required: true }], knownErrors: [] });
    const release = ReleaseReportSchema.parse({ ...base("release-report"), versionLabel: "v1", qualityReport: quality, knownErrors: [], ready: false });
    expect(() => transitionWorkflow("VALIDATING", "PROJECT_READY", { qualityReport: quality, releaseReport: release })).toThrowError(/quality/i);
    expect(() => transitionWorkflow("VALIDATING", "PROJECT_READY", { qualityReport: quality, releaseReport: { ...release, ready: true }, knownErrors: ["bug"] })).toThrowError(/known/i);
  });

  it("serializes only safe domain error data", () => {
    const serialized = serializeDomainError(new DomainError("VALIDATION_FAILED", "Safe message", { field: "slug" }, new Error("secret path")));
    expect(serialized).toEqual({ code: "VALIDATION_FAILED", message: "Safe message", details: { field: "slug" } });
    expect(serialized).not.toHaveProperty("stack");
  });
});
