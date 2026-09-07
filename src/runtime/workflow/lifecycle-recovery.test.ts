import { describe, expect, it } from "vitest";
import { transitionWorkflow } from "@/domain/workflow/engine";
import type { ProjectRow, ProjectVersionRow } from "@/persistence/database/types";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { deriveLifecycleRecoveryPlan, LifecycleRecoveryService } from "./lifecycle-recovery";

const project = (workflowState: ProjectRow["workflow_state"]): ProjectRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "synthetic-lifecycle-recovery",
  origin: "SYNTHETIC",
  site_language: "en",
  title: null,
  original_prompt: "Synthetic lifecycle recovery fixture.",
  original_prompt_checksum: "b".repeat(64),
  current_version: 1,
  workflow_state: workflowState,
  implementation_started_at: null,
  completed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  row_version: 5,
});

const version = { versionNumber: 1 } as ProjectVersionRow;
const persistedVersion = (workflowState: ProjectRow["workflow_state"]): ProjectVersionRow => ({ id: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", versionNumber: 1, state: workflowState, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", rowVersion: 1 });
const approvedBrief = { documentType: "brief-v3", briefChecksum: "a".repeat(64), approval: { approved: true, approvedCanonicalChecksum: "a".repeat(64) } };
const planning = (accepted: boolean) => ({ documentType: "planning-package", accepted });
const approvedReview = { documentType: "architecture-review", result: { verdict: "APPROVED" } };
const designs = { documentType: "design-directions" };
const selected = { documentType: "selected-design" };

const plan = (workflowState: ProjectRow["workflow_state"], documents: Partial<Parameters<typeof deriveLifecycleRecoveryPlan>[0]["documents"]> = {}) => deriveLifecycleRecoveryPlan({ project: project(workflowState), version, documents: { brief: approvedBrief, planning: null, architectureReview: null, designDirections: null, selectedDesign: null, taskGraph: null, ...documents } });

describe("canonical lifecycle recovery", () => {
  it("reconciles an advanced state with no Planning artifact to Planner-ready", () => {
    expect(plan("AWAITING_DESIGN_SELECTION").targetState).toBe("AWAITING_PLANNING_GENERATION");
    expect(plan("ARCHITECTURE_REVIEW").targetState).toBe("AWAITING_PLANNING_GENERATION");
  });

  it("stops at explicit Planning approval when a candidate is unaccepted", () => {
    expect(plan("AWAITING_DESIGN_SELECTION", { planning: planning(false) }).targetState).toBe("AWAITING_PLANNING_APPROVAL");
  });

  it("never treats missing Design as design-selection-ready", () => {
    expect(plan("AWAITING_DESIGN_SELECTION", { planning: planning(true), architectureReview: approvedReview }).targetState).toBe("ARCHITECTURE_REVIEW");
  });

  it("reconciles implementation without a TaskGraph to the selected-design frontier", () => {
    expect(plan("IMPLEMENTING", { planning: planning(true), architectureReview: approvedReview, designDirections: designs, selectedDesign: selected }).targetState).toBe("READY_FOR_IMPLEMENTATION");
  });

  it("is idempotent when the current state already matches the artifact frontier", () => {
    const result = plan("AWAITING_PLANNING_GENERATION");
    expect(result.targetState).toBe(result.observedState);
    expect(result.observedRowVersion).toBe(5);
  });

  it("does not permit a failed Planner admission to advance beyond Planning", () => {
    expect(() => transitionWorkflow("AWAITING_PLANNING_GENERATION", "AWAITING_DESIGN_SELECTION")).toThrow(/not permitted/i);
    expect(() => transitionWorkflow("AWAITING_PLANNING_APPROVAL", "READY_FOR_IMPLEMENTATION")).toThrow(/not permitted/i);
  });

  it("rejects a stale recovery CAS token before any lifecycle mutation", async () => {
    const database = new InMemoryPersistenceDatabase();
    const current = project("AWAITING_DESIGN_SELECTION");
    database.projects.set(current.id, current);
    database.versions.set(`${current.id}:1`, persistedVersion(current.workflow_state));
    await expect(new LifecycleRecoveryService(database).reconcile({ projectId: current.id, projectVersion: 1, expectedState: current.workflow_state, expectedRowVersion: current.row_version - 1 })).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
    expect(database.projects.get(current.id)).toEqual(current);
    expect(database.events).toHaveLength(0);
  });
});
