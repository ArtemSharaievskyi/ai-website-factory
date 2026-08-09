import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { QualityReportSchema } from "@/domain/quality/schema";
import { ReleaseReportSchema } from "@/domain/release/schema";
import { PersistenceError, serializePersistenceError } from "./errors";
import { InMemoryPersistenceDatabase } from "./fake";
import { mapDocumentToRow, mapRowToDocument } from "./mapping";
import { DecisionRepository, DocumentRepository, ProjectRepository, ProjectVersionRepository, ReleaseRepository, WorkflowPersistenceService } from "./repositories";
import { FakeProjectMemorySyncPort } from "./sync";

const id = () => randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
const base = (documentType: string, projectId: ReturnType<typeof id> = id()) => ({ schemaVersion: 1 as const, documentType, projectId, projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const project = (state: "DRAFT" | "VALIDATING" = "DRAFT") => FactoryProjectSchema.parse({ ...base("factory-project"), id: id(), slug: "persistence-project", originalPrompt: "Build a site", currentVersion: 1, workflowState: state, ...(state === "VALIDATING" ? { implementationStartedAt: "2026-01-01T00:00:00.000Z" } : {}) });
const version = (projectId: string, state: "DRAFT" | "VALIDATING" = "DRAFT") => ({ id: id(), projectId, versionNumber: 1, state, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", rowVersion: 1 });
const requirements = (projectId: ReturnType<typeof id>) => RequirementSpecificationSchema.parse({ ...base("requirements", projectId), projectSummary: "A site", protectedFunctionalityRequired: false, imagesRequired: false, businessGoals: [], targetAudiences: [], pages: [], userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [], localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: [], unresolvedItems: [], approval: { approved: false } });

describe("persistence foundation", () => {
  it("maps validated documents and rejects malformed or tampered rows", () => {
    const document = requirements(id()); const row = mapDocumentToRow(document); expect(mapRowToDocument(row)).toEqual(document);
    expect(() => mapRowToDocument({ ...row, checksum: "0".repeat(64) })).toThrowError(PersistenceError);
    expect(() => mapDocumentToRow({ ...document, unexpected: true } as never)).toThrowError(PersistenceError);
  });

  it("supports project idempotency and rejects changed retries", async () => {
    const db = new InMemoryPersistenceDatabase(); const repo = new ProjectRepository(db); const value = project();
    const first = await repo.create(value, "create-1"); const second = await repo.create(value, "create-1"); expect(second.id).toBe(first.id);
    await expect(repo.create({ ...value, slug: "different" }, "create-1")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces optimistic concurrency and appends a transition event", async () => {
    const db = new InMemoryPersistenceDatabase(); const value = project(); await new ProjectRepository(db).create(value); await new ProjectVersionRepository(db).create(version(value.id)); const service = new WorkflowPersistenceService(db);
    const result = await service.transition({ projectId: value.id, projectVersion: 1, expectedState: "DRAFT", expectedRowVersion: 1, targetState: "CLARIFYING", actor: "user", reason: "Begin clarification" });
    expect(result.project.workflowState).toBe("CLARIFYING"); expect(db.events).toHaveLength(1);
    await expect(service.transition({ projectId: value.id, projectVersion: 1, expectedState: "DRAFT", expectedRowVersion: 1, targetState: "CLARIFYING", actor: "user", reason: "stale" })).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
  });

  it("enforces released-version immutability and append-only decisions", async () => {
    const db = new InMemoryPersistenceDatabase(); const value = project(); await new ProjectRepository(db).create(value); await new ProjectVersionRepository(db).create({ ...version(value.id), immutable: true, state: "PROJECT_READY", releasedAt: "2026-01-02T00:00:00.000Z" });
    const documentRepo = new DocumentRepository(db); await expect(documentRepo.save(requirements(value.id as ReturnType<typeof id>))).rejects.toMatchObject({ code: "PERSISTENCE_IMMUTABLE" });
    const decisions = new DecisionRepository(db); expect("update" in decisions).toBe(false); expect("delete" in decisions).toBe(false);
  });

  it("compares database and filesystem checksums through the sync port", async () => {
    const sync = new FakeProjectMemorySyncPort(); const document = requirements(id()); await sync.writeVersionSnapshot(document.projectId, 1, { "requirements.json": document }); expect(await sync.verifyVersionSnapshot(document.projectId, 1)).toBe(true);
    const same = await sync.compareDatabaseAndFilesystemChecksums({ requirements: "abc" }, { requirements: "abc" }); const different = await sync.compareDatabaseAndFilesystemChecksums({ requirements: "abc" }, { requirements: "def" }); expect(same.matches).toBe(true); expect(different).toEqual({ matches: false, mismatches: ["requirements"] });
  });

  it("uses existing quality and workflow guards before making a release immutable", async () => {
    const db = new InMemoryPersistenceDatabase(); const value = project("VALIDATING"); await new ProjectRepository(db).create(value); await new ProjectVersionRepository(db).create(version(value.id, "VALIDATING"));
    const quality = QualityReportSchema.parse({ ...base("quality-report", value.id as ReturnType<typeof id>), checks: [{ name: "unit-tests", status: "passed", attempt: 1, required: true }], knownErrors: [] });
    const release = ReleaseReportSchema.parse({ ...base("release-report", value.id as ReturnType<typeof id>), versionLabel: "v1", qualityReport: quality, knownErrors: [], ready: true, releasedAt: "2026-01-02T00:00:00.000Z", releasedBy: "user" });
    const saved = await new ReleaseRepository(db).create(value.id, 1, release); expect(saved.ready).toBe(true); expect((await new ProjectVersionRepository(db).get(value.id, 1))?.immutable).toBe(true);
    await expect(new ReleaseRepository(db).create(value.id, 1, release)).rejects.toMatchObject({ code: "PERSISTENCE_IMMUTABLE" });
  });

  it("serializes persistence errors without provider details", () => { const safe = serializePersistenceError(new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "safe", undefined, new Error("secret connection"))); expect(safe).not.toHaveProperty("cause"); expect(safe).not.toHaveProperty("stack"); });
});
