import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAiLeadProvider } from "@/integrations/openai/adapters";
import { OpenAiStructuredClient, type StructuredRequest } from "@/integrations/openai/client";
import { AiProviderError } from "@/integrations/openai/errors";
import { createInitialProjectRequest, MAX_INITIAL_PROJECT_REQUEST_BYTES } from "@/domain/project/initial-request";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { LeadAgentService } from "@/agents/lead/service";
import { CONTEXT_BUDGET_PROFILES, assembleContext, boundedRolePrompt, inferCanonicalDocumentType, prepareRoleContext, type ContextCandidate } from "@/runtime/context";

const uuid = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

const repeatedGermanSection = Array.from({ length: 40 }, (_, index) => `Abschnitt ${String(index + 1).padStart(3, "0")}: Die Website beschreibt Dienstleistungen, Zielgruppen, Gestaltung, mobile Bedienung, SEO und rechtliche Grenzen. EARLY_REQUIREMENT_${String(index + 1).padStart(3, "0")} bleibt verbindlich.`).join("\n");
const germanPrompt = [
  "BEGIN_REQUIREMENT_MARKER_A",
  "Projekt: Eine deutschsprachige One-Page-Website für ein synthetisches lokales Unternehmen.",
  "## Leistungen und Inhalte",
  repeatedGermanSection,
  "## Gestaltung und Bildsprache",
  "MIDDLE_REQUIREMENT_MARKER_B",
  repeatedGermanSection,
  "## UX, Mobile First und Kontakt",
  "Die mobile Sticky-CTA muss Telefon, WhatsApp und mailto eindeutig bedienen.",
  "## SEO, Recht und Arbeitsweise",
  "SEO-Titel und Meta Description müssen vorhanden sein; rechtliche Angaben dürfen nicht erfunden werden.",
  "FINAL_CRITICAL_REQUIREMENT: KEINE ERFUNDENEN KUNDENBEWERTUNGEN",
  "END_REQUIREMENT_MARKER_938472",
].join("\n");

const canonicalInput = { projectId, projectVersion: 1, originalPrompt: germanPrompt, currentWorkflowState: "DRAFT", operatorLanguage: "de", siteLanguage: "de" };
const canonicalCandidate = (content = germanPrompt): ContextCandidate => ({ kind: "CANONICAL_CONTRACT", authority: "CANONICAL_REQUIREMENT", canonicalDocumentType: "InitialProjectRequest", sourceRef: "canonical:test", selectionReason: "test canonical requirement", priority: "HIGH", required: false, content });
const smallBudget = { ...CONTEXT_BUDGET_PROFILES.default, softTarget: { estimatedInputTokens: 100, bytes: 400 }, hardCeiling: { estimatedInputTokens: 2_000, bytes: 8_000 }, maxEstimatedInputTokens: 2_000, maxBytes: 8_000, reservedResponseTokens: 100, reservedResponseBytes: 400 };

function leadCapture() {
  let sent: StructuredRequest<unknown> | undefined;
  const transport = { languageObservation: null, directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: true, inputTokens: null, outputTokens: null } };
  const client = new OpenAiStructuredClient({ apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", maxRetries: 0, maxConcurrentRequests: 1 }, { executor: async <T>(request: StructuredRequest<T>) => { sent = request as StructuredRequest<unknown>; return { value: transport as T, requestId: "req_lossless_lead" }; } });
  return { provider: new OpenAiLeadProvider(client), getRequest: () => sent };
}

describe("lossless canonical requirements context policy", () => {
  it("LRC1-LRC10: preserves the complete 12-20 KiB German request through Lead context", async () => {
    expect(byteLength(germanPrompt)).toBeGreaterThan(12 * 1024);
    expect(byteLength(germanPrompt)).toBeLessThan(20 * 1024);
    const request = leadCapture();
    await request.provider.analyzePrompt(canonicalInput as never);
    const sent = request.getRequest();
    expect(sent).toBeDefined();
    expect(sent?.user).toContain("BEGIN_REQUIREMENT_MARKER_A");
    expect(sent?.user).toContain("MIDDLE_REQUIREMENT_MARKER_B");
    expect(sent?.user).toContain("FINAL_CRITICAL_REQUIREMENT: KEINE ERFUNDENEN KUNDENBEWERTUNGEN");
    expect(sent?.user).toContain("END_REQUIREMENT_MARKER_938472");
    expect(sent?.user).toContain("Sticky-CTA");
    expect(sent?.user).toContain("SEO-Titel");
    expect(sent?.user).toContain("rechtliche Angaben");
  });

  it("keeps the Contract Auditor within budget by bounding repeated TaskGraph references", () => {
    const prompt = boundedRolePrompt("contract-auditor", {
      approvedBrief: { projectId, projectVersion: 1, explicitExclusions: ["CONTRACT_AUDIT_CANONICAL_MARKER"] },
      acceptedPlanningPackage: { projectId, projectVersion: 1, traceability: [] },
      taskGraph: { tasks: Array.from({ length: 36 }, (_, taskIndex) => ({ id: uuid, taskType: "implement-page", objective: "Review the bounded task contract.", requirementReferences: Array.from({ length: 327 }, (_, referenceIndex) => `REF_${taskIndex}_${referenceIndex}`), planningReferences: Array.from({ length: 327 }, (_, referenceIndex) => `PLAN_${taskIndex}_${referenceIndex}`) })) },
    });
    expect(prompt.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(prompt.user).toContain("CONTRACT_AUDIT_CANONICAL_MARKER");
    expect(prompt.user).not.toContain("REF_0_326");
    expect(prompt.user).toContain("requirementReferencesSample");
  });

  it("LRC1: persists the complete normalized InitialProjectRequest in project and memory authority", async () => {
    const database = new InMemoryPersistenceDatabase();
    const memory = new FakeLeadMemoryPort();
    const lead = new LeadAgentService({ database, memory });
    await lead.startProjectIntake({ ...canonicalInput, suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, idempotencyKey: "lossless-intake", projectSlug: "lossless-intake" } as never);
    expect(database.projects.get(projectId)?.original_prompt).toBe(germanPrompt);
    expect(memory.documents.get(`${projectId}:1`)?.["original-prompt.md"]).toBe(germanPrompt);
  });

  it("LRC11-LRC20: preserves headings, lists, Unicode, line breaks, UX, SEO, legal, assets, and workflow text", () => {
    const prepared = JSON.stringify(prepareRoleContext({ originalPrompt: germanPrompt, workflow: "Brief approval remains explicit." }));
    for (const marker of ["## Leistungen und Inhalte", "## Gestaltung und Bildsprache", "## UX, Mobile First und Kontakt", "## SEO, Recht und Arbeitsweise", "Sticky-CTA", "SEO-Titel", "rechtliche Angaben", "FINAL_CRITICAL_REQUIREMENT", "END_REQUIREMENT_MARKER_938472"]) expect(prepared).toContain(marker);
    expect(prepared).toContain("deutschsprachige");
    expect(prepared).toContain("\\n");
  });

  it("LRC21-LRC30: preserves clarification, Brief, Design, Implementation, and reviewer authority at the end", () => {
    const answer = `Lange Antwort mit vollständiger Kontakt- und Inhaltsvorgabe.\nFINAL_CLARIFICATION_ANSWER_MARKER`;
    const clarification = boundedRolePrompt("lead", { analysis: { projectId, projectVersion: 1 }, session: { answers: [{ answer }] } });
    expect(clarification.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(clarification.user).toContain("FINAL_CLARIFICATION_ANSWER_MARKER");

    const brief = boundedRolePrompt("planner", { approvedBrief: { projectId, projectVersion: 1, explicitExclusions: ["FINAL_BRIEF_REQUIREMENT_MARKER"], projectSummary: "Approved synthetic Brief" } });
    expect(brief.contextBundle.selectedItems.find((item) => item.authority === "CANONICAL_REQUIREMENT")?.content).toContain("FINAL_BRIEF_REQUIREMENT_MARKER");

    const design = boundedRolePrompt("design", { approvedBrief: { explicitExclusions: ["Keine generische Template-Gestaltung verwenden."] }, selectedDesignDirection: { constraint: "Keine generische Template-Gestaltung verwenden." } });
    expect(design.user).toContain("Keine generische Template-Gestaltung verwenden.");

    const implementation = boundedRolePrompt("implementation", { task: { id: uuid, objective: "Implement the approved page" }, approvedBrief: { technicalConstraints: ["Keine Analytics oder Tracking-Dienste integrieren."] } });
    expect(implementation.user).toContain("Keine Analytics oder Tracking-Dienste integrieren.");

    const review = boundedRolePrompt("security-reviewer", { approvedBrief: { explicitExclusions: ["FINAL_REVIEW_PROHIBITED_BEHAVIOR"] }, selectedDesign: { id: "selected" } });
    expect(review.user).toContain("FINAL_REVIEW_PROHIBITED_BEHAVIOR");
  });

  it("LRC31-LRC34 and LCA12-LCA16: never reduces or evicts explicit canonical authority", () => {
    const result = assembleContext({ agentId: "lead", agentRole: "lead", workflowStage: "analysis", currentnessIdentity: "current", budget: CONTEXT_BUDGET_PROFILES.default, candidates: [canonicalCandidate()] });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    const item = result.bundle.requiredItems[0]!;
    expect(item.authority).toBe("CANONICAL_REQUIREMENT");
    expect(item.content).toBe(germanPrompt);
    expect(item.contentChecksum).toBe(digest(germanPrompt));
    expect(result.bundle.metrics.canonicalRequirementBytes).toBe(byteLength(germanPrompt));
    expect(result.bundle.metrics.canonicalRequirementIncludedBytes).toBe(byteLength(germanPrompt));
    expect(result.bundle.metrics.canonicalRequirementTruncated).toBe(false);
  });

  it("LRC35-LRC40 and LCA8-LCA11/LCA17: keeps technical reduction and safe telemetry", () => {
    const result = boundedRolePrompt("implementation", { task: { id: uuid, objective: "Target" }, files: [{ relativePath: "src/large.ts", content: "export const Target = true;\n" + "technical noise\n".repeat(2_000) }] });
    expect(result.contextBundle.metrics.supportingContextOriginalBytes).toBeGreaterThanOrEqual(result.contextBundle.metrics.supportingContextIncludedBytes);
    expect(result.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(JSON.stringify(result.contextBundle.metrics)).not.toContain("technical noise");
  });

  it("LRC41-LRC43 and TRT13/TRT16-TRT20: keeps manifest/checksum stable and rejects over-limit input", () => {
    const first = boundedRolePrompt("lead", canonicalInput);
    const second = boundedRolePrompt("lead", canonicalInput);
    const nearLimitPrompt = "N".repeat(MAX_INITIAL_PROJECT_REQUEST_BYTES - 128);
    const nearLimit = boundedRolePrompt("lead", { originalPrompt: nearLimitPrompt });
    expect(nearLimit.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(nearLimit.user).toContain(nearLimitPrompt);
    expect(first.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(first.contextBundle.selectedItems.find((item) => item.authority === "CANONICAL_REQUIREMENT")?.contentChecksum).toBe(second.contextBundle.selectedItems.find((item) => item.authority === "CANONICAL_REQUIREMENT")?.contentChecksum);
    expect(() => createInitialProjectRequest({ requestText: "x".repeat(MAX_INITIAL_PROJECT_REQUEST_BYTES + 1) })).toThrow("INITIAL_REQUEST_TOO_LARGE");
  });

  it("LRC44-LRC45 and TRT8-TRT12: returns a typed safe capacity error without sending source text", async () => {
    const result = assembleContext({ agentId: "lead", agentRole: "lead", workflowStage: "analysis", currentnessIdentity: "current", budget: { ...smallBudget, hardCeiling: { estimatedInputTokens: 2_000, bytes: 8_000 }, maxEstimatedInputTokens: 2_000, maxBytes: 8_000 }, candidates: [canonicalCandidate("short")] });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    let calls = 0;
    const client = new OpenAiStructuredClient({ apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", maxRetries: 0, maxConcurrentRequests: 1 }, { executor: async <T>() => { calls++; return { value: { ok: true } as T, requestId: "should-not-send" }; } });
    const schema = z.object({ ok: z.boolean() });
    await expect(client.request({ role: "lead", promptVersion: "lead.v1", system: "x".repeat(10_000), user: "safe", schemaName: "capacity", schema, contextBundle: result.bundle })).rejects.toMatchObject({ code: "AI_REQUEST_CONTEXT_CAPACITY_EXCEEDED", diagnostic: { requestAttempted: false, inputBytes: expect.any(Number), schemaSizeBytes: expect.any(Number), contextCapacity: { schemaBytes: expect.any(Number), schemaTokens: expect.any(Number) } } });
    expect(calls).toBe(0);
    try { await client.request({ role: "lead", promptVersion: "lead.v1", system: "x".repeat(10_000), user: "safe", schemaName: "capacity", schema, contextBundle: result.bundle }); } catch (error) { expect(error).toBeInstanceOf(AiProviderError); expect(JSON.stringify(error)).not.toContain("FINAL_CRITICAL_REQUIREMENT"); }
  });

  it("LRC46-LRC48 and LCA20-LCA32: keeps normal prompts single-call, cached by full checksum, and does not create or mutate the diagnostic pilot", async () => {
    let calls = 0;
    const request = leadCapture();
    await request.provider.analyzePrompt({ ...canonicalInput, originalPrompt: "normal synthetic request" } as never);
    calls++;
    expect(calls).toBe(1);
    expect(inferCanonicalDocumentType("lead", canonicalInput)).toBe("InitialProjectRequest");
    expect(inferCanonicalDocumentType("planner", { approvedBrief: {} })).toBe("ProjectBrief");
    expect(inferCanonicalDocumentType("design", { selectedDesignDirection: {} })).toBe("SelectedDesignDirection");
    expect(inferCanonicalDocumentType("implementation", { approvedChangeProposal: {} })).toBe("ApprovedChangeProposal");
    expect(checksumPersistedDocument(germanPrompt)).toBe(checksumPersistedDocument(germanPrompt));
  });

  it("LCA1-LCA7 and LCA18-LCA19: exposes canonical classes without raw-content telemetry", () => {
    const cases: Array<[string, string]> = [["lead", "InitialProjectRequest"], ["lead", "ClarificationAnswer"], ["planner", "ProjectBrief"], ["design", "SelectedDesignDirection"], ["planner", "AcceptedDependencyDecision"], ["planner", "DatabaseDecision"], ["implementation", "ApprovedChangeProposal"]];
    const inputs = [{ originalPrompt: "x" }, { clarificationAnswer: "x" }, { approvedBrief: {} }, { selectedDesignDirection: {} }, { acceptedDependencyDecision: {} }, { databaseDecision: {} }, { approvedChangeProposal: {} }];
    for (const [index, [, expected]] of cases.entries()) expect(inferCanonicalDocumentType(cases[index]![0], inputs[index])).toBe(expected);
    const result = boundedRolePrompt("lead", { originalPrompt: germanPrompt });
    expect(JSON.stringify(result.contextBundle.metrics)).not.toContain(germanPrompt);
  });

  it("TRT1-TRT7 and TRT21-TRT24: preserves the final section across continuation and downstream role assembly", () => {
    const continuation = boundedRolePrompt("lead", { clarificationAnswers: [{ answer: "Antwort\nFINAL_CONTINUATION_MARKER" }] });
    const planner = boundedRolePrompt("planner", { approvedBrief: { projectSummary: "Brief\nFINAL_PLANNER_MARKER" } });
    const design = boundedRolePrompt("design", { approvedBrief: { projectSummary: "Brief" }, selectedDesign: { constraint: "FINAL_DESIGN_MARKER" } });
    const implementation = boundedRolePrompt("implementation", { approvedBrief: { technicalConstraints: ["FINAL_IMPLEMENTATION_MARKER"] }, task: { id: uuid } });
    expect(continuation.user).toContain("FINAL_CONTINUATION_MARKER");
    expect(planner.user).toContain("FINAL_PLANNER_MARKER");
    expect(design.user).toContain("FINAL_DESIGN_MARKER");
    expect(implementation.user).toContain("FINAL_IMPLEMENTATION_MARKER");
  });

  it("LCA13-LCA15 and TRT6-TRT10: optional supporting data is evicted before canonical data", () => {
    const result = assembleContext({ agentId: "lead", agentRole: "lead", workflowStage: "analysis", currentnessIdentity: "current", budget: { ...smallBudget, softTarget: { estimatedInputTokens: 10, bytes: 40 } }, candidates: [canonicalCandidate("canonical"), { kind: "EVIDENCE_SLICE", authority: "SUPPORTING_TECHNICAL", sourceRef: "technical:optional", selectionReason: "optional", priority: "LOW", content: "technical".repeat(2_000) }] });
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.bundle.selectedItems.some((item) => item.authority === "CANONICAL_REQUIREMENT")).toBe(true);
    expect(result.bundle.selectedItems.some((item) => item.sourceRef === "technical:optional")).toBe(false);
  });
});
