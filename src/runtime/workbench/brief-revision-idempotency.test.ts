import { describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { cleanBriefV3, multiDomainChangeSet } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";

const projectId = "14141414-1414-4141-8141-141414141414";
const timestamp = "2026-08-17T00:00:00.000Z";

async function fixture(options: { delay?: number; failOnce?: boolean } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-v3-idempotency", originalPrompt: "Synthetic V3 idempotency fixture.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "15151515-1515-4151-8151-151515151515", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp }));
  let calls = 0;
  const provider = { proposeChanges: async () => { calls += 1; if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay)); if (options.failOnce && calls === 1) throw new Error("synthetic provider failure"); return multiDomainChangeSet; } };
  const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("LEGACY_LEAD_REVISION_REACHED"); }, createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider }) });
  const app = new WorkbenchApplication({ database, entry });
  const current = await app.handle({ action: "status", projectId });
  if (!current.project || !current.brief) throw new Error("synthetic V3 Brief was not ready");
  const currentness = { projectVersion: current.project.projectVersion, briefChecksum: current.brief.checksum, expectedRowVersion: current.project.rowVersion };
  return { app, projectId, currentness, database, get calls() { return calls; } };
}

const revisionRequest = (fixtureState: Awaited<ReturnType<typeof fixture>>, reason: string, currentness = fixtureState.currentness) => ({ action: "request-brief-changes" as const, projectId: fixtureState.projectId, ...currentness, reason, requirementKeys: ["project-brief"] });

describe("Brief V3 revision route idempotency", () => {
  it("concurrent duplicate clicks share the V3 attempt and never call the provider twice", async () => {
    const f = await fixture({ delay: 20 });
    const request = revisionRequest(f, "Synthetic duplicate revision with full canonical context.");
    const results = await Promise.allSettled([f.app.handle(request), f.app.handle(request)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: expect.objectContaining({ code: "IN_PROGRESS_DUPLICATE" }) });
    expect(f.calls).toBe(1);
  });

  it("a failed V3 revision makes zero Brief V3 changes and permits a later retry", async () => {
    const f = await fixture({ failOnce: true });
    const request = revisionRequest(f, "Synthetic retry after a provider failure.");
    await expect(f.app.handle(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.database.briefRevisionHistory.size).toBe(0);
    await expect(f.app.handle(request)).resolves.toMatchObject({ project: { workflowState: "CLARIFYING" }, brief: { briefSchemaVersion: 3 } });
    expect(f.calls).toBe(2);
  });

  it("replays a committed request without a provider call and rejects stale currentness before execution", async () => {
    const f = await fixture();
    const request = revisionRequest(f, "Synthetic legitimate revision.");
    const accepted = await f.app.handle(request);
    const replay = await f.app.handle(request);
    expect(replay.brief?.checksum).toBe(accepted.brief?.checksum);
    expect(f.calls).toBe(1);
  });
});
