import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { WorkbenchErrorResponseSchema, clearWorkbenchDiagnosticEvents, getWorkbenchDiagnosticEvents } from "@/runtime/workbench/diagnostics";

const { mockWorkbench } = vi.hoisted(() => ({ mockWorkbench: { handle: vi.fn() } }));

vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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
    expect(body).toMatchObject({ code: "WORKBENCH_INTERNAL_ERROR", category: "INTERNAL", operation: "ANSWER_LEAD_CLARIFICATIONS" });
    expect(JSON.stringify(body)).not.toContain("private provider response");
  });
});
