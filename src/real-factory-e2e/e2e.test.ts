import { describe, expect, it } from "vitest";
import { runRealFactoryE2E, VELOFIX_WERKSTATT_PROMPT, assertRealDependencies } from "./harness";
import { runRealFactoryE2EPreflight, safeSmokeProjectReference } from "./preflight";

describe("real Factory E2E safety boundary", () => {
  it("stays pending and makes no external checks without explicit opt-in", async () => {
    const result = await runRealFactoryE2EPreflight({ OPENAI_API_KEY: "should-not-be-read" });
    expect(result.status).toBe("pending");
    expect(result.blockers).toContain("REAL_FACTORY_E2E_OPT_IN_REQUIRED");
  });
  it("reports the precise mandatory provider blocker without exposing credentials", async () => {
    const result = await runRealFactoryE2EPreflight({ ALLOW_REAL_FACTORY_E2E: "true" }, { npmAvailable: true, chromiumAvailable: true, gitClean: true });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("REAL_E2E_OPENAI_NOT_CONFIGURED");
    expect(JSON.stringify(result)).not.toContain("should-not-be-read");
  });
  it("returns a bounded pending report", async () => {
    const preflight = await runRealFactoryE2EPreflight({});
    const report = await runRealFactoryE2E({ preflight, generatedProjectsRoot: "C:\\disposable" });
    expect(report.overallStatus).toBe("pending");
    expect(report.releaseEligible).toBe(false);
    expect(report.prohibitedActions.deployment).toBe(false);
  });
  it("keeps the synthetic prompt factual and production runtime explicit", () => {
    expect(VELOFIX_WERKSTATT_PROMPT).toContain("VeloFix Werkstatt");
    expect(VELOFIX_WERKSTATT_PROMPT).toContain("Do not invent");
    expect(() => assertRealDependencies(undefined, { status: "passed", optIn: true, blockers: [], warnings: [], integrations: { provider: "configured", context7: "not-needed", shadcn: "not-needed" } })).toThrow("REAL_E2E_PRODUCTION_RUNTIME_REQUIRED");
  });
  it("uses the full smoke identity for isolated generated-project ownership", () => {
    const smokeId = "11111111-1111-4111-8111-111111111111";
    expect(safeSmokeProjectReference("C:\\generated", smokeId)).toContain(`real-e2e-velofix-${smokeId}`);
  });
});
