import { describe, expect, it } from "vitest";
import { canonicalUserInstructionSchema, MAX_CANONICAL_USER_INPUT_BYTES, utf8ByteLength } from "@/domain/project/canonical-input";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import type { BriefV3ProviderInput } from "@/runtime/brief-revision-v3/ports";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { WorkbenchApplication } from "./application";
import { MAX_BRIEF_REVISION_INSTRUCTION_BYTES, WorkbenchRequestSchema } from "./contracts";
import { TrialEntryService } from "@/runtime/trial-entry/service";

const syntheticPrompt = "Title: Synthetic bicycle atelier\nPurpose: Repairs and advice for local customers\nAudience: Commuters\nPages: home, contact\nFunctionality: service overview\nForms: contact form with simulated success and no transmission\nLanguages: de\nImages: placeholders\nAcceptance: mobile site with a working contact path";
const revision = [
  "BEGIN_BRIEF_REVISION_MARKER_481902",
  "## Contact form",
  "The synthetic form should show simulated success after local validation and must not claim unrequested delivery.",
  "## Legal routes",
  "Add separate synthetic placeholder routes for legal information while preserving all confirmed requirements.",
  "## Existing requirements",
  "All already confirmed requirements remain intact; this revision only adds and corrects the explicitly named points.",
  ...Array.from({ length: 40 }, () => "The complete instruction remains lossless, including paragraphs, bullets, and section order."),
  "MIDDLE_BRIEF_REVISION_MARKER_729403",
  "FINAL_BRIEF_REVISION_REQUIREMENT: KEEP_ALL_CONFIRMED_REQUIREMENTS",
  "END_BRIEF_REVISION_MARKER_739184",
].join("\n");

describe("Lossless Brief V3 revision input contract", () => {
  it("accepts multiline Unicode revisions and preserves the complete byte-bounded instruction", () => {
    const unicode = "äöüß кириллица українські символи\n- сохраняется\n- зберігається";
    expect(utf8ByteLength(unicode)).toBe(Buffer.byteLength(unicode, "utf8"));
    expect(canonicalUserInstructionSchema().safeParse(unicode).success).toBe(true);
    expect(utf8ByteLength(revision)).toBeGreaterThan(4000);
    expect(utf8ByteLength(revision)).toBeLessThan(MAX_BRIEF_REVISION_INSTRUCTION_BYTES);
    for (const marker of ["BEGIN_BRIEF_REVISION_MARKER_481902", "MIDDLE_BRIEF_REVISION_MARKER_729403", "FINAL_BRIEF_REVISION_REQUIREMENT: KEEP_ALL_CONFIRMED_REQUIREMENTS", "END_BRIEF_REVISION_MARKER_739184", "## Contact form"]) expect(revision).toContain(marker);
    const parsed = WorkbenchRequestSchema.parse({ action: "request-brief-changes", projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, briefChecksum: "a".repeat(64), expectedRowVersion: 1, reason: revision });
    expect(parsed.action).toBe("request-brief-changes");
    if (parsed.action === "request-brief-changes") expect(parsed.reason).toBe(revision);
  });

  it("rejects one byte over the canonical limit without truncation", () => {
    const exact = "x".repeat(MAX_CANONICAL_USER_INPUT_BYTES);
    const over = `${exact}y`;
    expect(canonicalUserInstructionSchema().safeParse(exact).success).toBe(true);
    expect(canonicalUserInstructionSchema().safeParse(over).success).toBe(false);
    expect(over.endsWith("y")).toBe(true);
    expect(WorkbenchRequestSchema.safeParse({ action: "request-brief-changes", projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, briefChecksum: "a".repeat(64), expectedRowVersion: 1, reason: over }).success).toBe(false);
  });

  it("passes the full instruction through the Workbench application into the V3 provider and keeps legacy V2 persistence unchanged", async () => {
    const database = new InMemoryPersistenceDatabase();
    const projectId = "18181818-1818-4181-8181-181818181818";
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z", id: projectId, slug: "lossless-v3", originalPrompt: syntheticPrompt, currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "19191919-1919-4191-8191-191919191919", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: project.createdAt, updatedAt: project.updatedAt, rowVersion: 1 });
    await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: project.createdAt, updatedAt: project.updatedAt }));
    let providerInput: BriefV3ProviderInput | undefined;
    const v3Provider = { proposeChanges: async (input: BriefV3ProviderInput) => { providerInput = input; return { contractVersion: 1 as const, changes: [{ operation: "SET" as const, target: "SEO_TITLE" as const, value: "Synthetic lossless revision" }], unresolved: [] }; } };
    const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEGACY_LEAD_REVISION_REACHED"); }, createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider: v3Provider }) });
    const app = new WorkbenchApplication({ database, entry });
    const original = await app.handle({ action: "status", projectId });
    if (!original.project || !original.brief) throw new Error("synthetic Brief was not ready");
    const revised = await app.handle({ action: "request-brief-changes", projectId, projectVersion: original.project.projectVersion, briefChecksum: original.brief.checksum, expectedRowVersion: original.project.rowVersion, reason: revision, requirementKeys: ["project-brief"] });
    expect(providerInput?.revisionInstruction).toBe(revision);
    expect(providerInput?.currentCanonicalV3.requirements.length).toBeGreaterThan(0);
    expect(revised.project?.workflowState).toBe("CLARIFYING");
    expect(revised.brief?.briefSchemaVersion).toBe(3);
    expect(await new DocumentRepository(database).get(projectId, 1, "brief-v3")).toMatchObject({ documentType: "brief-v3", briefChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
});
