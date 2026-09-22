import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectAssetRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { OpenAiBriefV3RevisionProvider } from "@/integrations/openai-v3/provider";
import { BriefV3ProviderError } from "@/integrations/openai-v3/errors";
import { AiProviderError } from "@/integrations/openai/errors";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import type { BriefV3RevisionProvider } from "@/runtime/brief-revision-v3/ports";
import { ProjectAssetService } from "@/runtime/assets/service";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { WorkbenchErrorResponseSchema, clearWorkbenchDiagnosticEvents, getWorkbenchDiagnosticEvents } from "@/runtime/workbench/diagnostics";
import { DocumentRepository as ReadDocumentRepository, BriefRevisionAttemptRepository } from "@/persistence/database/repositories";

const { mockWorkbench } = vi.hoisted(() => ({ mockWorkbench: { handle: vi.fn() } }));
vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "@/app/api/workbench/route";

const projectId = "ec5549cb-b4b5-4906-8667-7767ff71708e";
const assetId = "4c82b26e-18ae-4d18-b4cf-3a5408848bed";
const assetSha256 = "207b6d76203664bfc24287fcbc13e1647fd873d3b899c7ded791a32f4792959e";
const protectedBriefChecksum = "be33e7b1108bc421cbd5f5861d3f9daafeb1365ca641a88f987e7715b95728e9";
const timestamp = "2026-09-22T00:00:00.000Z";
const logoDescription = "Customer-supplied horizontal logo on a white background with a black worker, an orange demolition hammer, black wordmark, and the visible service line.";
const brandInformation = "MITTELHESSEN DEMONTAGE & OBJEKTSERVICE — Entrümpelung · Entkernung · Wohnungsaufbereitung";

const providerChangeSet = {
  contractVersion: 1 as const,
  changes: [
    { operation: "SET" as const, target: "BRAND_SUPPLIED_INFORMATION" as const, value: brandInformation },
    { operation: "SET" as const, target: "BRAND_SUPPLIED_LOGO_DESCRIPTION" as const, value: logoDescription },
    { operation: "UPSERT" as const, target: "ASSET_COMPANY_LOGO" as const, value: { reference: `asset:${assetId}`, role: "logo" as const, usage: "Use the customer-supplied logo without replacement or reinterpretation.", replacementPolicy: "FORBIDDEN" as const } },
  ],
};

type Fixture = {
  database: InMemoryPersistenceDatabase;
  root: string;
  app: WorkbenchApplication;
  request: Record<string, unknown>;
  providerCalls: () => number;
  observedProviderInput: () => Record<string, unknown> | undefined;
};
const active: Fixture[] = [];

function http(body: unknown) {
  return new Request("http://localhost/api/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function fixture(options: { fail?: boolean; invalidOutput?: boolean; wrongAssetReference?: boolean } = {}): Promise<Fixture> {
  const database = new InMemoryPersistenceDatabase();
  const root = await mkdtemp(path.join(os.tmpdir(), "brief-revision-http-route-"));
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "project-ec5549cb-http-fixture", originalPrompt: "Synthetic isolated HTTP Brief revision fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" });
  await new ProjectRepository(database).create(project);
  const projectRow = database.projects.get(projectId);
  if (!projectRow) throw new Error("fixture project missing");
  database.projects.set(projectId, { ...projectRow, row_version: 4 });

  const draft = createBriefV3Document({ projectId, projectVersion: 1, brief: cleanBriefV3, createdAt: timestamp, updatedAt: timestamp });
  const approved = BriefV3DocumentSchema.parse({ ...draft, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-customer", approvedCanonicalChecksum: draft.briefChecksum } });
  await new DocumentRepository(database).save(approved);
  await new ProjectVersionRepository(database).create({ id: "ec5549cb-b4b5-4906-8667-7767ff717081", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: checksumPersistedDocument(approved), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new ProjectAssetRepository(database).create({ schemaVersion: 1, assetId, projectId, projectVersion: 1, category: "LOGO", source: "USER_SUPPLIED", safeDisplayName: "firma_logo.webp", mediaType: "image/webp", byteSize: 662408, sha256: assetSha256, storageIdentity: `projects/${projectId}/assets/${assetId}/webp`, status: "READY", createdAt: timestamp, updatedAt: timestamp, version: 1, currentness: "CURRENT" });

  let calls = 0;
  let observed: Record<string, unknown> | undefined;
  const bundle = createProductionProviderBundle({ env: { OPENAI_API_KEY: "synthetic-http-fake", OPENAI_MODEL: "synthetic-model", OPENAI_MAX_RETRIES: "0" }, executor: async <T>(request: Record<string, unknown> & { schema: { parse: (value: unknown) => T } }) => {
    calls += 1;
    observed = request;
    if (options.fail) throw new AiProviderError("AI_NETWORK_ERROR", "synthetic provider transport failure", undefined, { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, outputComplete: false, schemaName: "brief-revision-v3" });
    const value = providerChangeSet;
    return { value: request.schema.parse(value), requestId: `synthetic-http-${calls}`, inputTokens: 37, outputTokens: 29 };
  }});
  const assets = new ProjectAssetService({ database, root });
  const projection = new (await import("@/runtime/workspace/sync")).FilesystemProjectMemorySyncPort(root, project.slug);
  const mappedProvider = new OpenAiBriefV3RevisionProvider(bundle.ai);
  const provider: BriefV3RevisionProvider = options.invalidOutput
    ? { proposeChanges: async (input) => { await mappedProvider.proposeChanges(input); throw new BriefV3ProviderError("BRIEF_V3_PROVIDER_INVALID_OUTPUT", { fieldPath: "changes" }); } }
    : options.wrongAssetReference
      ? { proposeChanges: async (input) => { const changeSet = await mappedProvider.proposeChanges(input); return { ...changeSet, changes: changeSet.changes.map((change) => change.operation === "UPSERT" && change.target === "ASSET_COMPANY_LOGO" ? { ...change, value: { ...change.value, reference: "asset:00000000-0000-4000-8000-000000000099" } } : change) }; } }
      : mappedProvider;
  const service = new BriefV3TransactionService({ database, provider, projection });
  const entry = new TrialEntryService({ database, assets, createLeadAgent: () => { throw new Error("LEGACY_LEAD_SHOULD_NOT_RUN"); }, createBriefRevisionV3: () => service });
  const app = new WorkbenchApplication({ database, entry, assets });
  mockWorkbench.handle.mockImplementation((request: unknown) => app.handle(request as Parameters<WorkbenchApplication["handle"]>[0]));
  const status = await app.handle({ action: "status", projectId });
  if (!status.project || !status.brief) throw new Error("fixture status missing");
  const request = { action: "request-brief-changes", projectId, projectVersion: 1, briefChecksum: status.brief.checksum, expectedRowVersion: 4, reason: `Record the exact customer brand identity. Company name: ${brandInformation}. Use the registered logo. Logo description: ${logoDescription}. Preserve all unrelated accepted requirements and do not infer additional services or legal facts.`, requirementKeys: ["BRAND_SUPPLIED_INFORMATION", "BRAND_SUPPLIED_LOGO_DESCRIPTION", "ASSET_COMPANY_LOGO"], assetBindings: [{ target: "ASSET_COMPANY_LOGO", assetId, sha256: assetSha256 }] };
  const value = { database, root, app, request, providerCalls: () => calls, observedProviderInput: () => observed };
  active.push(value);
  return value;
}

afterEach(async () => {
  for (const item of active.splice(0)) await rm(item.root, { recursive: true, force: true });
  mockWorkbench.handle.mockReset();
});

describe("Brief revision production HTTP boundary", () => {
  beforeEach(() => {
    clearWorkbenchDiagnosticEvents();
    mockWorkbench.handle.mockReset();
  });

  it("accepts the exact brand revision contract through HTTP and commits one V3 revision", async () => {
    const f = await fixture();
    const before = await f.app.handle({ action: "status", projectId });
    const response = await POST(http(f.request));
    const body = await response.json() as { ok: boolean; data?: { project?: { workflowState: string; rowVersion: number }; brief?: { approved: boolean; checksum: string; assets?: string[] } }; meta?: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.project?.workflowState).toBe("AWAITING_BRIEF_APPROVAL");
    expect(body.data?.project?.rowVersion).toBe(5);
    expect(body.data?.brief?.approved).toBe(false);
    expect(body.data?.brief?.checksum).not.toBe(before.brief?.checksum);
    expect(body.meta).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true, attemptStatus: "SUCCEEDED", correlationId: expect.any(String), attemptId: expect.any(String), operationId: expect.stringContaining("brief-revision-v3:") });
    expect(f.providerCalls()).toBe(1);
    const attempt = [...f.database.briefRevisionAttempts.values()];
    expect(attempt).toHaveLength(1);
    expect(attempt[0]).toMatchObject({ id: body.meta?.attemptId, status: "COMMITTED", projectId, projectVersion: 1 });
    expect((await new BriefRevisionAttemptRepository(f.database).get({ operationKind: attempt[0]!.operationKind, operationKey: attempt[0]!.operationKey, payloadHash: attempt[0]!.payloadHash }))?.id).toBe(body.meta?.attemptId);
    expect((await new ReadDocumentRepository(f.database).get(projectId, 1, "planning-package"))).toBeNull();
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.assets.size).toBe(1);
    const input = f.observedProviderInput();
    expect(input?.schemaName).toBe("brief-revision-v3");
    expect(JSON.stringify(input?.contextBundle)).toContain(assetId);
    expect(JSON.stringify(input?.contextBundle)).toContain(assetSha256);
    expect(JSON.stringify(input)).not.toContain("storageIdentity");
    expect(getWorkbenchDiagnosticEvents()).toHaveLength(0);
  });

  it("rejects malformed JSON as a typed client error before application dispatch", async () => {
    const response = await POST(new Request("http://localhost/api/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "WORKBENCH_REQUEST_INVALID", category: "VALIDATION", attemptCreated: false });
    expect(mockWorkbench.handle).not.toHaveBeenCalled();
  });

  it("rejects asset preflight failures before provider dispatch", async () => {
    const scenarios = [
      { name: "wrong project", patch: { assetBindings: [{ target: "ASSET_COMPANY_LOGO", assetId: "00000000-0000-4000-8000-000000000001", sha256: assetSha256 }] }, code: "ASSET_NOT_FOUND", status: 404 },
      { name: "checksum mismatch", patch: { assetBindings: [{ target: "ASSET_COMPANY_LOGO", assetId, sha256: "f".repeat(64) }] }, code: "ASSET_CHECKSUM_MISMATCH", status: 409 },
      { name: "missing asset", patch: { assetBindings: [{ target: "ASSET_COMPANY_LOGO", assetId: "00000000-0000-4000-8000-000000000002", sha256: assetSha256 }] }, code: "ASSET_NOT_FOUND", status: 404 },
    ] as const;
    for (const scenario of scenarios) {
      const f = await fixture();
      const response = await POST(http({ ...f.request, ...scenario.patch }));
      const body = WorkbenchErrorResponseSchema.parse(await response.json());
      expect(response.status, scenario.name).toBe(scenario.status);
      expect(body.code, scenario.name).toBe(scenario.code);
      expect(body.attemptCreated, scenario.name).toBe(false);
      expect(f.providerCalls(), scenario.name).toBe(0);
      expect(f.database.briefRevisionAttempts.size, scenario.name).toBe(0);
      await rm(f.root, { recursive: true, force: true });
      active.splice(active.indexOf(f), 1);
    }
  });

  it("preserves a typed provider failure and its fresh attempt through HTTP", async () => {
    const f = await fixture({ fail: true });
    const response = await POST(http(f.request));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: "PROVIDER_FAILED", category: "PROVIDER", providerContract: "brief-revision-v3", attemptCreated: true, attemptStatus: "FAILED" });
    expect(f.providerCalls()).toBe(1);
    expect([...f.database.briefRevisionAttempts.values()]).toHaveLength(1);
    expect(await new ReadDocumentRepository(f.database).get(projectId, 1, "brief-v3")).toBeTruthy();
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(JSON.stringify(body)).not.toContain("synthetic provider transport failure");
  });

  it("preserves provider parse failure without creating a Brief revision", async () => {
    const f = await fixture({ invalidOutput: true });
    const response = await POST(http(f.request));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "PROVIDER_INVALID_OUTPUT", category: "PROVIDER", attemptCreated: true, attemptStatus: "FAILED" });
    expect(f.providerCalls()).toBe(1);
    expect(f.database.briefRevisionAttempts.size).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(await new ReadDocumentRepository(f.database).get(projectId, 1, "brief-v3")).toBeTruthy();
  });

  it("rejects a provider asset-reference mismatch as a typed admission failure", async () => {
    const f = await fixture({ wrongAssetReference: true });
    const response = await POST(http(f.request));
    const body = WorkbenchErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(422);
    expect(body).toMatchObject({ code: "CHANGESET_INVALID", category: "VALIDATION", attemptCreated: true, attemptStatus: "FAILED" });
    expect(f.providerCalls()).toBe(1);
    expect(f.database.briefRevisionAttempts.size).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(await new ReadDocumentRepository(f.database).get(projectId, 1, "brief-v3")).toBeTruthy();
  });

  it("replays the same semantic request without a second attempt or provider call", async () => {
    const f = await fixture();
    const first = await POST(http(f.request));
    const firstBody = await first.json() as { meta?: { attemptId?: string } };
    const second = await POST(http(f.request));
    const secondBody = await second.json() as { meta?: Record<string, unknown> };
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.meta).toMatchObject({ responseOrigin: "REPLAY", attemptCreated: true, attemptId: firstBody.meta?.attemptId });
    expect(f.providerCalls()).toBe(1);
    expect(f.database.briefRevisionAttempts.size).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
  });

  it("rejects stale row and Brief currentness without provider dispatch", async () => {
    const f = await fixture();
    const staleRow = await POST(http({ ...f.request, expectedRowVersion: 3 }));
    const staleRowBody = WorkbenchErrorResponseSchema.parse(await staleRow.json());
    expect(staleRowBody.code).toBe("STALE_BEFORE_PROVIDER");
    expect(f.providerCalls()).toBe(0);
    expect(staleRowBody.attemptCreated).toBe(true);
    const f2 = await fixture();
    const staleBrief = await POST(http({ ...f2.request, briefChecksum: protectedBriefChecksum }));
    const staleBriefBody = WorkbenchErrorResponseSchema.parse(await staleBrief.json());
    expect(staleBrief.status).toBe(409);
    expect(staleBriefBody.code).toBe("BRIEF_CHECKSUM_MISMATCH");
    expect(staleBriefBody.attemptCreated).toBe(false);
    expect(f2.providerCalls()).toBe(0);

    const f3 = await fixture();
    const staleVersion = await POST(http({ ...f3.request, projectVersion: 2 }));
    const staleVersionBody = WorkbenchErrorResponseSchema.parse(await staleVersion.json());
    expect(staleVersion.status).toBe(404);
    expect(staleVersionBody.code).toBe("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    expect(staleVersionBody.attemptCreated).toBe(false);
    expect(f3.providerCalls()).toBe(0);

    const f4 = await fixture();
    const row = f4.database.projects.get(projectId);
    if (!row) throw new Error("fixture project missing");
    f4.database.projects.set(projectId, { ...row, workflow_state: "IMPLEMENTING" });
    const invalidLifecycle = await POST(http(f4.request));
    const invalidLifecycleBody = WorkbenchErrorResponseSchema.parse(await invalidLifecycle.json());
    expect(invalidLifecycle.status).toBe(409);
    expect(invalidLifecycleBody.code).toBe("BRIEF_REVISION_REQUIRED");
    expect(invalidLifecycleBody.attemptCreated).toBe(false);
    expect(f4.providerCalls()).toBe(0);
  });
});
