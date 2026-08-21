import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { BriefV3DocumentSchema, createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { PersistenceError } from "@/persistence/database/errors";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { BriefApprovalService } from "./brief-approval";
import { TrialEntryService } from "./service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { evaluateBriefReadiness } from "@/domain/requirements/v3/readiness";
import { transitionWorkflow } from "@/domain/workflow/engine";

const id = () => randomUUID();
const timestamp = "2026-08-20T10:00:00.000Z";

async function fixture(overrides: { brief?: unknown; workflowState?: "CLARIFYING" | "AWAITING_BRIEF_APPROVAL"; projection?: FakeProjectMemorySyncPort } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const projectId = id();
  const brief = CanonicalBriefV3Schema.parse(overrides.brief ?? {
    ...cleanBriefV3,
    unresolved: [{ target: "legal:imprint-address", reason: "Legal details are missing; use an explicit placeholder before publication.", sourceRefs: ["fixture:legal"] }],
  });
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: `brief-approval-${projectId.slice(0, 8)}`, origin: "TEST", siteLanguage: "en", originalPrompt: "Synthetic approval fixture.", currentVersion: 1, workflowState: overrides.workflowState ?? "CLARIFYING" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: id(), projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: checksumPersistedDocument(brief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(document);
  const projection = overrides.projection;
  const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEAD_APPROVAL_PATH_REACHED"); }, createBriefApproval: () => new BriefApprovalService({ database, projection }) });
  return { database, projectId, document, entry, app: new WorkbenchApplication({ database, entry }), projection };
}

describe("host-owned V3 Brief approval", () => {
  it("approves a ready CLARIFYING Brief through the production-shaped Workbench path", async () => {
    const f = await fixture({ projection: new FakeProjectMemorySyncPort() });
    const before = await f.app.handle({ action: "status", projectId: f.projectId });
    expect(before.status.allowedActions).toEqual(["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"]);
    const approved = await f.app.handle({ action: "approve-brief", projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: before.project!.rowVersion });
    expect(approved.project?.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect(approved.brief?.approved).toBe(true);
    const state = await f.database.transaction(async (tx) => ({
      project: await tx.getProject(f.projectId),
      version: await tx.getVersion(f.projectId, 1),
      document: await tx.getDocument(f.projectId, 1, "brief-v3"),
      events: await tx.listWorkflowEvents(f.projectId, 1),
      decisions: await tx.listDecisions(f.projectId, 1),
      history: await tx.listBriefRevisionHistory(f.projectId, 1),
    }));
    const persisted = BriefV3DocumentSchema.parse((await new DocumentRepository(f.database).get(f.projectId, 1, "brief-v3")));
    expect(state.project?.workflow_state).toBe("AWAITING_DESIGN_SELECTION");
    expect(state.project?.row_version).toBe(2);
    expect(state.version?.rowVersion).toBe(1);
    expect(persisted.approval?.approved).toBe(true);
    expect(persisted.approval?.approvedCanonicalChecksum).toBe(f.document.briefChecksum);
    expect(persisted.brief).toEqual(f.document.brief);
    expect(persisted.briefChecksum).toBe(f.document.briefChecksum);
    expect(state.document?.checksum).not.toBe(checksumPersistedDocument(f.document));
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ fromState: "CLARIFYING", toState: "AWAITING_DESIGN_SELECTION" });
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]?.category).toBe("brief-approval");
    expect(state.history).toHaveLength(0);
    const readiness = evaluateBriefReadiness({ brief: persisted.brief });
    expect(readiness.readyForApproval).toBe(true);
    expect(readiness.publicationReady).toBe(false);
    expect(persisted.brief.unresolved).toEqual(f.document.brief.unresolved);
    await expect(f.projection!.verifyVersionSnapshot(f.projectId, 1)).resolves.toBe(true);
  });

  it("requires the host approval context for the direct V3 workflow transition", () => {
    expect(() => transitionWorkflow("CLARIFYING", "AWAITING_DESIGN_SELECTION")).toThrow(/approved current Brief/i);
    expect(transitionWorkflow("CLARIFYING", "AWAITING_DESIGN_SELECTION", { briefApproval: { approved: true, canonicalChecksum: "a".repeat(64) } })).toBe("AWAITING_DESIGN_SELECTION");
  });

  it("keeps repeated approval idempotent and non-duplicating", async () => {
    const f = await fixture();
    const first = await f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 });
    const second = await f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 });
    expect(second).toEqual(first);
    const state = await f.database.transaction(async (tx) => ({ events: await tx.listWorkflowEvents(f.projectId, 1), decisions: await tx.listDecisions(f.projectId, 1) }));
    expect(state.events).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
  });

  it("rejects a not-ready CLARIFYING Brief", async () => {
    const f = await fixture({ brief: { ...cleanBriefV3, unresolved: [{ target: "REQUIREMENT:missing-product-decision", reason: "A product decision is unresolved.", sourceRefs: ["fixture:blocker"] }] } });
    await expect(f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "BRIEF_NOT_READY" });
    const project = await new ProjectRepository(f.database).getWithVersion(f.projectId);
    expect(project?.project.workflowState).toBe("CLARIFYING");
    expect(project?.rowVersion).toBe(1);
  });

  it("rejects stale approval currentness without a partial write", async () => {
    const f = await fixture();
    const approval = new BriefApprovalService({ database: f.database });
    const token = await approval.readCurrentness(f.projectId, 1);
    await f.database.transaction(async (tx) => { await tx.updateProjectState({ id: f.projectId, expectedState: "CLARIFYING", expectedRowVersion: 1, state: "CLARIFYING", updatedAt: "2026-08-20T10:00:01.000Z" }); });
    await expect(approval.approve({ projectId: f.projectId, projectVersion: 1, briefChecksum: f.document.briefChecksum, expectedRowVersion: 2, approvedBy: "synthetic-user", expectedCurrentness: token })).rejects.toMatchObject({ code: "BRIEF_APPROVAL_STALE" });
    const state = await f.database.transaction(async (tx) => ({ document: await tx.getDocument(f.projectId, 1, "brief-v3"), events: await tx.listWorkflowEvents(f.projectId, 1), decisions: await tx.listDecisions(f.projectId, 1) }));
    expect(state.document?.checksum).toBe(checksumPersistedDocument(f.document));
    expect(state.events).toHaveLength(0);
    expect(state.decisions).toHaveLength(0);
  });

  it("rolls back approval, workflow, audit, and document on CAS failure", async () => {
    const f = await fixture();
    const failingDatabase: PersistenceDatabase = { transaction: (work) => f.database.transaction((tx) => work({ ...tx, saveDocumentCAS: async () => { throw new PersistenceError("PERSISTENCE_CONFLICT", "synthetic CAS failure"); } })) };
    await expect(new BriefApprovalService({ database: failingDatabase }).approve({ projectId: f.projectId, projectVersion: 1, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1, approvedBy: "synthetic-user" })).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
    const state = await f.database.transaction(async (tx) => ({ project: await tx.getProject(f.projectId), document: await tx.getDocument(f.projectId, 1, "brief-v3"), events: await tx.listWorkflowEvents(f.projectId, 1), decisions: await tx.listDecisions(f.projectId, 1) }));
    expect(state.project?.workflow_state).toBe("CLARIFYING");
    expect(state.document?.checksum).toBe(checksumPersistedDocument(f.document));
    expect(state.events).toHaveLength(0);
    expect(state.decisions).toHaveLength(0);
  });

  it("rejects approval when a blocking clarification remains unanswered", async () => {
    const f = await fixture();
    const clarification = { schemaVersion: 1 as const, documentType: "clarification-log" as const, projectId: f.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, questions: [{ id: id(), requirementKey: "missing", category: "business" as const, question: "Synthetic blocking question", reason: "Synthetic fixture requires an answer.", blocking: true, required: true, askedAt: timestamp, answerStatus: "unresolved" as const }], answers: [] };
    await new DocumentRepository(f.database).save(clarification);
    await expect(f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "BRIEF_NOT_READY" });
  });

  it("rejects a contradictory CanonicalBriefV3 even with explicit approval", async () => {
    const f = await fixture({ brief: { ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" as const } } } });
    await expect(f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 })).rejects.toMatchObject({ code: "BRIEF_NOT_READY" });
    const current = await new ProjectRepository(f.database).getWithVersion(f.projectId);
    expect(current?.project.workflowState).toBe("CLARIFYING");
    expect(current?.rowVersion).toBe(1);
  });

  it("reconstructs approved state and keeps a repeated approval non-mutating", async () => {
    const f = await fixture();
    const first = await f.entry.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 });
    const reconstructed = new TrialEntryService({ database: f.database, createLeadAgent: () => { throw new Error("LEAD_APPROVAL_PATH_REACHED"); } });
    const status = await reconstructed.status(f.projectId);
    expect(status.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect(status.brief).toMatchObject({ approved: true, checksum: f.document.briefChecksum });
    const replay = await reconstructed.approveBrief({ projectId: f.projectId, briefChecksum: f.document.briefChecksum, expectedRowVersion: 1 });
    expect(replay).toEqual(first);
    await f.database.transaction(async (tx) => {
      expect(await tx.listWorkflowEvents(f.projectId, 1)).toHaveLength(1);
      expect(await tx.listDecisions(f.projectId, 1)).toHaveLength(1);
    });
  });
});
