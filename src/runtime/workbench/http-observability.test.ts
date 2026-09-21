import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { planningFinalAdmissionDiagnostics } from "@/agents/planner/final-admission-diagnostics";
import { StagedPlanningOperationTelemetry } from "@/agents/planner/staged-failures";
import { WorkbenchErrorResponseSchema } from "./diagnostics";
import { currentWorkbenchOperationContext } from "./operation-context";
import { readWorkbenchPlanningAttempt, readWorkbenchPlanningAttemptHistory, WorkbenchOperationLedger } from "./operation-ledger";

const mockWorkbench = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "@/app/api/workbench/route";

const projectId = "60606060-6060-4060-8060-606060606060";
const briefChecksum = "a".repeat(64);
const request = () => new Request("http://localhost/api/workbench", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "generate-planning", projectId }),
});

describe("Workbench HTTP execution provenance", () => {
  let database: InMemoryPersistenceDatabase;

  beforeEach(() => {
    database = new InMemoryPersistenceDatabase();
    mockWorkbench.handle.mockReset();
  });

  it("preserves fresh fake-provider retry identity and actionable diagnostics through HTTP", async () => {
    let invocationNumber = 0;
    mockWorkbench.handle.mockImplementation(async () => {
      const context = currentWorkbenchOperationContext();
      if (!context) throw new Error("WORKBENCH_CONTEXT_MISSING");
      invocationNumber += 1;
      const operationId = `workbench-planning:${projectId}`;
      const ledger = new WorkbenchOperationLedger(database, projectId, operationId, context.correlationId, context.runtimeProvenance, context.responseSink);
      await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum });
      await ledger.reserve();
      const provider = await ledger.reserveInvocation({ stage: "coverage", providerContract: "planning-coverage-v1" });
      await provider.beforeTransport();
      await provider.responseReceived();
      const telemetry = new StagedPlanningOperationTelemetry({ operationId: `${operationId}:fake-${invocationNumber}`, operationChecksum: "b".repeat(64), correlationId: context.correlationId, projectId, briefChecksum });
      const finalAdmissionDiagnostics = planningFinalAdmissionDiagnostics({ boundary: "FINAL_ADMISSION", validator: "VALIDATE_PLANNING_ADMISSION", blockers: ["PLANNING_ROUTE_POLICY_MISMATCH"] });
      const stagedFailure = telemetry.fail({ stage: "FINAL_ADMISSION", boundary: "FINAL_ADMISSION", outerCode: "PLANNING_PACKAGE_INVALID", failureClass: "STAGED_FINAL_ASSEMBLY_FAILURE", reasonCode: finalAdmissionDiagnostics.primary.reasonCode, finalAdmissionDiagnostics, message: "synthetic final-admission failure", cause: new Error("PRIVATE_PROVIDER_PAYLOAD DATABASE_URL=secret") });
      throw await ledger.fail(stagedFailure);
    });

    const firstResponse = await POST(request());
    const first = WorkbenchErrorResponseSchema.parse(await firstResponse.json());
    expect(firstResponse.status).toBe(422);
    expect(first).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true, attemptStatus: "FAILED", operationId: `workbench-planning:${projectId}`, stage: "FINAL_ADMISSION", boundary: "FINAL_ADMISSION", reasonCode: "PLANNING_ROUTE_POLICY_MISMATCH", providerCallsTotal: 1, finalAdmissionDiagnostics: { primary: { validator: "VALIDATE_PLANNING_ADMISSION" } } });
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_PROVIDER_PAYLOAD|DATABASE_URL=secret/);
    const firstAttempt = await readWorkbenchPlanningAttempt(database, first.operationId!, first.attemptId!);
    expect(firstAttempt).toMatchObject({ status: "FAILED", result: { attemptId: first.attemptId, correlationId: first.correlationId, providerCallsTotal: 1, runtimeProvenance: first.runtimeProvenance } });

    const secondResponse = await POST(request());
    const second = WorkbenchErrorResponseSchema.parse(await secondResponse.json());
    expect(secondResponse.status).toBe(422);
    expect(second).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true, attemptStatus: "FAILED", providerCallsTotal: 1 });
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.correlationId).not.toBe(first.correlationId);
    expect(second.attemptHistory).toHaveLength(2);
    expect(second.attemptHistory?.map((attempt) => attempt.attemptId)).toEqual(expect.arrayContaining([first.attemptId, second.attemptId]));
    expect(await readWorkbenchPlanningAttempt(database, first.operationId!, first.attemptId!)).toEqual(firstAttempt);
    const history = await readWorkbenchPlanningAttemptHistory(database, first.operationId!);
    expect(history.map((attempt) => attempt.attemptId)).toEqual(expect.arrayContaining([first.attemptId, second.attemptId]));
    expect(history.every((attempt) => attempt.providerCallsTotal === 1 && attempt.runtimeProvenance !== null)).toBe(true);
  });

  it("marks a successful accepted fake-provider execution as new execution metadata", async () => {
    mockWorkbench.handle.mockImplementation(async () => {
      const context = currentWorkbenchOperationContext();
      if (!context) throw new Error("WORKBENCH_CONTEXT_MISSING");
      const operationId = `workbench-planning:${projectId}`;
      const ledger = new WorkbenchOperationLedger(database, projectId, operationId, context.correlationId, context.runtimeProvenance, context.responseSink);
      await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum });
      await ledger.reserve();
      const provider = await ledger.reserveInvocation({ stage: "decomposition", providerContract: "planning-decomposition-v1" });
      await provider.beforeTransport();
      await provider.responseReceived();
      await provider.parsePassed();
      await provider.admissionPassed();
      await ledger.complete();
      return { mode: "PROJECT_WORKBENCH" };
    });

    const response = await POST(request());
    const body = await response.json() as { meta?: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.meta).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true, attemptStatus: "SUCCEEDED", correlationId: expect.any(String), runtimeProvenance: expect.objectContaining({ contractVersion: "workbench-runtime-v1" }) });
    expect(body.meta?.attemptId).toEqual(expect.any(String));
  });
});
