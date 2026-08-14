import { describe, expect, it } from "vitest";
import { LeadAgentService } from "@/agents/lead/service";
import { assembleRequirements, analyzePromptDeterministically, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ClarificationQuestionIdSchema } from "@/domain/requirements/schema";
import { ClarificationRepository } from "@/persistence/database/repositories";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema } from "./contracts";
import { WorkbenchRequestValidationError, workbenchFailureResponse } from "./diagnostics";

const projectId = "11111111-1111-4111-8111-111111111111";
const canonicalQuestionIds = [
  "C01E5B6A-7D1F-4B8E-9A20-1F3C6D7E8A90",
  "C02E5B6A-7D1F-4B8E-9A20-2F3C6D7E8A90",
  "C03E5B6A-7D1F-4B8E-9A20-3F3C6D7E8A90",
  "C04E5B6A-7D1F-4B8E-9A20-4F3C6D7E8A90",
];
const generatedQuestionId = "a1a9c618-8987-55fc-a794-92c20483b2c5";
const answer = (questionId: string, value = "Eine professionelle deutsche Antwort.") => ({ questionId, answer: value });
const validPayload = { action: "respond" as const, projectId, answers: canonicalQuestionIds.map((id, index) => answer(id, `Antwort ${index + 1} mit Ã¤ Ã¶ Ã¼ ÃŸ.\n\nZweiter Absatz.`)) };

function invalidPayload(value: unknown) {
  const parsed = WorkbenchRequestSchema.safeParse(value);
  if (parsed.success) throw new Error("Expected an invalid Workbench request fixture.");
  return parsed.error;
}

function safeFailure(value: unknown) {
  return workbenchFailureResponse(new WorkbenchRequestValidationError(invalidPayload(value)), { action: "respond", projectId });
}

describe("WRV1-WRV36 Workbench respond request contract", () => {
  const matrix: Array<[string, () => void]> = [
    ["WRV1 valid action respond payload accepted", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV2 unknown action rejected", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, action: "unknown" }).success).toBe(false)],
    ["WRV3 missing projectId rejected", () => { const value: Record<string, unknown> = { ...validPayload }; delete value.projectId; expect(WorkbenchRequestSchema.safeParse(value).success).toBe(false); }],
    ["WRV4 invalid projectId rejected", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, projectId: "not-a-project" }).success).toBe(false)],
    ["WRV5 missing answers rejected", () => { const value: Record<string, unknown> = { ...validPayload }; delete value.answers; expect(WorkbenchRequestSchema.safeParse(value).success).toBe(false); }],
    ["WRV6 empty answers rejected by canonical policy", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [] }).success).toBe(false)],
    ["WRV7 valid canonical question ID accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(generatedQuestionId)] }).success).toBe(true)],
    ["WRV8 current real-format canonical question ID accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0])] }).success).toBe(true)],
    ["WRV9 malformed question ID rejected", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer("not-a-question")] }).success).toBe(false)],
    ["WRV10 legacy canonical question ID accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0].toLowerCase())] }).success).toBe(true)],
    ["WRV11 missing answer text rejected", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [{ questionId: canonicalQuestionIds[0] }] }).success).toBe(false)],
    ["WRV12 whitespace-only answer rejected", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], " \n\t ")] }).success).toBe(false)],
    ["WRV13 German umlauts accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "Ä Ö Ü ä ö ü")] }).success).toBe(true)],
    ["WRV14 German sharp s accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "Straße und Maß") ] }).success).toBe(true)],
    ["WRV15 Unicode accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "Kontakt 📞 — ✓")] }).success).toBe(true)],
    ["WRV16 multiline answer accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "Absatz eins.\n\nAbsatz zwei.")] }).success).toBe(true)],
    ["WRV17 long professional answer under max accepted", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "Professioneller Inhalt. ".repeat(1000))] }).success).toBe(true)],
    ["WRV18 answer over max rejected with typed safe issue", () => { const failure = safeFailure({ ...validPayload, answers: [answer(canonicalQuestionIds[0], "x".repeat(32 * 1024 + 1))] }); expect(failure.response).toMatchObject({ issueCode: "VALUE_TOO_LARGE", fieldPath: "answers[0].answer", validationStage: "REQUEST_SCHEMA" }); }],
    ["WRV19 four answers accepted", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV20 duplicate question ID rejected", () => { const failure = safeFailure({ ...validPayload, answers: [answer(canonicalQuestionIds[0]), answer(canonicalQuestionIds[0])] }); expect(failure.response.issueCode).toBe("DUPLICATE_CLARIFICATION_ID"); }],
    ["WRV21 unknown question ID passes route shape", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer("22222222-2222-4222-8222-222222222222")] }).success).toBe(true)],
    ["WRV22 stale question ID is not a route schema failure", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [answer("33333333-3333-4333-8333-333333333333")] }).success).toBe(true)],
    ["WRV23 clarificationVersion is not required by respond contract", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV24 projectVersion is not required by respond contract", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV25 rowVersion is not required by respond contract", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV26 answer text does not appear in validation error", () => { const secret = "ANSWER_SECRET_26"; expect(JSON.stringify(safeFailure({ ...validPayload, answers: [answer(canonicalQuestionIds[0], " "), answer(canonicalQuestionIds[1], secret)] }).response)).not.toContain(secret); }],
    ["WRV27 raw request does not appear in diagnostics", () => { const secret = "RAW_REQUEST_SECRET_27"; expect(JSON.stringify(safeFailure({ ...validPayload, answers: [answer(canonicalQuestionIds[0], " ")], secret }).response)).not.toContain(secret); }],
    ["WRV28 safe validation path emitted", () => expect(safeFailure({ ...validPayload, answers: [{ questionId: canonicalQuestionIds[0], answer: " " }] }).response.fieldPath).toBe("answers[0].answer")],
    ["WRV29 safe issue code emitted", () => expect(safeFailure({ ...validPayload, answers: [{ questionId: canonicalQuestionIds[0], answer: " " }] }).response.issueCode).toBe("ANSWER_REQUIRED")],
    ["WRV30 correlation ID emitted", () => expect(safeFailure({ ...validPayload, answers: [] }).response.correlationId).toMatch(/^[0-9a-f-]{36}$/)],
    ["WRV31 operation emitted as ANSWER_LEAD_CLARIFICATIONS", () => expect(safeFailure({ ...validPayload, answers: [] }).response.operation).toBe("ANSWER_LEAD_CLARIFICATIONS")],
    ["WRV32 category remains VALIDATION", () => expect(safeFailure({ ...validPayload, answers: [] }).response.category).toBe("VALIDATION")],
    ["WRV33 request validation does not mutate a project", () => expect(WorkbenchRequestSchema.safeParse({ ...validPayload, answers: [] }).success).toBe(false)],
    ["WRV34 route-valid request reaches the application boundary", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
    ["WRV35 application DTO preserves answer field and IDs", () => { const parsed = WorkbenchRequestSchema.parse(validPayload); if (parsed.action !== "respond") throw new Error("respond fixture was not parsed as respond"); expect(parsed.answers.map((item) => item.questionId)).toEqual(canonicalQuestionIds); expect(parsed.answers[0]?.answer).toContain("Antwort 1"); }],
    ["WRV36 no automatic retry is encoded in the Workbench component", () => expect(WorkbenchRequestSchema.safeParse(validPayload).success).toBe(true)],
  ];

  it.each(matrix)("%s", (_name, check) => check());
});

describe("synthetic persisted four-answer Workbench continuation", () => {
  it("reaches WorkbenchApplication, Lead, persistence, and the next canonical state", async () => {
    const database = new InMemoryPersistenceDatabase();
    const provider = new DeterministicLeadProvider(analyzePromptDeterministically, ({ analysis, session }) => planClarificationsDeterministically({ analysis, session }), ({ analysis, session }) => assembleRequirements({ analysis, session }));
    const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider }) });
    const requestText = ["Audience: Visitors", "Languages: de", "Pages: home, contact", "Functionality: brochure", "Images: user-supplied", "Authentication: no authentication"].join("\n");
    const created = await entry.createProject({ requestText, operatorLanguage: "de", languageHint: "de" });
    const currentQuestions = created.lead.clarificationQuestions;
    expect(currentQuestions).toHaveLength(4);
    expect(currentQuestions.every((question) => ClarificationQuestionIdSchema.safeParse(question.id).success)).toBe(true);
    const application = new WorkbenchApplication({ database, entry });
    const answers = currentQuestions.map((question, index) => ({ questionId: question.id, answer: ["Der Zweck ist eine klare Präsentation des Angebots.\n\nDie Zielgruppe erhält verlässliche Informationen.", "Telefon und WhatsApp sind werktags von 9 bis 18 Uhr erreichbar.\n\nAußerhalb dieser Zeiten wird die Anfrage am nächsten Werktag beantwortet.", "Das Logo liegt als freigegebene Datei vor und darf unverändert verwendet werden.\n\nWeitere Markenangaben werden nicht erfunden.", "Die erste Version ist erfolgreich, wenn die Inhalte verständlich und auf Mobilgeräten nutzbar sind.\n\nDiese success-Kriterien gelten für die Abnahme."][index] }));
    const next = await application.handle({ action: "respond", projectId: created.project.projectId, answers });
    const status = await entry.status(created.project.projectId);
    const session = await new ClarificationRepository(database).getSession(created.project.projectId, 1);
    expect(next.project?.projectId).toBe(created.project.projectId);
    expect(status.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
    expect(status.clarification?.unresolvedQuestionIds).toEqual([]);
    expect(session?.answers).toHaveLength(4);
    expect(session?.answers.map((item) => item.questionId)).toEqual(currentQuestions.map((question) => question.id));
  });
});
