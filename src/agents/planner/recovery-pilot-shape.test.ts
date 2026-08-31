import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { OpenAiPlannerProvider, createPlanningRecoveryPromptContext } from "@/integrations/openai/adapters";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { readAiProviderConfig } from "@/integrations/openai/config";
import { createGitSourceCurrentnessPort, createStaticSourceCurrentnessPort } from "@/runtime/source-head";
import { FakePlannerMemoryPort } from "./memory";
import { PlanningRecoveryService } from "./recovery";
import { createCanonicalPlanningRouteManifest, createPlanningOwnedRequirementManifest } from "./recovery-manifests";

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
if (process.env.PLANNING_RECOVERY_REQUIRE_LIVE_PILOT === "true" && (!databaseUrl || !pilotProjectId)) throw new Error("PLANNING_RECOVERY_LIVE_PILOT_CONFIGURATION_REQUIRED");
const describePilot = describe.skipIf(!databaseUrl || !pilotProjectId);

function configuredProviderModel() {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*OPENAI_MODEL\s*=/.test(candidate));
    const value = line?.replace(/^\s*OPENAI_MODEL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  throw new Error("OPENAI_MODEL_REQUIRED_FOR_LOCAL_PROVIDER_BOUNDARY_TEST");
}

describePilot("Haus & Garten Service Planning Recovery pilot shape", () => {
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const database = new PostgresPersistenceDatabase(pool);

  afterAll(async () => pool.end());

  it("derives the certified 11-route MULTI_PAGE and 118 Planning-owned requirement shape from the current Brief", async () => {
    const state = await database.transaction(async (tx) => ({
      project: await tx.getProject(pilotProjectId!),
      version: await tx.getVersion(pilotProjectId!, 1),
      briefRow: await tx.getDocument(pilotProjectId!, 1, "brief-v3"),
    }));
    expect(state.project).toMatchObject({ id: pilotProjectId, current_version: 1, workflow_state: "AWAITING_DESIGN_SELECTION", row_version: 15 });
    expect(state.version).toMatchObject({ versionNumber: 1, state: "DRAFT" });
    expect(state.briefRow).toBeTruthy();
    const brief = BriefV3DocumentSchema.parse(mapRowToDocument(state.briefRow!));
    const routeManifest = createCanonicalPlanningRouteManifest(brief.brief);
    const requirementManifest = createPlanningOwnedRequirementManifest(brief.brief);

    expect(routeManifest.routePolicy).toBe("MULTI_PAGE");
    expect(routeManifest.routes).toHaveLength(11);
    expect(routeManifest.routes.map((route) => route.path)).toEqual([
      "/datenschutz",
      "/einsatzgebiet",
      "/footer",
      "/header-navigation",
      "/hero",
      "/impressum",
      "/kontakt",
      "/leistungen",
      "/so-funktioniert-es",
      "/ueber-uns",
      "/vorteile",
    ]);
    expect(routeManifest.routes.map((route) => route.path)).not.toContain("/");
    expect(routeManifest.routes.map((route) => route.path)).not.toContain("/#kontakt");
    expect(requirementManifest.requirements).toHaveLength(118);
    expect(requirementManifest.requirements.map((entry) => entry.requirementId)).toEqual(expect.arrayContaining([
      "REQUIREMENT:v3-3f2c7ef23496aad4105640e2518751f5a584903a08aeb6348b334dd2a8ba484e",
      "REQUIREMENT:v3-a9fea3b4a2f500a53b942e2113c6fa649f8a47bfa52704f55a9f6898ae63d93f",
    ]));
  });

  it("constructs the current 11-route/118-slot recovery request before the network boundary", async () => {
    const observedSource = await createGitSourceCurrentnessPort().read();
    const recovery = new PlanningRecoveryService({
      database,
      memory: new FakePlannerMemoryPort(),
      provider: { planRecovery: async () => { throw new Error("synthetic provider must not be called by prepare"); } },
      source: createStaticSourceCurrentnessPort(observedSource.head),
      hostRecoveryEnabled: true,
    });
    const prepared = await recovery.prepare({ projectId: pilotProjectId!, projectVersion: 1, operationKey: "provider-boundary-local-shape" });
    expect(prepared.eligibility).toMatchObject({ eligible: true, planningOwnedRequirementCount: 118 });
    expect(prepared.providerInput).toBeDefined();
    const input = prepared.providerInput!;
    expect(input.currentPlanningEvidence).toMatchObject({ rowVersion: 10, accepted: false });
    expect(input.canonicalRouteManifest.routes).toHaveLength(11);
    expect(input.planningRequirementManifest.requirements).toHaveLength(118);

    const compact = createPlanningRecoveryPromptContext(input);
    expect(compact.canonicalRouteManifest.routes).toHaveLength(11);
    expect(compact.planningRequirementManifest.requirements).toHaveLength(118);
    expect(compact.canonicalBrief).not.toHaveProperty("pages");
    const planningIds = new Set(input.planningRequirementManifest.requirements.map((entry) => entry.requirementId));
    expect((compact.canonicalBrief.requirements as Array<{ id: string }>).some((entry) => planningIds.has(entry.id))).toBe(false);
    const serializedCompact = JSON.stringify(compact);
    expect(serializedCompact).toContain('"position":117');
    expect(Buffer.byteLength(serializedCompact, "utf8")).toBeLessThan(input.contextPolicy.maxBytes);

    let capturedRequest: Record<string, unknown> | undefined;
    const parse = vi.fn(async (request: Record<string, unknown>) => {
      capturedRequest = request;
      throw Object.assign(new Error("network boundary intentionally stopped"), { code: "ECONNRESET" });
    });
    const config = readAiProviderConfig({ OPENAI_API_KEY: "synthetic-provider-key", OPENAI_MODEL: configuredProviderModel(), OPENAI_MAX_RETRIES: "0", OPENAI_MAX_CONCURRENT_REQUESTS: "1" });
    const provider = new OpenAiPlannerProvider(new OpenAiStructuredClient(config, { client: { chat: { completions: { parse } } } as never }));
    await expect(provider.planRecovery(input)).rejects.toMatchObject({ code: "AI_NETWORK_ERROR", diagnostic: { stage: "api_request", requestAttempted: true, apiResponseReceived: false }, failureDiagnostic: { category: "NETWORK", stage: "REQUEST_TRANSPORT", requestAttempted: true, responseReceived: false, schemaName: "planning-recovery-package" } });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(capturedRequest).toBeDefined();
    const responseFormat = capturedRequest!.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
    expect(responseFormat).toMatchObject({ type: "json_schema", json_schema: { name: "planning-recovery-package", strict: true } });
    expect(() => JSON.stringify(capturedRequest)).not.toThrow();
    const userMessage = (capturedRequest!.messages as Array<{ role?: string; content?: unknown }>).find((message) => message.role === "user");
    expect(userMessage?.content).toEqual(expect.stringContaining("planning-recovery-full-package"));
    expect(() => JSON.stringify(responseFormat.json_schema.schema)).not.toThrow();
  });
});

if (!databaseUrl || !pilotProjectId) console.log("PLANNING RECOVERY PILOT SHAPE: SKIPPED (DATABASE_URL or PLANNING_RECOVERY_PILOT_PROJECT_ID unavailable)");
