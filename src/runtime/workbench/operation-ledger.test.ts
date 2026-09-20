import { describe, expect, it, vi } from "vitest";
import { migrateV1ToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate-v1";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { pilotShapedV1Brief } from "@/domain/requirements/v3/fixtures";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { WorkbenchApplication } from "./application";
import { workbenchFailureResponse } from "./diagnostics";
import { WorkbenchOperationFailure } from "./operation-context";
import { legacyWorkbenchPlanningIntentHash, readWorkbenchPlanningAttempt, WorkbenchOperationLedger, safeOperationFingerprint, workbenchPlanningIntentHash } from "./operation-ledger";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { AiProviderError } from "@/integrations/openai/errors";
import { PersistenceError } from "@/persistence/database/errors";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";
import { z } from "zod";

const projectId = "47474747-4747-4474-8474-474747474747";
const timestamp = "2026-09-09T00:00:00.000Z";

async function approvedPlanningFixture() {
  const database = new InMemoryPersistenceDatabase();
  const project = { schemaVersion: 1 as const, documentType: "factory-project" as const, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-ledger-boundary", origin: "TEST" as const, siteLanguage: "en" as const, originalPrompt: "Synthetic ledger boundary fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" as const };
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "48484848-4848-4484-8484-484848484848", projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: "a".repeat(64), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const canonicalBrief = migrateV1ToCanonicalBriefV3(pilotShapedV1Brief);
  const briefChecksum = canonicalBriefChecksum(canonicalBrief);
  const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: briefDocument.briefChecksum } });
  await new DocumentRepository(database).save(RequirementSpecificationSchema.parse({ ...pilotShapedV1Brief, projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp }));
  const planner = { planApprovedProject: vi.fn().mockRejectedValue(new Error("PRIVATE_PROVIDER_PAYLOAD DATABASE_URL=secret")), acceptPlanningPackage: vi.fn() };
  const empty = {} as never;
  const entry = {} as never;
  const app = new WorkbenchApplication({ database, entry, getWorkflowScope: () => ({ planner, architectureReviewer: empty, design: empty, orchestrator: empty, contractAuditor: empty } as never) });
  return { database, app, briefChecksum, planner };
}

describe("durable Workbench Planning operation envelope", () => {
  it("wraps a raw Planner initialization fault at the real Workbench boundary", async () => {
    const fixture = await approvedPlanningFixture();
    let failure: unknown;
    try {
      await fixture.app.handle({ action: "generate-planning", projectId });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkbenchOperationFailure);
    const response = workbenchFailureResponse(failure, { action: "generate-planning", projectId });
    expect(response.status).toBe(500);
    expect(response.response).toMatchObject({
      code: "WORKBENCH_INTERNAL_ERROR",
      operationId: `workbench-planning:${projectId}`,
      operationKind: "PLANNING_GENERATION",
      phase: "PLANNING",
      operationStage: "OPERATION_INITIALIZATION",
      stage: "OPERATION_INITIALIZATION",
      failureClass: "UNEXPECTED_EXCEPTION",
      outerCode: "WORKBENCH_INTERNAL_ERROR",
      providerCallsTotal: 0,
      canonicalPlanningPersisted: false,
      lifecycleMutated: false,
      internalClassification: "UNEXPECTED_EXCEPTION",
    });
    expect(response.response.safeErrorFingerprint).toMatch(/^Error@OPERATION_INITIALIZATION:[a-f0-9]{16}$/);
    expect(JSON.stringify(response.response)).not.toMatch(/PRIVATE_PROVIDER_PAYLOAD|DATABASE_URL=secret/);
    expect((await new DocumentRepository(fixture.database).get(projectId, 1, "planning-package"))).toBeNull();
    expect(fixture.briefChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("counts one transport boundary even when the client and adapter both mark it", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await ledger.reserve();
    const invocation = await ledger.reserveInvocation({ stage: "decomposition", providerContract: "planning-decomposition-v1" });
    await invocation.beforeTransport();
    await invocation.beforeTransport();
    await invocation.responseReceived();
    await invocation.parsePassed();
    await invocation.admissionPassed();
    expect(ledger.snapshot()).toMatchObject({ providerCallsTotal: 1, providerCallsByStage: { decomposition: { attempted: 1, started: 1, responseReceived: 1, structuredParsePassed: 1, semanticAdmissionPassed: 1, completed: 1, failed: 0 }, coverage: { attempted: 0 } }, providerInvocationState: "ADMISSION_PASSED" });
  });

  it("differentiates bounded transport fingerprints without including provider details", () => {
    const diagnostic = (transportPhase: "DNS" | "CONNECT", transportFailureClass: "DNS_RESOLUTION_FAILED" | "CONNECT_FAILED", transportCauseCode: "ENOTFOUND" | "ECONNREFUSED") => ProviderFailureDiagnosticSchema.parse({ version: 1, category: "NETWORK", stage: "REQUEST_TRANSPORT", requestAttempted: true, responseReceived: false, structuredParsingReached: false, retryabilityHint: true, provider: "openai", model: "synthetic-model", errorCode: "AI_NETWORK_ERROR", schemaName: "planning-decomposition-v4", transportPhase, transportFailureClass, transportCauseCode });
    const dns = new AiProviderError("AI_NETWORK_ERROR", "private DNS failure", undefined, undefined, diagnostic("DNS", "DNS_RESOLUTION_FAILED", "ENOTFOUND"));
    const connect = new AiProviderError("AI_NETWORK_ERROR", "private connect failure", undefined, undefined, diagnostic("CONNECT", "CONNECT_FAILED", "ECONNREFUSED"));
    const dnsFingerprint = safeOperationFingerprint(dns, "PROVIDER_TRANSPORT");
    const connectFingerprint = safeOperationFingerprint(connect, "PROVIDER_TRANSPORT");
    expect(dnsFingerprint).not.toBe(connectFingerprint);
    expect(dnsFingerprint).toMatch(/^AiProviderError@PROVIDER_TRANSPORT:[a-f0-9]{16}$/);
    expect(dnsFingerprint).not.toContain("private");
  });

  it("keeps a pre-transport failure at zero provider calls", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await ledger.reserve();
    const invocation = await ledger.reserveInvocation({ stage: "coverage", providerContract: "planning-coverage-v1" });
    await invocation.failed();
    expect(ledger.snapshot()).toMatchObject({ providerCallsTotal: 0, providerCallsByStage: { coverage: { attempted: 0, started: 0, failed: 1 } }, providerInvocationState: "FAILED" });
    const failure = await ledger.fail(new Error("private transport setup"));
    expect(failure.details.providerCallsTotal).toBe(0);
    expect(failure.details.safeErrorFingerprint).not.toContain("private");
  });

  it("does not claim an unchanged project after the mutation boundary", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await ledger.reserve();
    await ledger.markCanonicalPlanningPersisted();
    const failure = await ledger.fail(new Error("post-commit projection failure"));
    expect(failure.details).toMatchObject({ canonicalPlanningPersisted: true, lifecycleMutated: true });
    expect(failure.message).not.toContain("not changed");
  });

  it("blocks direct Planning approval while a staged operation remains active", async () => {
    const fixture = await approvedPlanningFixture();
    const row = fixture.database.projects.get(projectId);
    if (!row) throw new Error("synthetic project was not created");
    row.workflow_state = "AWAITING_PLANNING_APPROVAL";
    const ledger = new WorkbenchOperationLedger(fixture.database, projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: fixture.briefChecksum });
    await ledger.reserve();
    await expect(fixture.app.handle({ action: "approve-planning", projectId })).rejects.toMatchObject({ code: "WORKBENCH_OPERATION_IN_PROGRESS" });
    expect(fixture.planner.acceptPlanningPackage).not.toHaveBeenCalled();
  });

  it("reports ambiguous persistence conservatively", async () => {
    const database = new InMemoryPersistenceDatabase();
    const ledger = new WorkbenchOperationLedger(database, projectId);
    await ledger.reserve();
    const failure = await ledger.fail(new PersistenceError("PERSISTENCE_COMMIT_AMBIGUOUS", "private commit acknowledgement"));
    expect(failure.details).toMatchObject({ outerCode: "PERSISTENCE_COMMIT_AMBIGUOUS", canonicalPlanningPersisted: true, lifecycleMutated: true });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId });
    expect(response.response.error).not.toContain("not changed");
    expect(response.status).toBe(503);
    const persisted = await database.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: projectId }));
    expect(persisted).toMatchObject({ status: "FAILED", result: { canonicalPlanningPersisted: true, lifecycleMutated: true } });
  });

  it("requires currentness before reserving a provider budget slot", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.reserve();
    await expect(ledger.reserveInvocation({ stage: "decomposition", providerContract: "planning-decomposition-v1" })).rejects.toThrow("WORKBENCH_PROVIDER_CONTEXT_UNBOUND");
    expect(ledger.snapshot().providerCallsTotal).toBe(0);
  });

  it("counts a synchronous provider failure at the client transport boundary", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await ledger.reserve();
    let executorCalls = 0;
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: "synthetic", modelLabel: "synthetic", maxRetries: 9, maxConcurrentRequests: 1 }, { executor: async () => { executorCalls += 1; throw new AiProviderError("AI_NETWORK_ERROR", "private provider response", undefined, { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, outputComplete: false, schemaName: "planning-decomposition-v1" }); } });
    await expect(client.request({ role: "planner", promptVersion: "test.v1", system: "bounded system", user: "bounded user", schemaName: "planning-decomposition-v1", schema: z.object({ ok: z.boolean() }), idempotencyKey: "synthetic-ledger-client", retryPolicy: { maxRetries: 9, corrections: 9 }, providerInvocation: { operationId: `workbench-planning:${projectId}`, correlationId: "49494949-4949-4494-8494-494949494949", stage: "decomposition", ledger } })).rejects.toBeDefined();
    expect(executorCalls).toBe(1);
    expect(ledger.snapshot()).toMatchObject({ providerCallsTotal: 1, providerCallsByStage: { decomposition: { attempted: 1, started: 1, responseReceived: 0, failed: 1 } }, providerInvocationState: "FAILED" });
  });

  it("persists provider termination metadata for completion and truncation without retaining raw output", async () => {
    const completedDatabase = new InMemoryPersistenceDatabase();
    const completedLedger = new WorkbenchOperationLedger(completedDatabase, projectId, `workbench-planning:${projectId}:completed`);
    await completedLedger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await completedLedger.reserve();
    const completedClient = new OpenAiStructuredClient({ apiKey: "synthetic", model: "synthetic", modelLabel: "synthetic", maxRetries: 0, maxConcurrentRequests: 1 }, {
      executor: async <T>() => ({ value: { ok: true } as T, requestId: "synthetic-complete", diagnostic: { stage: "api_response" as const, requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: true, tokenExhaustion: false, parsedPresent: true, finishReason: "stop", schemaName: "planning-decomposition-v4" } }),
    });
    await completedClient.request({ role: "planner", promptVersion: "test.v1", system: "bounded system", user: "bounded user", schemaName: "planning-decomposition-v4", schema: z.object({ ok: z.boolean() }), idempotencyKey: "synthetic-complete", retryPolicy: { maxRetries: 0, corrections: 0 }, providerInvocation: { operationId: `workbench-planning:${projectId}:completed`, correlationId: "49494949-4949-4494-8494-494949494949", stage: "decomposition", ledger: completedLedger } });
    const completed = await completedDatabase.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: projectId }));
    expect(completed).toMatchObject({ result: { providerTermination: { transportStatus: "RESPONSE_RECEIVED", parseStatus: "PASSED", responseReceived: true, finishReason: "stop", rawResponseRetained: false } } });

    const truncatedDatabase = new InMemoryPersistenceDatabase();
    const truncatedLedger = new WorkbenchOperationLedger(truncatedDatabase, projectId, `workbench-planning:${projectId}:truncated`);
    await truncatedLedger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await truncatedLedger.reserve();
    const truncatedClient = new OpenAiStructuredClient({ apiKey: "synthetic", model: "synthetic", modelLabel: "synthetic", maxRetries: 0, maxConcurrentRequests: 1 }, {
      executor: async () => { throw new AiProviderError("AI_OUTPUT_TRUNCATED", "synthetic truncation", undefined, { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, tokenExhaustion: true, parsedPresent: false, finishReason: "length", schemaName: "planning-decomposition-v4" }); },
    });
    await expect(truncatedClient.request({ role: "planner", promptVersion: "test.v1", system: "bounded system", user: "bounded user", schemaName: "planning-decomposition-v4", schema: z.object({ ok: z.boolean() }), idempotencyKey: "synthetic-truncated", retryPolicy: { maxRetries: 0, corrections: 0 }, providerInvocation: { operationId: `workbench-planning:${projectId}:truncated`, correlationId: "49494949-4949-4494-8494-494949494949", stage: "decomposition", ledger: truncatedLedger } })).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED" });
    const truncated = await truncatedDatabase.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: projectId }));
    expect(truncated).toMatchObject({ result: { providerTermination: { transportStatus: "RESPONSE_RECEIVED", parseStatus: "FAILED", responseReceived: true, finishReason: "length", outputComplete: false, tokenExhaustion: true, rawResponseRetained: false }, providerCallsByStage: { decomposition: { structuredParsePassed: 0 } } } });
    expect(JSON.stringify(truncated)).not.toContain("synthetic truncation");
  });

  it("does not allow durable ledger updates after terminal completion", async () => {
    const database = new InMemoryPersistenceDatabase();
    const ledger = new WorkbenchOperationLedger(database, projectId);
    await ledger.reserve();
    await ledger.complete();
    await expect(ledger.setStage("PREFLIGHT")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps currentness immutable and rejects stale attempt writes", async () => {
    const database = new InMemoryPersistenceDatabase();
    const first = new WorkbenchOperationLedger(database, projectId);
    const currentness = { projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) };
    await first.bindCurrentness(currentness);
    await expect(first.bindCurrentness({ ...currentness, rowVersion: 2 })).rejects.toThrow("WORKBENCH_CURRENTNESS_CONFLICT");
    await first.reserve();
    await first.fail(new Error("first attempt"));
    const second = new WorkbenchOperationLedger(database, projectId);
    await second.bindCurrentness(currentness);
    await second.reserve();
    await expect(first.setStage("PREFLIGHT")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("allows an explicit retry of a historical failed payload without rewriting its logical-row hash", async () => {
    const database = new InMemoryPersistenceDatabase();
    const currentness = { projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) };
    const operationId = `workbench-planning:${projectId}`;
    const historicalAttemptId = "11111111-1111-4111-8111-111111111111";
    const historical = { attemptId: historicalAttemptId, correlationId: "22222222-2222-4222-8222-222222222222", operationId, currentness, providerCallsTotal: 1, canonicalPlanningPersisted: false, lifecycleMutated: false };
    const historicalHash = legacyWorkbenchPlanningIntentHash(projectId, "approve-planning", null);
    expect(historicalHash).not.toBe(workbenchPlanningIntentHash(projectId, currentness));
    await database.transaction(async (tx) => {
      await tx.reserveOperation({ operation: "workbench.planning", key: projectId, payloadHash: historicalHash, initialResult: historical });
      await tx.failOperation({ operation: "workbench.planning", key: projectId, payloadHash: historicalHash, result: historical, leaseId: historicalAttemptId });
    });

    const retry = new WorkbenchOperationLedger(database, projectId, operationId, "33333333-3333-4333-8333-333333333333");
    await retry.bindCurrentness(currentness);
    expect(await retry.reserve()).toMatchObject({ status: "NEW", key: projectId });
    const failure = await retry.fail(new Error("synthetic retry failure"));
    expect(failure.details.attemptId).not.toBe(historicalAttemptId);

    const current = await database.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: projectId }));
    expect(current).toMatchObject({ status: "FAILED", payloadHash: historicalHash, result: { attemptId: failure.details.attemptId, currentness } });
    expect(await readWorkbenchPlanningAttempt(database, operationId, failure.details.attemptId!)).toMatchObject({ status: "FAILED", result: { attemptId: failure.details.attemptId, correlationId: "33333333-3333-4333-8333-333333333333" } });
  });

  it("keeps transient attempt metadata out of semantic idempotency while isolating attempt evidence", async () => {
    const database = new InMemoryPersistenceDatabase();
    const currentness = { projectVersion: 1, rowVersion: 1, briefChecksum: "b".repeat(64) };
    const first = new WorkbenchOperationLedger(database, projectId, `workbench-planning:${projectId}`, "44444444-4444-4444-8444-444444444444");
    await first.bindCurrentness(currentness);
    await first.reserve();
    const firstFailure = await first.fail(new Error("first attempt"));
    const second = new WorkbenchOperationLedger(database, projectId, `workbench-planning:${projectId}`, "55555555-5555-4555-8555-555555555555");
    await second.bindCurrentness(currentness);
    await second.reserve();
    const secondFailure = await second.fail(new Error("second attempt"));
    const firstRecord = await readWorkbenchPlanningAttempt(database, firstFailure.details.operationId, firstFailure.details.attemptId!);
    const secondRecord = await readWorkbenchPlanningAttempt(database, secondFailure.details.operationId, secondFailure.details.attemptId!);
    expect(firstRecord).toMatchObject({ status: "FAILED", result: { semanticIntentHash: workbenchPlanningIntentHash(projectId, currentness) } });
    expect(secondRecord).toMatchObject({ status: "FAILED", result: { semanticIntentHash: workbenchPlanningIntentHash(projectId, currentness) } });
    expect((firstRecord?.result as { attemptRequestHash?: string }).attemptRequestHash).not.toBe((secondRecord?.result as { attemptRequestHash?: string }).attemptRequestHash);
    expect(firstFailure.details.attemptId).not.toBe(secondFailure.details.attemptId);
  });

  it("fails closed when a failed attempt is bound to a changed Brief semantic checksum or row version", async () => {
    const database = new InMemoryPersistenceDatabase();
    const first = new WorkbenchOperationLedger(database, projectId);
    await first.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "c".repeat(64) });
    await first.reserve();
    await first.fail(new Error("historical failure"));

    const changedBrief = new WorkbenchOperationLedger(database, projectId);
    await changedBrief.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "d".repeat(64) });
    await expect(changedBrief.reserve()).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const changedRow = new WorkbenchOperationLedger(database, projectId);
    await changedRow.bindCurrentness({ projectVersion: 1, rowVersion: 2, briefChecksum: "c".repeat(64) });
    await expect(changedRow.reserve()).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("does not treat an unknown semantic payload as a retryable failed attempt", async () => {
    const database = new InMemoryPersistenceDatabase();
    const currentness = { projectVersion: 1, rowVersion: 1, briefChecksum: "f".repeat(64) };
    const historical = { attemptId: "66666666-6666-4666-8666-666666666666", currentness, providerCallsTotal: 0, canonicalPlanningPersisted: false, lifecycleMutated: false };
    const unknownHash = "0".repeat(64);
    await database.transaction(async (tx) => {
      await tx.reserveOperation({ operation: "workbench.planning", key: projectId, payloadHash: unknownHash, initialResult: historical });
      await tx.failOperation({ operation: "workbench.planning", key: projectId, payloadHash: unknownHash, result: historical, leaseId: historical.attemptId });
    });
    const retry = new WorkbenchOperationLedger(database, projectId);
    await retry.bindCurrentness(currentness);
    await expect(retry.reserve()).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("protects active and succeeded logical operations from duplicate execution", async () => {
    const activeDatabase = new InMemoryPersistenceDatabase();
    const currentness = { projectVersion: 1, rowVersion: 1, briefChecksum: "e".repeat(64) };
    const active = new WorkbenchOperationLedger(activeDatabase, projectId);
    await active.bindCurrentness(currentness);
    await active.reserve();
    const duplicate = new WorkbenchOperationLedger(activeDatabase, projectId);
    await duplicate.bindCurrentness(currentness);
    await expect(duplicate.reserve()).rejects.toMatchObject({ code: "WORKBENCH_OPERATION_IN_PROGRESS" });

    const succeededDatabase = new InMemoryPersistenceDatabase();
    const succeeded = new WorkbenchOperationLedger(succeededDatabase, projectId);
    await succeeded.bindCurrentness(currentness);
    await succeeded.reserve();
    await succeeded.complete();
    const replay = new WorkbenchOperationLedger(succeededDatabase, projectId);
    await replay.bindCurrentness(currentness);
    await expect(replay.reserve()).rejects.toMatchObject({ code: "WORKBENCH_OPERATION_REPLAY" });
  });

  it("returns a minimal response when failure serialization itself rejects", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.reserve();
    const failure = await ledger.fail(new Error("private serialization source"));
    const malformed = new WorkbenchOperationFailure({ ...failure.details, operationId: "invalid operation id" }, "private failure envelope", failure);
    const response = workbenchFailureResponse(malformed, { action: "approve-planning", projectId });
    expect(response.status).toBe(500);
    expect(response.response).toMatchObject({ code: "WORKBENCH_INTERNAL_ERROR", operation: "APPROVE_PLANNING", stage: "RESPONSE_SERIALIZATION", operationStage: "RESPONSE_SERIALIZATION", failureClass: "UNEXPECTED_EXCEPTION", providerCallsTotal: 0 });
    expect(response.response.safeErrorFingerprint).toMatch(/^WorkbenchOperationFailure@RESPONSE_SERIALIZATION:[a-f0-9]{16}$/);
    expect(JSON.stringify(response.response)).not.toContain("private serialization source");
  });

  it("sanitizes malformed correlation IDs in the final serialization fallback", async () => {
    const failure = await new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId).fail(new Error("private malformed correlation"));
    const malformed = new WorkbenchOperationFailure({ ...failure.details, correlationId: "not-a-uuid" } as never, "private failure envelope", failure);
    const response = workbenchFailureResponse(malformed, { action: "approve-planning", projectId });
    expect(response.status).toBe(500);
    expect(response.response.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.response.operationStage).toBe("RESPONSE_SERIALIZATION");
  });

  it("does not spend a provider call when response-schema preflight fails", async () => {
    const ledger = new WorkbenchOperationLedger(new InMemoryPersistenceDatabase(), projectId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: "a".repeat(64) });
    await ledger.reserve();
    const executor = vi.fn();
    const client = new OpenAiStructuredClient({ apiKey: "synthetic", model: "synthetic", modelLabel: "synthetic", maxRetries: 0, maxConcurrentRequests: 1 }, { executor });
    await expect(client.request({ role: "planner", promptVersion: "test.v1", system: "bounded system", user: "bounded user", schemaName: "invalid-optional-schema", schema: z.object({ optional: z.string().optional() }), providerInvocation: { operationId: `workbench-planning:${projectId}`, correlationId: "49494949-4949-4494-8494-494949494949", stage: "decomposition", ledger } })).rejects.toMatchObject({ code: "AI_REQUEST_SCHEMA_INVALID" });
    expect(executor).not.toHaveBeenCalled();
    expect(ledger.snapshot()).toMatchObject({ providerCallsTotal: 0, providerCallsByStage: { decomposition: { attempted: 0, started: 0, failed: 1 } } });
  });
});
