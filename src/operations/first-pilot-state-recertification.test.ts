import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { TaskGraphSchema } from "@/domain/tasks/schema";
import { ExecutionSummarySchema } from "@/orchestration/execution/contracts";

function configuredDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*DATABASE_URL\s*=/.test(candidate));
    const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
}

const databaseUrl = configuredDatabaseUrl();
const pilotProjectId = process.env.PLANNING_RECOVERY_PILOT_PROJECT_ID;
const describeLive = describe.skipIf(!databaseUrl || !pilotProjectId);
type PilotRecertificationEvidence = {
  historicalEvidence: { workflowState: string; projectVersion: number; rowVersion: number; planningEvidenceRowVersion: number; immutable: boolean };
  canonicalBindings: { briefSemanticChecksum: string; briefDocumentChecksum: string; planningChecksum: string; architectureChecksum: string; taskGraphDocumentChecksum: string; taskGraphChecksum: string; executionBoundGraphChecksum: string };
  productInvariants: { briefUnchanged: boolean; planningUnchanged: boolean; architectureUnchanged: boolean; selectedDesignUnchanged: boolean; routes: number; services: number; moebeltransportPresent: boolean; databaseDecision: string; backendDecision: string; authDecision: string; clientOnlyForm: boolean; releaseEligible: boolean; publication: string; prepareReleaseExecuted: boolean };
  transitionAudit: { persistedWorkflowEventCount: number; authorizedTransitionCount: number; unauthorizedTransitionCount: number; unknownTransitionCount: number; classification: string };
  providerCallsDuringRecertification: number;
  pilotSourceOrContentMutation: boolean;
  pilotCanonicalMutation: boolean;
  releaseOrDeploymentExecuted: boolean;
};
const evidence = JSON.parse(readFileSync(path.resolve("docs/admin/phase-9/first-pilot-state-recertification-2026-09-07.json"), "utf8")) as PilotRecertificationEvidence;

describeLive("first-pilot protected state recertification", () => {
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);

  afterAll(async () => pool.end());

  it("binds the current authorized lifecycle state without mutation or provider work", async () => {
    expect(evidence.historicalEvidence).toMatchObject({ workflowState: "AWAITING_DESIGN_SELECTION", projectVersion: 1, rowVersion: 15, planningEvidenceRowVersion: 10, immutable: true });
    const state = await database.transaction(async (tx) => ({
      project: await tx.getProject(pilotProjectId!),
      version: await tx.getVersion(pilotProjectId!, 1),
      brief: await tx.getDocument(pilotProjectId!, 1, "brief-v3"),
      planning: await tx.getDocument(pilotProjectId!, 1, "planning-package"),
      graph: await tx.getDocument(pilotProjectId!, 1, "task-graph"),
      execution: await tx.getDocument(pilotProjectId!, 1, "full-execution"),
      release: await tx.getDocument(pilotProjectId!, 1, "release-report"),
      events: await tx.listWorkflowEvents(pilotProjectId!, 1),
    }));
    expect(state.project).toMatchObject({ current_version: 1, workflow_state: "IMPLEMENTING", row_version: 23 });
    expect(state.version).toMatchObject({ versionNumber: 1, state: "DRAFT", rowVersion: 4, immutable: false });
    const brief = BriefV3DocumentSchema.parse(mapRowToDocument(state.brief!));
    const planning = PlanningPackageSchema.parse(mapRowToDocument(state.planning!));
    const graph = TaskGraphSchema.parse(mapRowToDocument(state.graph!));
    const execution = ExecutionSummarySchema.parse(mapRowToDocument(state.execution!));
    expect({ semanticChecksum: brief.briefChecksum, documentChecksum: state.brief!.checksum }).toEqual({ semanticChecksum: evidence.canonicalBindings.briefSemanticChecksum, documentChecksum: evidence.canonicalBindings.briefDocumentChecksum });
    expect({ planningChecksum: state.planning!.checksum, architectureChecksum: checksumPersistedDocument(planning.architecture) }).toEqual({ planningChecksum: evidence.canonicalBindings.planningChecksum, architectureChecksum: evidence.canonicalBindings.architectureChecksum });
    expect(state.graph!.checksum).toBe(evidence.canonicalBindings.taskGraphDocumentChecksum);
    expect(graph.graphChecksum).toBe(evidence.canonicalBindings.taskGraphChecksum);
    expect(execution.taskGraphChecksum).toBe(evidence.canonicalBindings.executionBoundGraphChecksum);
    expect(graph.tasks.filter((task) => task.status === "passed")).toHaveLength(81);
    expect(graph.tasks.filter((task) => task.status === "failed")).toHaveLength(0);
    expect(graph.tasks.filter((task) => task.status === "cancelled")).toHaveLength(22);
    expect(graph.tasks.filter((task) => task.status === "ready")).toHaveLength(1);
    expect(graph.tasks.find((task) => task.taskType === "prepare-release")).toMatchObject({ status: "ready", attempt: 0 });
    expect(execution).toMatchObject({ finalWorkflowState: "VALIDATING", releaseEligible: true, totalTasks: 104, passed: 81, failed: 0, cancelled: 22 });
    expect(state.release).toBeNull();
    const allowedTransitions = new Set([
      "DRAFT->CLARIFYING", "CLARIFYING->AWAITING_BRIEF_APPROVAL", "AWAITING_BRIEF_APPROVAL->CLARIFYING", "CLARIFYING->AWAITING_DESIGN_SELECTION",
      "AWAITING_DESIGN_SELECTION->ARCHITECTURE_REVIEW", "ARCHITECTURE_REVIEW->AWAITING_DESIGN_SELECTION", "AWAITING_DESIGN_SELECTION->AWAITING_BRIEF_APPROVAL",
      "AWAITING_BRIEF_APPROVAL->AWAITING_DESIGN_SELECTION", "AWAITING_DESIGN_SELECTION->READY_FOR_IMPLEMENTATION", "READY_FOR_IMPLEMENTATION->CONTRACT_AUDIT",
      "CONTRACT_AUDIT->READY_FOR_IMPLEMENTATION", "READY_FOR_IMPLEMENTATION->IMPLEMENTING",
    ]);
    expect(state.events).toHaveLength(22);
    expect(state.events.every((event) => allowedTransitions.has(`${event.fromState}->${event.toState}`))).toBe(true);
    expect(evidence.transitionAudit).toMatchObject({ persistedWorkflowEventCount: 22, authorizedTransitionCount: 22, unauthorizedTransitionCount: 0, unknownTransitionCount: 0, classification: "AUTHORIZED_PROTECTED_STATE_ADVANCE" });
    expect(evidence.productInvariants).toMatchObject({ briefUnchanged: true, planningUnchanged: true, architectureUnchanged: true, selectedDesignUnchanged: true, routes: 11, services: 31, moebeltransportPresent: true, databaseDecision: "NONE", backendDecision: "NONE", authDecision: "NONE", clientOnlyForm: true, releaseEligible: true, publication: "DEFERRED", prepareReleaseExecuted: false });
    expect(evidence).toMatchObject({ providerCallsDuringRecertification: 0, pilotSourceOrContentMutation: false, pilotCanonicalMutation: false, releaseOrDeploymentExecuted: false });
  });
});

if (!databaseUrl || !pilotProjectId) console.log("FIRST-PILOT STATE RECERTIFICATION: SKIPPED (DATABASE_URL or PLANNING_RECOVERY_PILOT_PROJECT_ID unavailable)");
