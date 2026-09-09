import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { WorkbenchErrorResponseSchema, clearWorkbenchDiagnosticEvents, getWorkbenchDiagnosticEvents } from "@/runtime/workbench/diagnostics";
import { MAX_BRIEF_REVISION_INSTRUCTION_BYTES } from "@/runtime/workbench/contracts";
import { StagedPlanningOperationTelemetry } from "@/agents/planner/staged-failures";

const { mockWorkbench } = vi.hoisted(() => ({ mockWorkbench: { handle: vi.fn() } }));

vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const canonicalQuestionIds = [
  "C01E5B6A-7D1F-4B8E-9A20-1F3C6D7E8A90",
  "C02E5B6A-7D1F-4B8E-9A20-2F3C6D7E8A90",
  "C03E5B6A-7D1F-4B8E-9A20-3F3C6D7E8A90",
  "C04E5B6A-7D1F-4B8E-9A20-4F3C6D7E8A90",
];
const validRespondPayload = {
  action: "respond" as const,
  projectId: "11111111-1111-4111-8111-111111111111",
  answers: canonicalQuestionIds.map((questionId, index) => ({ questionId, answer: `Synthetic answer ${index + 1} Ã¤ Ã¶ Ã¼ ÃŸ.\n\nSecond paragraph.` })),
};

describe("Workbench route safe failure projection", () => {
  beforeEach(() => {
    mockWorkbench.handle.mockReset();
    clearWorkbenchDiagnosticEvents();
  });

  it("projects malformed requests as safe 400 responses", async () => {
    const response = await POST(request({ action: "respond", projectId: "invalid", answers: [] }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body.code).toBe("WORKBENCH_REQUEST_INVALID");
    expect(body.operation).toBe("ANSWER_LEAD_CLARIFICATIONS");
    expect(body.validationStage).toBe("REQUEST_SCHEMA");
    expect(body.fieldPath).toBe("projectId");
    expect(body.validationIssues?.length).toBeLessThanOrEqual(5);
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(getWorkbenchDiagnosticEvents().at(-1)?.correlationId).toBe(body.correlationId);
    expect(mockWorkbench.handle).not.toHaveBeenCalled();
  });

  it("accepts the current real-format clarification IDs and forwards the canonical DTO", async () => {
    mockWorkbench.handle.mockResolvedValue({ mode: "PROJECT_WORKBENCH" });
    const response = await POST(request(validRespondPayload));
    expect(response.status).toBe(200);
    expect(mockWorkbench.handle).toHaveBeenCalledWith(validRespondPayload);
  });

  it("rejects browser-authored available asset metadata with bounded indexed paths", async () => {
    const response = await POST(request({
      ...validRespondPayload,
      availableAssets: [
        { category: "LOGO", status: "READY" },
        { category: "IMAGE", status: "READY" },
        { category: "IMAGE", status: "READY" },
      ],
    }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "WORKBENCH_REQUEST_INVALID", operation: "ANSWER_LEAD_CLARIFICATIONS", validationStage: "REQUEST_SCHEMA", issueCode: "UNKNOWN_FIELD", fieldPath: "availableAssets[0]", expectedShape: "only fields defined by the Workbench request contract" });
    expect(body.validationIssues?.map((issue) => issue.path)).toEqual(["availableAssets[0]", "availableAssets[1]", "availableAssets[2]"]);
    expect(mockWorkbench.handle).not.toHaveBeenCalled();
  });

  it("returns bounded structural issues without answer text or raw request data", async () => {
    const secret = "PRIVATE ANSWER BODY MUST NOT APPEAR";
    const response = await POST(request({ action: "respond", projectId: validRespondPayload.projectId, answers: [
      { questionId: canonicalQuestionIds[0], answer: "   " },
      { questionId: canonicalQuestionIds[0], answer: secret },
      { questionId: "not-a-clarification-id", answer: secret },
    ], privatePayload: secret }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body.validationIssues).toHaveLength(3);
    expect(body.validationIssues?.map((issue) => issue.path)).toEqual(["answers[0].answer", "answers[2].questionId", "request"]);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain("privatePayload");
  });

  it("rejects duplicate clarification IDs as a request-shape error", async () => {
    const response = await POST(request({ ...validRespondPayload, answers: [validRespondPayload.answers[0], { ...validRespondPayload.answers[0], answer: "another synthetic answer" }] }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body.issueCode).toBe("DUPLICATE_CLARIFICATION_ID");
    expect(body.fieldPath).toBe("answers[1].questionId");
  });

  it("rejects an oversized canonical Brief revision before application or Lead with safe diagnostics", async () => {
    const secret = "SYNTHETIC_REVISION_CONTENT_MUST_NOT_BE_ECHOED";
    const response = await POST(request({ action: "request-brief-changes", projectId: validRespondPayload.projectId, projectVersion: 1, briefChecksum: "a".repeat(64), expectedRowVersion: 1, reason: `${"x".repeat(MAX_BRIEF_REVISION_INSTRUCTION_BYTES)}${secret}` }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "WORKBENCH_REQUEST_INVALID", operation: "REQUEST_BRIEF_CHANGES", validationStage: "REQUEST_SCHEMA", issueCode: "VALUE_TOO_LARGE", fieldPath: "reason" });
    expect(body.error).toContain("too long");
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(mockWorkbench.handle).not.toHaveBeenCalled();
  });

  it("preserves real workflow conflicts as 409 with a correlation event", async () => {
    mockWorkbench.handle.mockRejectedValue(new WorkbenchActionError("WORKBENCH_ACTION_NOT_AVAILABLE", "private detail"));
    const response = await POST(request({ action: "respond", projectId: "00000000-0000-4000-8000-000000000000", answers: [{ questionId: "00000000-0000-4000-8000-000000000001", answer: "Synthetic" }] }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(409);
    expect(body.code).toBe("WORKBENCH_ACTION_NOT_AVAILABLE");
    expect(getWorkbenchDiagnosticEvents().at(-1)?.correlationId).toBe(body.correlationId);
  });

  it("projects unknown exceptions as safe 500 responses", async () => {
    mockWorkbench.handle.mockRejectedValue(new Error("private provider response"));
    const response = await POST(request({ action: "respond", projectId: "00000000-0000-4000-8000-000000000000", answers: [{ questionId: "00000000-0000-4000-8000-000000000001", answer: "Synthetic" }] }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: "WORKBENCH_INTERNAL_ERROR", category: "INTERNAL", operation: "ANSWER_LEAD_CLARIFICATIONS", internalClassification: "UNEXPECTED_EXCEPTION" });
    expect(JSON.stringify(body)).not.toContain("private provider response");
    expect(getWorkbenchDiagnosticEvents().at(-1)).toMatchObject({ internalClassification: "UNEXPECTED_EXCEPTION", correlationId: body.correlationId });
  });

  it("preserves a known staged Planner failure at the production route boundary", async () => {
    const telemetry = new StagedPlanningOperationTelemetry({ operationId: "route-regression", operationChecksum: "a".repeat(64), correlationId: "33333333-3333-4333-8333-333333333333", projectId: validRespondPayload.projectId, briefChecksum: "b".repeat(64) });
    const error = telemetry.fail({ stage: "COVERAGE_ADMISSION", outerCode: "PLANNING_PACKAGE_INVALID", failureClass: "STAGED_COVERAGE_FAILURE", reasonCode: "PLANNING_COVERAGE_ELEMENT_NOT_FOUND", safeToken: "PE_999", message: "private staged failure", cause: new Error("raw provider JSON and DATABASE_URL=secret") });
    mockWorkbench.handle.mockRejectedValue(error);
    const response = await POST(request({ action: "approve-planning", projectId: validRespondPayload.projectId }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(422);
    expect(body).toMatchObject({ code: "PLANNING_PACKAGE_INVALID", category: "VALIDATION", failureClass: "STAGED_COVERAGE_FAILURE", stage: "COVERAGE_ADMISSION", reasonCode: "PLANNING_COVERAGE_ELEMENT_NOT_FOUND", safeToken: "PE_999", providerRequestCount: 0 });
    expect(getWorkbenchDiagnosticEvents().at(-1)?.correlationId).toBe(body.correlationId);
    expect(JSON.stringify(body)).not.toMatch(/raw provider JSON|DATABASE_URL=secret/);
  });
});
