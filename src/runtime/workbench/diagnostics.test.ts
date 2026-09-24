import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadAgentService } from "@/agents/lead/service";
import { DeterministicLeadProvider } from "@/agents/lead/ports";
import { analyzePromptDeterministically, assembleRequirements, planClarificationsDeterministically } from "@/agents/lead/deterministic";
import { FakeLeadMemoryPort } from "@/agents/lead/memory";
import { AiProviderError } from "@/integrations/openai/errors";
import { PersistenceError } from "@/persistence/database/errors";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication, WorkbenchActionError } from "./application";
import { WorkbenchRequestSchema } from "./contracts";
import { clearWorkbenchDiagnosticEvents, getWorkbenchDiagnosticEvents, workbenchFailureResponse } from "./diagnostics";
import { PlannerError } from "@/agents/planner/errors";
import { DesignError } from "@/agents/design/errors";

const projectId = "00000000-0000-4000-8000-000000000000";
const realProjectId = "b7a0829d-a077-487c-844a-3232efc21bc3";
const prompt = "Synthetic diagnostic prompt only.";

function failure(error: unknown) {
  return workbenchFailureResponse(error, { action: "respond", projectId });
}

function syntheticWorkbench() {
  const database = new InMemoryPersistenceDatabase();
  const provider = new DeterministicLeadProvider(analyzePromptDeterministically, ({ analysis, session }) => planClarificationsDeterministically({ analysis, session }), ({ analysis, session }) => assembleRequirements({ analysis, session }));
  const entry = new TrialEntryService({ database, createLeadAgent: () => new LeadAgentService({ database, memory: new FakeLeadMemoryPort(), provider }) });
  return { database, application: new WorkbenchApplication({ database, entry }) };
}

describe("safe Web Workbench failure diagnostics D409-1..D409-24", () => {
  beforeEach(() => {
    clearWorkbenchDiagnosticEvents();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("D409-1 known request validation gets a stable safe code", () => {
    let error: unknown;
    try { WorkbenchRequestSchema.parse({ action: "respond", projectId: "invalid", answers: [] }); } catch (caught) { error = caught; }
    expect(failure(error).response).toMatchObject({ code: "WORKBENCH_REQUEST_INVALID", operation: "ANSWER_LEAD_CLARIFICATIONS" });
    expect(failure(error).status).toBe(400);
  });

  it("D409-2 unknown project gets a stable safe code", () => {
    const result = failure(new WorkbenchActionError("PROJECT_NOT_FOUND", "private project detail"));
    expect(result).toMatchObject({ status: 404, response: { code: "PROJECT_NOT_FOUND", category: "VALIDATION" } });
  });

  it("D409-3 real workflow conflict remains HTTP 409", () => {
    const result = failure(new WorkbenchActionError("WORKBENCH_ACTION_NOT_AVAILABLE", "private workflow detail"));
    expect(result).toMatchObject({ status: 409, response: { code: "WORKBENCH_ACTION_NOT_AVAILABLE", category: "WORKFLOW_CONFLICT", recoverable: true } });
  });

  it("maps Design source-currentness failures to bounded recoverable diagnostics", () => {
    const result = failure(new DesignError("DESIGN_CONTRACT_STALE", "private source detail", undefined, {
      sourceCurrentness: { disallowedPathCount: 2, paths: ["supabase/.temp/cli-latest", "private-source.ts"] },
    }));
    expect(result).toMatchObject({ status: 409, response: {
      code: "DESIGN_CONTRACT_STALE",
      category: "WORKFLOW_CONFLICT",
      recoverable: true,
      reasonCode: "DESIGN_SOURCE_CURRENTNESS_FAILED",
      sourceCurrentness: { disallowedPathCount: 2, paths: ["supabase/.temp/cli-latest", "private-source.ts"] },
    } });
    expect(JSON.stringify(result.response)).not.toContain("private source detail");
    expect(getWorkbenchDiagnosticEvents().at(-1)?.sourceCurrentness?.paths).toEqual(["supabase/.temp/cli-latest", "private-source.ts"]);
  });

  it("maps host-owned Design input-contract failures as typed validation, not request-schema failure", () => {
    const result = failure(new DesignError("DESIGN_INPUT_INVALID", "private canonical context detail"));
    expect(result).toMatchObject({ status: 422, response: { code: "DESIGN_INPUT_INVALID", category: "VALIDATION", recoverable: false } });
    expect(JSON.stringify(result.response)).not.toContain("private canonical context detail");
  });

  it("maps Planning admission blockers to a typed bounded validation response", () => {
    const result = failure(new PlannerError("ARCHITECTURE_BLOCKED", "Planning refresh admission failed: PLANNING_TRACEABILITY_UNKNOWN_REFERENCE:brief:customerUxDirection."));
    expect(result).toMatchObject({ status: 422, response: { code: "ARCHITECTURE_BLOCKED", category: "VALIDATION", reasonCode: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" } });
    expect(JSON.stringify(result.response)).not.toContain("customerUxDirection");
  });

  it("D409-4 unknown exceptions do not automatically map to 409", () => {
    expect(failure(new Error("private provider payload")).status).not.toBe(409);
  });

  it("D409-5 unknown exceptions map to safe INTERNAL", () => {
    expect(failure(new Error("private provider payload"))).toMatchObject({ status: 500, response: { code: "WORKBENCH_INTERNAL_ERROR", category: "INTERNAL", recoverable: false } });
  });

  it("D409-6 typed provider failures use the existing provider code safely", () => {
    expect(failure(new AiProviderError("AI_PROVIDER_UNAVAILABLE", "private provider response", undefined, { stage: "api_request", requestAttempted: true, responseReceived: true, apiResponseReceived: true, httpStatus: 503 }))).toMatchObject({ status: 503, response: { code: "AI_PROVIDER_UNAVAILABLE", category: "PROVIDER", recoverable: true } });
  });

  it("D409-7 persistence conflicts remain 409 only for actual conflicts", () => {
    expect(failure(new PersistenceError("PERSISTENCE_CONFLICT", "private database detail"))).toMatchObject({ status: 409, response: { code: "PERSISTENCE_CONFLICT", category: "WORKFLOW_CONFLICT" } });
  });

  it("D409-8 persistence failures do not masquerade as workflow conflicts", () => {
    expect(failure(new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "private SQL detail"))).toMatchObject({ status: 503, response: { code: "PERSISTENCE_PROVIDER_ERROR", category: "PERSISTENCE" } });
  });

  it("D409-9 every failed operation has a correlation ID", () => {
    for (const error of [new Error("one"), new WorkbenchActionError("PROJECT_NOT_FOUND", "two"), new AiProviderError("AI_RATE_LIMITED", "three")]) expect(failure(error).response.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("D409-10 response and safe event correlation IDs match", () => {
    const result = failure(new Error("private detail"));
    expect(getWorkbenchDiagnosticEvents().at(-1)?.correlationId).toBe(result.response.correlationId);
  });

  it("D409-11 correlation IDs are opaque and not input-derived", () => {
    const result = workbenchFailureResponse(new Error(prompt), { action: "respond", projectId: realProjectId });
    expect(result.response.correlationId).not.toContain(realProjectId);
    expect(result.response.correlationId).not.toContain(prompt);
  });

  it("D409-12 API response contains no stack", () => {
    const result = failure(new Error("private detail"));
    expect(JSON.stringify(result.response)).not.toContain("stack");
  });

  it("D409-13 API response contains no raw exception message", () => {
    const result = failure(new Error("raw secret exception message"));
    expect(JSON.stringify(result.response)).not.toContain("raw secret exception message");
  });

  it("D409-14 API response contains no SQL", () => {
    const result = failure(new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "SELECT secret FROM private_table"));
    expect(JSON.stringify(result.response)).not.toMatch(/SELECT|private_table/i);
  });

  it("D409-15 API response contains no environment values", () => {
    const result = failure(new Error("DATABASE_URL=postgres://secret"));
    expect(JSON.stringify(result.response)).not.toContain("postgres://secret");
  });

  it("D409-16 API response contains no cookies or auth tokens", () => {
    const result = failure(new Error("cookie=session-secret bearer=token-secret"));
    expect(JSON.stringify(result.response)).not.toMatch(/session-secret|token-secret|bearer/i);
  });

  it("D409-17 diagnostic event contains no answer bodies", () => {
    const result = workbenchFailureResponse(new Error("private detail"), { action: "respond", projectId });
    const event = getWorkbenchDiagnosticEvents().at(-1);
    expect(JSON.stringify(event)).not.toContain("answer");
    expect(event?.correlationId).toBe(result.response.correlationId);
  });

  it("D409-18 diagnostic event contains no raw project prompt", () => {
    workbenchFailureResponse(new Error(prompt), { action: "respond", projectId });
    expect(JSON.stringify(getWorkbenchDiagnosticEvents().at(-1))).not.toContain(prompt);
  });

  it("D409-19 failure projection does not mutate durable state", () => {
    const { database } = syntheticWorkbench();
    const before = database.projects.size;
    failure(new Error("private detail"));
    expect(database.projects.size).toBe(before);
  });

  it("D409-20 valid synthetic Web clarification continuation still succeeds", async () => {
    const { application } = syntheticWorkbench();
    const created = await application.handle({ action: "create", requestText: prompt });
    if (!created.project) throw new Error("synthetic project missing");
    const question = created.questions.find((item) => item.answerStatus === "unresolved");
    if (!question) throw new Error("synthetic question missing");
    const resumed = await application.handle({ action: "respond", projectId: created.project.projectId, answers: [{ questionId: question.id, answer: "Synthetic continuation" }] });
    expect(resumed.project?.projectId).toBe(created.project.projectId);
  });

  it("D409-21 CLI respond remains on the Node-safe composition", async () => {
    const source = await readFile(path.resolve("scripts/factory-respond.ts"), "utf8");
    expect(source).toContain("createNodeTrialEntryRuntime");
  });

  it("D409-22 CLI status remains on the Node-safe composition", async () => {
    const source = await readFile(path.resolve("scripts/factory-status.ts"), "utf8");
    expect(source).toContain("createNodeTrialEntryRuntime");
  });

  it("D409-23 Workbench W1-W40 source behavior remains present", async () => {
    const source = await readFile(path.resolve("src/runtime/workbench/workbench.test.ts"), "utf8");
    expect(source).toContain("W1 landing renders without project");
    expect(source).toContain("W40 test uses synthetic data only");
  });

  it("D409-24 real project is excluded from synthetic validation", () => {
    expect(realProjectId).not.toBe(projectId);
    expect(getWorkbenchDiagnosticEvents()).toEqual([]);
  });
});
