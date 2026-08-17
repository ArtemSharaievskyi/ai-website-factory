import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { ProjectBriefV2Schema, RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { pilotShapedV1Brief, representativeV2Brief } from "@/domain/requirements/v3/fixtures";
import type { ProviderBriefChangeSet } from "@/integrations/openai-v3/changeset";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { OpenAiBriefV3RevisionProvider } from "@/integrations/openai-v3/provider";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { BriefRevisionAttemptRepository, DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { documentKey, InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { FilesystemProjectMemorySyncPort } from "@/runtime/workspace/sync";
import { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import type { BriefV3RevisionProvider } from "@/runtime/brief-revision-v3/ports";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { clearWorkbenchDiagnosticEvents } from "./diagnostics";

const projectId = "12121212-1212-4121-8121-121212121212";
const timestamp = "2026-08-17T00:00:00.000Z";
const providerDto = {
  contractVersion: 1 as const,
  changes: [
    { operation: "SET" as const, target: "FORM_SUCCESS_MODE" as const, value: "SIMULATED" as const },
    { operation: "SET" as const, target: "FORM_TRANSMISSION_MODE" as const, value: "NONE" as const },
    { operation: "SET" as const, target: "SEO_TITLE" as const, value: "Synthetic Atelier Revised" as const },
    { operation: "UPSERT" as const, target: "REQUIREMENT:service-hours" as const, value: { category: "FEATURE" as const, statement: "Show synthetic service hours." } },
    { operation: "UPSERT" as const, target: "REQUIREMENT:contact-success" as const, value: { category: "FORM" as const, statement: "Show a synthetic local success state after validation." } },
  ],
} satisfies ProviderBriefChangeSet;

type Fixture = {
  database: InMemoryPersistenceDatabase;
  root: string;
  project: import("@/domain/project/schema").FactoryProject;
  projection: FilesystemProjectMemorySyncPort;
  ai: ReturnType<typeof providerBundle>;
  createApp: (provider?: BriefV3RevisionProvider) => { entry: TrialEntryService; app: WorkbenchApplication };
  app: WorkbenchApplication;
  entry: TrialEntryService;
  request: {
    action: "request-brief-changes";
    projectId: string;
    projectVersion: number;
    briefChecksum: string;
    expectedRowVersion: number;
    reason: string;
    requirementKeys: string[];
  };
};
const activeFixtures: Fixture[] = [];

function legacyBrief(): RequirementSpecification {
  return ProjectBriefV2Schema.parse({
    ...representativeV2Brief,
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function pilotLegacyBrief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    ...pilotShapedV1Brief,
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function providerBundle(options: { failFirst?: boolean; failAlways?: boolean } = {}) {
  let calls = 0;
  const bundle = createProductionProviderBundle({
    env: { OPENAI_API_KEY: "synthetic-network-fake", OPENAI_MODEL: "synthetic-model", OPENAI_MAX_RETRIES: "0" },
    executor: async <T>(request: { schema: { parse: (value: unknown) => T } }) => {
      calls += 1;
      if (options.failAlways || (options.failFirst && calls === 1)) throw new Error("synthetic-network-failure");
      return { value: request.schema.parse(providerDto), requestId: `synthetic-v3-request-${calls}`, inputTokens: 10, outputTokens: 20 };
    },
  });
  return { bundle, briefV3: new OpenAiBriefV3RevisionProvider(bundle.ai), get calls() { return calls; } };
}

async function fixture(options: { failFirst?: boolean; failAlways?: boolean } = {}, legacy: RequirementSpecification = legacyBrief()): Promise<Fixture> {
  const database = new InMemoryPersistenceDatabase();
  const root = await mkdtemp(path.join(os.tmpdir(), "brief-v3-production-route-"));
  const project = FactoryProjectSchema.parse({
    schemaVersion: 1,
    documentType: "factory-project",
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    id: projectId,
    slug: "brief-v3-production-route",
    originalPrompt: "Synthetic production route fixture.",
    currentVersion: 1,
    workflowState: "AWAITING_BRIEF_APPROVAL",
  });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "13131313-1313-4131-8131-131313131313", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: checksumPersistedDocument(legacy), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  await new DocumentRepository(database).save(legacy);

  const ai = providerBundle(options);
  const projection = new FilesystemProjectMemorySyncPort(root, project.slug);
  const createApp = (provider: BriefV3RevisionProvider = ai.briefV3) => {
    const entry = new TrialEntryService({
      database,
      createLeadAgent: () => { throw new Error("LEGACY_LEAD_REVISION_REACHED"); },
      createBriefRevisionV3: () => new BriefV3TransactionService({ database, provider, projection }),
    });
    return { entry, app: new WorkbenchApplication({ database, entry }) };
  };
  const { app, entry } = createApp();
  const initial = await app.handle({ action: "status", projectId });
  if (!initial.project || !initial.brief) throw new Error("synthetic production route fixture is not ready");
  const request = {
    action: "request-brief-changes" as const,
    projectId,
    projectVersion: initial.project.projectVersion,
    briefChecksum: initial.brief.checksum,
    expectedRowVersion: initial.project.rowVersion,
    reason: "Make the synthetic form local-only with simulated success and revise the synthetic SEO title.",
    requirementKeys: ["project-brief"],
  };
  const value = { database, root, project, projection, ai, createApp, app, entry, request };
  activeFixtures.push(value);
  return value;
}

async function cleanup(fixture: Fixture) {
  fixture.database.projects.clear();
  fixture.database.versions.clear();
  fixture.database.documents.clear();
  fixture.database.events.splice(0, fixture.database.events.length);
  fixture.database.briefRevisionAttempts.clear();
  fixture.database.briefRevisionHistory.clear();
  fixture.database.briefRevisionProjectionSync.clear();
  await rm(fixture.root, { recursive: true, force: true });
  expect(fixture.database.projects.size).toBe(0);
  expect(fixture.database.versions.size).toBe(0);
  expect(fixture.database.documents.size).toBe(0);
  expect(fixture.database.briefRevisionAttempts.size).toBe(0);
  expect(fixture.database.briefRevisionHistory.size).toBe(0);
  expect(fixture.database.briefRevisionProjectionSync.size).toBe(0);
  expect(fixture.database.events).toHaveLength(0);
  expect(existsSync(fixture.root)).toBe(false);
}

afterEach(async () => {
  const fixtures = activeFixtures.splice(0, activeFixtures.length);
  await Promise.all(fixtures.map(cleanup));
});

describe("production-shaped Brief V3 request route", () => {
  it("enters through Workbench, uses the strict V3 provider mapper, commits once, and replays through reconstructed composition", async () => {
    const f = await fixture();
    clearWorkbenchDiagnosticEvents();
    const first = await f.app.handle(f.request);
    expect(first.project?.workflowState).toBe("CLARIFYING");
    expect(first.brief?.briefSchemaVersion).toBe(3);
    expect(first.brief?.seo).toContain("Exact title: Synthetic Atelier Revised");
    expect((await f.entry.status(projectId)).blockingReasons).toEqual([]);
    expect(f.ai.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.briefRevisionProjectionSync.size).toBe(1);
    expect([...f.database.briefRevisionProjectionSync.values()][0]?.status).toBe("SYNCED");
    expect([...f.database.events].filter((event) => event.revisionAttemptId)).toHaveLength(1);
    const v3 = await new DocumentRepository(f.database).get(projectId, 1, "brief-v3");
    expect(v3?.documentType).toBe("brief-v3");
    expect(existsSync(path.join(f.root, f.project.slug, "v1", ".factory", "brief-v3.json"))).toBe(true);

    const beforeReplay = JSON.stringify({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], events: f.database.events, history: [...f.database.briefRevisionHistory.values()], projections: [...f.database.briefRevisionProjectionSync.values()] });
    const replayResult = await f.entry.requestBriefChanges(f.request);
    const afterReplay = JSON.stringify({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], events: f.database.events, history: [...f.database.briefRevisionHistory.values()], projections: [...f.database.briefRevisionProjectionSync.values()] });
    expect(replayResult).toMatchObject({ projectId, workflowState: "CLARIFYING" });
    expect(afterReplay).toBe(beforeReplay);
    expect(f.ai.calls).toBe(1);

    let reconstructedCalls = 0;
    const reconstructedBundle = createProductionProviderBundle({
      env: { OPENAI_API_KEY: "synthetic-network-fake", OPENAI_MODEL: "synthetic-model", OPENAI_MAX_RETRIES: "0" },
      executor: async () => { reconstructedCalls += 1; throw new Error("RECONSTRUCTED_PROVIDER_INVOKED"); },
    });
    const reconstructed = f.createApp(new OpenAiBriefV3RevisionProvider(reconstructedBundle.ai));
    const reconstructedResult = await reconstructed.entry.requestBriefChanges(f.request);
    expect(reconstructedResult).toMatchObject({ projectId, workflowState: "CLARIFYING" });
    expect(reconstructedCalls).toBe(0);
    expect(f.database.briefRevisionHistory.size).toBe(1);
  });

  it("migrates a pilot-shaped V1 Brief in memory before the first atomic V3 commit", async () => {
    const f = await fixture({}, pilotLegacyBrief());
    clearWorkbenchDiagnosticEvents();
    const legacyBefore = await new DocumentRepository(f.database).get(projectId, 1, "requirements");
    if (!legacyBefore) throw new Error("synthetic pilot-shaped legacy Brief is not ready");
    const legacyChecksumBefore = checksumPersistedDocument(legacyBefore);
    const legacyRowVersionBefore = f.database.documents.get(documentKey(projectId, 1, "requirements"))?.rowVersion;

    const first = await f.app.handle(f.request);
    expect(first.project?.workflowState).toBe("CLARIFYING");
    expect(first.brief?.briefSchemaVersion).toBe(3);
    expect(f.ai.calls).toBe(1);
    expect(f.database.briefRevisionHistory.size).toBe(1);
    expect(f.database.briefRevisionProjectionSync.size).toBe(1);
    const legacyAfter = await new DocumentRepository(f.database).get(projectId, 1, "requirements");
    expect(f.database.documents.get(documentKey(projectId, 1, "requirements"))?.rowVersion).toBe(legacyRowVersionBefore);
    expect(legacyAfter ? checksumPersistedDocument(legacyAfter) : null).toBe(legacyChecksumBefore);
    const v3 = await new DocumentRepository(f.database).get(projectId, 1, "brief-v3");
    expect(v3?.documentType).toBe("brief-v3");
    expect(v3?.schemaVersion).toBe(3);
    if (!v3 || v3.documentType !== "brief-v3") throw new Error("synthetic V3 Brief was not persisted");
    expect(v3.brief.requirements.some((entry) => entry.statement.startsWith("Historical revision instruction"))).toBe(false);
    expect(v3.brief.requirements.some((entry) => entry.statement === "Unsupported synthetic assumption must stay diagnostic.")).toBe(false);
    expect(v3.brief.decisions.analytics.mode).toBe("NONE");
    expect(v3.brief.decisions.form.serverProcessingMode).toBe("NONE");
    expect(v3.brief.legal.inventedFactsPolicy).toBe("FORBIDDEN");
    expect(v3.brief.seo.exactTitle).toBe("Synthetic Atelier Revised");
    expect(v3.brief.seo.exactMetaDescription).toBe("Synthetic local garden service description.");
    expect(v3.brief.seo.primaryKeywords).toEqual(["local service", "synthetic garden", "synthetic region"]);
    expect(f.database.documents.size).toBe(2);
    expect([...f.database.documents.keys()].sort()).toEqual([documentKey(projectId, 1, "brief-v3"), documentKey(projectId, 1, "requirements")].sort());
    expect([...f.database.briefRevisionAttempts.values()][0]?.currentnessToken).toMatchObject({ canonicalSchemaVersion: 3, documentType: "requirements" });

    const beforeReplay = JSON.stringify({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], events: f.database.events, history: [...f.database.briefRevisionHistory.values()], projections: [...f.database.briefRevisionProjectionSync.values()] });
    await expect(f.entry.requestBriefChanges(f.request)).resolves.toMatchObject({ projectId, workflowState: "CLARIFYING" });
    const afterReplay = JSON.stringify({ projects: [...f.database.projects.values()], versions: [...f.database.versions.values()], documents: [...f.database.documents.values()], events: f.database.events, history: [...f.database.briefRevisionHistory.values()], projections: [...f.database.briefRevisionProjectionSync.values()] });
    expect(afterReplay).toBe(beforeReplay);
    expect(f.ai.calls).toBe(1);
  });

  it("fails closed on a provider failure and retries through V3 without invoking Lead V2", async () => {
    const f = await fixture({ failFirst: true });
    await expect(f.app.handle(f.request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(await new DocumentRepository(f.database).get(projectId, 1, "brief-v3")).toBeNull();
    await expect(f.app.handle(f.request)).resolves.toMatchObject({ project: { workflowState: "CLARIFYING" }, brief: { briefSchemaVersion: 3 } });
    expect(f.ai.calls).toBe(2);
  });

  it("persists safe, generation-scoped diagnostics for a pilot-shaped provider failure across a reconstructed read", async () => {
    const f = await fixture({ failAlways: true }, pilotLegacyBrief());
    await expect(f.app.handle(f.request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    const first = [...f.database.briefRevisionAttempts.values()][0];
    expect(first).toMatchObject({ status: "FAILED_RETRYABLE", attemptGeneration: 1, failureCode: "PROVIDER_FAILED" });
    expect(first?.failureDiagnostics).toHaveLength(1);
    expect(first?.failureDiagnostics?.[0]).toMatchObject({ generation: 1, diagnostic: { version: 1, category: "UNKNOWN", stage: "REQUEST_TRANSPORT", requestAttempted: true, provider: "openai", model: "synthetic-model", errorCode: "AI_OUTPUT_INVALID", schemaName: "brief-revision-v3" } });
    expect(JSON.stringify(first?.failureDiagnostics)).not.toContain("synthetic-network-failure");

    await expect(f.app.handle(f.request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    const second = [...f.database.briefRevisionAttempts.values()][0];
    expect(second?.attemptGeneration).toBe(2);
    expect(second?.failureDiagnostics?.map((entry) => entry.generation)).toEqual([1, 2]);
    if (!second) throw new Error("synthetic failure attempt was not persisted");
    const reconstructedRead = await new BriefRevisionAttemptRepository(f.database).get({ operationKind: second.operationKind, operationKey: second.operationKey, payloadHash: second.payloadHash });
    expect(reconstructedRead?.failureDiagnostics).toEqual(second?.failureDiagnostics);
    expect(await new DocumentRepository(f.database).get(projectId, 1, "brief-v3")).toBeNull();
    expect(f.database.briefRevisionHistory.size).toBe(0);
  });

  it("rejects stale currentness before provider execution and leaves legacy state untouched", async () => {
    const f = await fixture();
    await expect(f.app.handle({ ...f.request, expectedRowVersion: f.request.expectedRowVersion + 1 })).rejects.toMatchObject({ code: "STALE_BEFORE_PROVIDER" });
    expect(f.ai.calls).toBe(0);
    expect(f.database.briefRevisionHistory.size).toBe(0);
    expect(f.database.briefRevisionAttempts.size).toBe(1);
  });
});
