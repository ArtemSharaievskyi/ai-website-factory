import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { LeadAgentService } from "@/agents/lead/service";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import type { BriefDraft } from "@/agents/lead/contracts";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { canonicalUserInstructionSchema, MAX_CANONICAL_USER_INPUT_BYTES, utf8ByteLength } from "@/domain/project/canonical-input";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { WorkbenchApplication } from "./application";
import { MAX_BRIEF_REVISION_INSTRUCTION_BYTES, WorkbenchRequestSchema } from "./contracts";
import { boundedRolePrompt, inferCanonicalDocumentType } from "@/runtime/context";

const syntheticPrompt = "Title: Synthetisches Fahrradatelier\nPurpose: Reparaturen und Beratung für lokale Kundschaft\nAudience: Pendlerinnen und Pendler\nPages: home, contact\nFunctionality: contact form and service overview\nLanguages: de\nImages: placeholders\nAcceptance: mobile site with a working contact path";
const answerFor = (key: string | undefined) => key === "languages" ? "de" : key === "pages" ? "Home, Kontakt und Leistungen" : key === "acceptance" ? "Die mobile Seite und der Kontaktpfad funktionieren." : key === "image-source" ? "placeholders" : "Synthetische Bestätigung für den Test.";
const revisionSection = [
  "Die Änderung gilt für den synthetischen Testbetrieb und muss mit den bereits bestätigten Geschäftsanforderungen zusammengeführt werden.",
  "Die vollständige Anweisung bleibt unverändert erhalten, einschließlich Absätzen, Aufzählungen und der Reihenfolge der Abschnitte.",
].join("\n");
const revision = [
  "BEGIN_BRIEF_REVISION_MARKER_481902",
  "## Kontaktformular",
  "Das Kontaktformular soll einen simulierten Erfolg erst nach lokaler Validierung zeigen und darf keine nicht beauftragte Zustellung behaupten.",
  "## Impressum und Datenschutz",
  "Ergänze getrennte Routen für /impressum und /datenschutz; rechtliche Angaben bleiben als klar gekennzeichnete Platzhalter erhalten.",
  "## Marken- und Bildstrategie",
  "Die synthetischen Kundenvorgaben für Logo und Flyer sind maßgeblich; Bildquellen und Nutzerrechte müssen nachvollziehbar bleiben.",
  "## Visuelle Anforderungen",
  "Die Gestaltung soll ruhig, hochwertig, responsiv und für mobile Nutzerinnen und Nutzer gut lesbar sein.",
  "## SEO",
  "Jede zentrale Route benötigt passende Titel, Metadaten, semantische Überschriften und eine sinnvolle interne Verlinkung.",
  "## Bestehende Anforderungen",
  "Alle bereits bestätigten Anforderungen bleiben erhalten; diese Revision ergänzt und korrigiert nur die ausdrücklich genannten Punkte.",
  ...Array.from({ length: 12 }, () => revisionSection),
  "MIDDLE_BRIEF_REVISION_MARKER_729403",
  "FINAL_BRIEF_REVISION_REQUIREMENT: KEINE BESTEHENDE ANFORDERUNG ENTFERNEN",
  "END_BRIEF_REVISION_MARKER_739184",
].join("\n");

function revisionDraft(input: Parameters<NonNullable<ConstructorParameters<typeof DeterministicLeadProvider>[3]>>[0]): BriefDraft {
  const requirements = RequirementSpecificationSchema.parse({
    ...input.currentBrief,
    technicalConstraints: [...input.currentBrief.technicalConstraints, "BEGIN_BRIEF_REVISION_MARKER_481902", "MIDDLE_BRIEF_REVISION_MARKER_729403", "FINAL_BRIEF_REVISION_REQUIREMENT: KEINE BESTEHENDE ANFORDERUNG ENTFERNEN", "END_BRIEF_REVISION_MARKER_739184"],
    seoRequirements: [...input.currentBrief.seoRequirements, "Synthetische SEO-Marker aus der vollständigen Revision"],
    briefStatus: "draft",
    approval: { approved: false },
  });
  return {
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    requirements,
    facts: [],
    recommendations: [],
    unresolvedItems: [],
    evidence: requirements.evidence,
    readyForApproval: true,
    blockingReasons: [],
    nonBlockingWarnings: [],
    briefChecksum: checksumPersistedDocument(requirements),
  };
}

type Scenario = {
  app: WorkbenchApplication;
  database: InMemoryPersistenceDatabase;
  projectId: string;
  originalBrief: Awaited<ReturnType<WorkbenchApplication["handle"]>>;
  revised: Awaited<ReturnType<WorkbenchApplication["handle"]>>;
  revisedRequirements: import("@/domain/requirements/schema").RequirementSpecification;
  providerCalls: string[];
  providerInput?: Parameters<NonNullable<ConstructorParameters<typeof DeterministicLeadProvider>[3]>>[0];
};

let scenario: Scenario;

beforeAll(async () => {
  const database = new InMemoryPersistenceDatabase();
  const memory = new FakeLeadMemoryPort();
  const providerCalls: string[] = [];
  let providerInput: Scenario["providerInput"];
  const provider = new DeterministicLeadProvider(
    (input) => { providerCalls.push("analyze"); return analyzePromptDeterministically(input); },
    (input) => { providerCalls.push("clarify"); return planClarificationsDeterministically(input); },
    (input) => { providerCalls.push("brief"); return assembleRequirements(input); },
    (input) => { providerCalls.push("revision"); providerInput = input; expect(input.revisionInstruction).toBe(revision); return revisionDraft(input); },
  );
  const entry = new (await import("@/runtime/trial-entry/service")).TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory, provider }) });
  const app = new WorkbenchApplication({ database, entry });
  const created = await app.handle({ action: "create", requestText: syntheticPrompt });
  if (!created.project) throw new Error("synthetic project was not created");
  const answers = created.questions.filter((question) => question.answerStatus === "unresolved").map((question) => ({ questionId: question.id, answer: answerFor(question.requirementKey) }));
  if (answers.length) await app.handle({ action: "respond", projectId: created.project.projectId, answers });
  const originalBrief = await app.handle({ action: "status", projectId: created.project.projectId });
  const revised = await app.handle({ action: "request-brief-changes", projectId: created.project.projectId, reason: revision, requirementKeys: ["project-brief"] });
  const revisedDocument = await (new (await import("@/persistence/database/repositories")).DocumentRepository(database)).get(created.project.projectId, 1, "requirements");
  if (!revisedDocument || revisedDocument.documentType !== "requirements") throw new Error("revised requirements were not persisted");
  scenario = { app, database, projectId: created.project.projectId, originalBrief, revised, revisedRequirements: revisedDocument, providerCalls, providerInput };
});

describe("Lossless Brief revision input contract", () => {
  it("BRI1-BRI17: accepts small, multi-section, multiline, Unicode, headings, bullets, and all markers", () => {
    const small = "Kleine synthetische Brief-Änderung.";
    expect(WorkbenchRequestSchema.safeParse({ action: "request-brief-changes", projectId: scenario.projectId, reason: small }).success).toBe(true);
    expect(utf8ByteLength(revision)).toBeGreaterThan(4000);
    expect(utf8ByteLength(revision)).toBeLessThan(MAX_BRIEF_REVISION_INSTRUCTION_BYTES);
    for (const marker of ["BEGIN_BRIEF_REVISION_MARKER_481902", "MIDDLE_BRIEF_REVISION_MARKER_729403", "FINAL_BRIEF_REVISION_REQUIREMENT: KEINE BESTEHENDE ANFORDERUNG ENTFERNEN", "END_BRIEF_REVISION_MARKER_739184", "## Kontaktformular", "## SEO"]) expect(revision).toContain(marker);
    const parsed = WorkbenchRequestSchema.parse({ action: "request-brief-changes", projectId: scenario.projectId, reason: revision });
    expect(parsed.action).toBe("request-brief-changes");
    if (parsed.action === "request-brief-changes") expect(parsed.reason).toBe(revision);
    expect(utf8ByteLength("äöüß кириллица українські символи")).toBeGreaterThan("äöüü".length);
  });

  it("BRI4-BRI7 and BRI30: accepts the exact byte boundary and rejects one byte over without truncation", () => {
    const exact = "x".repeat(MAX_CANONICAL_USER_INPUT_BYTES);
    const over = `${exact}y`;
    expect(canonicalUserInstructionSchema().safeParse(exact).success).toBe(true);
    const rejected = canonicalUserInstructionSchema().safeParse(over);
    expect(rejected.success).toBe(false);
    expect(over.endsWith("y")).toBe(true);
    expect(WorkbenchRequestSchema.safeParse({ action: "request-brief-changes", projectId: scenario.projectId, reason: over }).success).toBe(false);
  });

  it("BRI8-BRI13 and BCP5-BCP6: counts UTF-8 bytes consistently for German, Russian, and Ukrainian text", () => {
    const unicode = "äöüß кириллица українські символи\n- сохраняется\n- зберігається";
    expect(utf8ByteLength(unicode)).toBe(Buffer.byteLength(unicode, "utf8"));
    expect(canonicalUserInstructionSchema().safeParse(unicode).success).toBe(true);
    const parsed = WorkbenchRequestSchema.parse({ action: "request-brief-changes", projectId: scenario.projectId, reason: unicode });
    if (parsed.action === "request-brief-changes") expect(parsed.reason).toBe(unicode);
  });

  it("BRI18-BRI30 and BCP1-BCP14: route, application, Lead, canonical context, and checksum use the full revision", () => {
    expect(scenario.revised.project?.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
    expect(scenario.providerInput?.revisionInstruction).toBe(revision);
    expect(scenario.providerInput?.currentBrief.businessGoals).toEqual(scenario.originalBrief.brief ? expect.arrayContaining(scenario.originalBrief.brief.businessGoals) : expect.anything());
    expect(scenario.providerCalls.filter((call) => call === "revision")).toHaveLength(1);
    expect(scenario.revised.brief?.approved).toBe(false);
    expect(scenario.revised.brief?.checksum).not.toBe(scenario.originalBrief.brief?.checksum);
    expect(checksumPersistedDocument(revision)).toBe(checksumPersistedDocument(revision));
    expect(inferCanonicalDocumentType("lead", { briefRevision: revision, currentBrief: scenario.providerInput?.currentBrief })).toBe("BriefRevisionInstruction");
    const prompt = boundedRolePrompt("lead", { projectId: scenario.projectId, projectVersion: 1, originalPrompt: syntheticPrompt, currentBrief: scenario.providerInput?.currentBrief, currentCanonicalRequirements: scenario.providerInput?.currentCanonicalRequirements, revisionInstruction: revision, briefRevision: revision });
    expect(prompt.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(prompt.user).toContain("FINAL_BRIEF_REVISION_REQUIREMENT: KEINE BESTEHENDE ANFORDERUNG ENTFERNEN");
    expect(prompt.user).toContain("END_BRIEF_REVISION_MARKER_739184");
    expect(JSON.stringify(prompt.contextBundle.metrics)).not.toContain("BEGIN_BRIEF_REVISION_MARKER_481902");
  });

  it("BRI31-BRI36 and BRE1-BRE16: produces a reviewable revised candidate while preserving existing requirements and not starting downstream agents", () => {
    expect(scenario.originalBrief.project?.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
    expect(scenario.revised.project?.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
    expect(scenario.revised.brief?.approved).toBe(false);
    expect(scenario.database.events.some((event) => ["IMPLEMENTING", "ARCHITECTURE_REVIEW", "READY_FOR_IMPLEMENTATION"].includes(event.toState))).toBe(false);
    expect(scenario.revisedRequirements.technicalConstraints).toEqual(expect.arrayContaining(["BEGIN_BRIEF_REVISION_MARKER_481902", "MIDDLE_BRIEF_REVISION_MARKER_729403", "FINAL_BRIEF_REVISION_REQUIREMENT: KEINE BESTEHENDE ANFORDERUNG ENTFERNEN", "END_BRIEF_REVISION_MARKER_739184"]));
    expect(scenario.revisedRequirements.businessGoals).toEqual(expect.arrayContaining(scenario.originalBrief.brief?.businessGoals ?? []));
    expect(scenario.revisedRequirements.pages.map((page) => page.slug)).toEqual(expect.arrayContaining(["home", "contact"]));
    expect(scenario.revisedRequirements.seoRequirements).toContain("Synthetische SEO-Marker aus der vollständigen Revision");
    expect(scenario.revised.status.allowedActions).toEqual(["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"]);
    expect(scenario.revised.brief?.briefSchemaVersion).toBe(2);
    expect(scenario.revised.brief?.brandVisual?.length).toBeGreaterThan(0);
    expect(scenario.revised.brief?.seo).toBeDefined();
    expect(scenario.revised.brief?.technicalDeferred?.length).toBeGreaterThan(0);
  });

  it("BCP15-BCP24: retains capacity guards, currentness/idempotency boundaries, and avoids dependency or schema changes", async () => {
    const source = await readFile(path.resolve("src/runtime/workbench/contracts.ts"), "utf8");
    const lead = await readFile(path.resolve("src/agents/lead/service.ts"), "utf8");
    expect(source).toContain("MAX_BRIEF_REVISION_INSTRUCTION_BYTES");
    expect(source).not.toMatch(/request-brief-changes.*reason: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(4000\)/);
    expect(lead).not.toMatch(/reason\.(?:slice|substring)\(/);
    expect(lead).toContain("expectedBriefChecksum");
    expect(lead).toContain("reviseBrief");
    expect((await import("@/runtime/trial-entry/idempotency")).briefRevisionOperationKey({ projectId: scenario.projectId, projectVersion: 1, briefChecksum: scenario.originalBrief.brief?.checksum ?? "a".repeat(64), reason: revision, requirementKeys: ["project-brief"] }).key).not.toContain(revision);
    expect(await readFile(path.resolve("package.json"), "utf8")).not.toContain("brief-revision");
  });
});
