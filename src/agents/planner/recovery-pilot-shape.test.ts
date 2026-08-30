import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
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
});

if (!databaseUrl || !pilotProjectId) console.log("PLANNING RECOVERY PILOT SHAPE: SKIPPED (DATABASE_URL or PLANNING_RECOVERY_PILOT_PROJECT_ID unavailable)");
