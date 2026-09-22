import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectAssetRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import type { BriefV3RevisionProvider } from "@/runtime/brief-revision-v3/ports";
import { ProjectAssetService } from "@/runtime/assets/service";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "@/runtime/workbench/application";
import { BriefRevisionAttemptRepository } from "@/persistence/database/repositories";

const { mockWorkbench } = vi.hoisted(() => ({ mockWorkbench: { handle: vi.fn() } }));
vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "@/app/api/workbench/route";

const projectId = "ec5549cb-b4b5-4906-8667-7767ff71708e";
const assetId = "4c82b26e-18ae-4d18-b4cf-3a5408848bed";
const assetSha256 = "207b6d76203664bfc24287fcbc13e1647fd873d3b899c7ded791a32f4792959e";
const timestamp = "2026-09-22T00:00:00.000Z";
const correction = {
  marketingName: "MITTELHESSEN DEMONTAGE & OBJEKTSERVICE",
  proprietorName: "Artem Sharaievskyi",
  primaryStructure: "ONE_PAGE" as const,
  assetBinding: { target: "ASSET_COMPANY_LOGO" as const, assetId, sha256: assetSha256 },
};

function http(body: unknown) {
  return new Request("http://localhost/api/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const staleBrief = CanonicalBriefV3Schema.parse({
  ...cleanBriefV3,
  title: "SHARAIEVSKYI Rückbau · Entkernung",
  pages: [
    { id: "PAGE:home", slug: "home", purpose: "Marketing home.", sourceRefs: ["fixture"] },
    { id: "PAGE:services", slug: "services", purpose: "Marketing services.", sourceRefs: ["fixture"] },
    { id: "PAGE:imprint", slug: "imprint", purpose: "Legal auxiliary route.", sourceRefs: ["fixture"] },
  ],
  decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } },
  brand: { referenceStrategy: "USER_SUPPLIED", suppliedInformation: "SHARAIEVSKYI identity.", suppliedLogoDescription: "Customer logo." },
  assets: [{ id: "ASSET_COMPANY_LOGO", reference: `asset:${assetId}`, role: "logo", usage: "Use the supplied logo.", replacementPolicy: "FORBIDDEN", sourceRefs: ["fixture"] }],
  seo: { ...cleanBriefV3.seo, exactTitle: "SHARAIEVSKYI Rückbau", exactMetaDescription: "SHARAIEVSKYI local demolition.", primaryKeywords: ["sharaievskyi"], pageMetadata: [{ route: "/", title: "SHARAIEVSKYI", metaDescription: "SHARAIEVSKYI", keywords: ["sharaievskyi"], sourceRefs: ["fixture"] }] },
  requirements: [
    ...cleanBriefV3.requirements,
    { id: "REQUIREMENT:old-brand", category: "BRAND_VISUAL", statement: "Use the SHARAIEVSKYI wordmark; no logo exists.", sourceRefs: ["fixture"] },
    { id: "REQUIREMENT:bad-exclusion", category: "BRAND_VISUAL", statement: "Do not infer legal identity from the logo and exclude unsafe service scope.", sourceRefs: ["fixture"] },
    { id: "REQUIREMENT:legal-proprietor", category: "LEGAL_FACT", statement: "Inhaber Artem Sharaievskyi.", sourceRefs: ["fixture"] },
    { id: "REQUIREMENT:contact", category: "CONTACT_FACT", statement: "Phone [PHONE]", sourceRefs: ["fixture"] },
  ],
  evidence: [{ field: "brand.logo", source: "fixture", excerpt: "no logo; do not invent one", sourceRefs: ["fixture"] }],
  unresolved: [],
});

describe("Deterministic Brief consistency correction HTTP boundary", () => {
  const roots: string[] = [];
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); mockWorkbench.handle.mockReset(); });

  it("uses one canonical HTTP dispatch, creates one revision, projects it, and replays without a provider", async () => {
    const database = new InMemoryPersistenceDatabase();
    const root = await mkdtemp(path.join(os.tmpdir(), "brief-consistency-http-"));
    roots.push(root);
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "brief-consistency-http", originalPrompt: "Synthetic consistency correction.", currentVersion: 1, workflowState: "AWAITING_BRIEF_APPROVAL" });
    await new ProjectRepository(database).create(project);
    const row = database.projects.get(projectId)!;
    database.projects.set(projectId, { ...row, row_version: 5 });
    await new DocumentRepository(database).save(createBriefV3Document({ projectId, projectVersion: 1, brief: staleBrief, createdAt: timestamp, updatedAt: timestamp }));
    await new ProjectVersionRepository(database).create({ id: "ec5549cb-b4b5-4906-8667-7767ff717081", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    await new ProjectAssetRepository(database).create({ schemaVersion: 1, assetId, projectId, projectVersion: 1, category: "LOGO", source: "USER_SUPPLIED", safeDisplayName: "firma_logo.webp", mediaType: "image/webp", byteSize: 662408, sha256: assetSha256, storageIdentity: `projects/${projectId}/assets/${assetId}/webp`, status: "READY", createdAt: timestamp, updatedAt: timestamp, version: 1, currentness: "CURRENT" });
    let providerCalls = 0;
    const provider: BriefV3RevisionProvider = { proposeChanges: async () => { providerCalls += 1; throw new Error("DETERMINISTIC_CORRECTION_MUST_NOT_CALL_PROVIDER"); } };
    const projection = new (await import("@/runtime/workspace/sync")).FilesystemProjectMemorySyncPort(root, project.slug);
    const revision = new BriefV3TransactionService({ database, provider, projection });
    const assets = new ProjectAssetService({ database, root });
    const entry = new TrialEntryService({ database, assets, createLeadAgent: () => { throw new Error("LEAD_MUST_NOT_RUN"); }, createBriefRevisionV3: () => revision });
    const app = new WorkbenchApplication({ database, entry, assets });
    mockWorkbench.handle.mockImplementation((request: unknown) => app.handle(request as Parameters<WorkbenchApplication["handle"]>[0]));
    const before = await app.handle({ action: "status", projectId });
    const request = { action: "request-brief-changes", projectId, projectVersion: 1, briefChecksum: before.brief!.checksum, expectedRowVersion: 5, reason: "Apply confirmed Brief consistency correction.", requirementKeys: ["BRIEF_CONSISTENCY"], assetBindings: [correction.assetBinding], correction };
    const first = await POST(http(request));
    const firstBody = await first.json() as { ok: boolean; data?: { project?: { workflowState: string; rowVersion: number }; brief?: { approved: boolean; checksum: string } }; meta?: Record<string, unknown> };
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ ok: true, data: { project: { workflowState: "AWAITING_BRIEF_APPROVAL", rowVersion: 6 }, brief: { approved: false } }, meta: { responseOrigin: "NEW_EXECUTION", attemptCreated: true, attemptStatus: "SUCCEEDED", correlationId: expect.any(String), attemptId: expect.any(String) } });
    expect(providerCalls).toBe(0);
    expect(database.briefRevisionAttempts.size).toBe(1);
    expect(database.briefRevisionHistory.size).toBe(1);
    const current = BriefV3DocumentSchema.parse(await new DocumentRepository(database).get(projectId, 1, "brief-v3"));
    expect(current.approval?.approved).not.toBe(true);
    expect(current.brief.brand.marketingName).toBe(correction.marketingName);
    expect(current.brief.legal.confirmedProprietor?.name).toBe(correction.proprietorName);
    expect(current.brief.pages.map((page) => page.slug).sort()).toEqual(["/", "/impressum"]);
    expect(await readFile(path.join(root, project.slug, "v1", ".factory", "brief-v3.json"), "utf8")).toContain(correction.marketingName);
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toBeNull();
    const history = [...database.briefRevisionHistory.values()][0]!;
    expect(history.nextCurrentChecksum).toBe(current.briefChecksum);
    const attempt = [...database.briefRevisionAttempts.values()][0]!;
    expect(attempt.id).toBe(firstBody.meta?.attemptId);
    const replay = await POST(http(request));
    const replayBody = await replay.json() as { meta?: Record<string, unknown> };
    expect(replay.status).toBe(200);
    expect(replayBody.meta).toMatchObject({ responseOrigin: "REPLAY", attemptId: firstBody.meta?.attemptId });
    expect(providerCalls).toBe(0);
    expect(database.briefRevisionAttempts.size).toBe(1);
    expect(database.briefRevisionHistory.size).toBe(1);
    expect((await new BriefRevisionAttemptRepository(database).get({ operationKind: attempt.operationKind, operationKey: attempt.operationKey, payloadHash: attempt.payloadHash }))?.status).toBe("COMMITTED");
  });
});
