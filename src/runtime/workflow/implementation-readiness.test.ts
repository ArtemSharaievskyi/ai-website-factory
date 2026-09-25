import { describe, expect, it } from "vitest";
import { implementationReadiness } from "./implementation-readiness";

const approved = {
  workflowState: "READY_FOR_IMPLEMENTATION" as const,
  phase7c: { documentType: "phase-7c-contract-package" as const, status: "APPROVED" },
  selectedDesign: { documentType: "selected-design" as const },
  contractAudit: { documentType: "contract-audit" as const, result: { verdict: "APPROVED" } },
  taskGraph: { documentType: "task-graph" as const, readyForExecution: true },
};

describe("implementation readiness", () => {
  it("requires every current downstream artifact, not lifecycle state alone", () => {
    expect(implementationReadiness({ workflowState: "READY_FOR_IMPLEMENTATION" })).toEqual({
      ready: false,
      blockers: ["PHASE_7C_APPROVAL_REQUIRED", "DESIGN_SELECTION_REQUIRED", "CONTRACT_AUDIT_REQUIRED", "IMPLEMENTATION_TASK_GRAPH_REQUIRED"],
    });
  });

  it("admits the fully bound approved chain", () => {
    expect(implementationReadiness(approved)).toEqual({ ready: true, blockers: [] });
  });

  it("does not treat a pending Phase 7C package as implementation-ready", () => {
    expect(implementationReadiness({ ...approved, phase7c: { ...approved.phase7c, status: "PENDING_USER_APPROVAL" } })).toMatchObject({
      ready: false,
      blockers: ["PHASE_7C_APPROVAL_REQUIRED"],
    });
  });
});
