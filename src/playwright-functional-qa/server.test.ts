import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FOUNDATION_PACKAGE_JSON } from "../implementation-agent/foundation-policy";
import { PlaywrightBrowserRunner } from "./browser";
import { FunctionalQaPlanSchema } from "./contracts";
import { FunctionalQaService } from "./service";
import { NodeLocalTestServer, chooseLoopbackPort, waitForLocalReadiness, waitForLocalReadinessWithMetadata } from "./server";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const checksum = "a".repeat(64);

describe("generated foundation to local QA server contract", () => {
  it("launches the generated application on the allocated port and terminates cleanly", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".qa-foundation-"));
    const workspace = path.join(root, "project");
    const server = new NodeLocalTestServer();
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "package.json"), FOUNDATION_PACKAGE_JSON);
    await cp(path.join(process.cwd(), ".next"), path.join(workspace, ".next"), { recursive: true });
    await symlink(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const port = await chooseLoopbackPort();
    const handle = await server.start({ workspacePath: workspace, port });
    try {
      expect(handle.pid).toBeGreaterThan(0);
      expect(handle.port).toBe(port);
      expect(handle.lifecycle).toMatchObject({ commandIdentity: `npm run start:test -- --hostname 127.0.0.1 --port ${port}`, hostname: "127.0.0.1", cliPort: port, envPort: port, readinessRoute: "/" });
      expect(await waitForLocalReadiness(handle.baseUrl, handle.port, "/", 30000)).toBeLessThan(500);
    } finally {
      await server.stop(handle);
      expect(await server.isRunning(handle)).toBe(false);
      await rm(root, { recursive: true, force: true });
    }
  }, 45000);

  it("runs a real browser scenario through the production Functional QA boundary", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".qa-foundation-"));
    const workspace = path.join(root, "project");
    const server = new NodeLocalTestServer();
    const browser = new PlaywrightBrowserRunner();
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "package.json"), FOUNDATION_PACKAGE_JSON);
    await cp(path.join(process.cwd(), ".next"), path.join(workspace, ".next"), { recursive: true });
    await symlink(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    const plan = FunctionalQaPlanSchema.parse({ planId: "33333333-3333-4333-8333-333333333333", projectId, projectVersion: 1, scenarios: [{ scenarioId: "route:home", title: "Home route", actor: "Visitor", purpose: "Load home", acceptanceCriteriaReferences: ["acceptance:home"], requirementReferences: ["requirement:home"], userFlowReferences: [], startRoute: "/", preconditions: [], steps: [{ order: 1, action: "navigate", route: "/", timeoutMs: 10000 }, { order: 2, action: "assertStatus", expectedStatus: 200, timeoutMs: 10000 }, { order: 3, action: "assertUrl", expectedUrl: "/", timeoutMs: 10000 }], assertions: [{ category: "route", expected: "Home returns 200", mandatory: true }], expectedOutcome: "Home loads", failureCategory: "QA_ROUTE_MISSING", requiresAuth: false, requiresForm: false, requiresDatabaseFixture: false, timeoutMs: 30000 }], selectedBriefChecksum: checksum, selectedPlanningChecksum: checksum, selectedDesignChecksum: checksum, policyVersion: "playwright-functional-v1" });
    try {
      const report = await new FunctionalQaService(server, browser).run({ projectId, projectVersion: 1, taskId, workspacePath: workspace, generatedProjectsRoot: root, runtimeValidation: { overallStatus: "passed", validationRunId: "44444444-4444-4444-8444-444444444444", packageChecksum: checksum, lockfileChecksum: checksum }, plan, readiness: { mutable: true, task: { id: taskId, taskType: "validate-functional-flow", status: "ready", allowedTools: ["Playwright-functional"] }, expectedBriefChecksum: checksum, expectedPlanningChecksum: checksum, expectedDesignChecksum: checksum, actualBriefChecksum: checksum, actualPlanningChecksum: checksum, actualDesignChecksum: checksum, blockingImplementationTask: false, fixturesAvailable: true } });
      expect(report.status).toBe("passed");
      expect(report.passedCount).toBe(1);
      expect(report.runLevelDiagnostic).toBeUndefined();
      expect(report.scenarios[0]).toMatchObject({ scenarioId: "route:home", route: "/", status: "passed" });
    } finally {
      await browser.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);
  it("classifies an exited launcher before HTTP readiness instead of waiting for the deadline", async () => { await expect(waitForLocalReadinessWithMetadata("http://127.0.0.1:1", 1, "/", 5000, undefined, { isAlive: async () => false })).rejects.toMatchObject({ code: "QA_SERVER_RUNTIME_FAILED" }); });
  it("rejects a QA workspace without a production build before spawning", async () => { const root = await mkdtemp(path.join(process.cwd(), ".qa-foundation-")); try { await mkdir(path.join(root, "project"), { recursive: true }); await writeFile(path.join(root, "project", "package.json"), FOUNDATION_PACKAGE_JSON); await expect(new NodeLocalTestServer().start({ workspacePath: path.join(root, "project"), port: await chooseLoopbackPort() })).rejects.toMatchObject({ code: "QA_SERVER_BUILD_NOT_FOUND" }); } finally { await rm(root, { recursive: true, force: true }); } });
  it("keeps readiness bounded when an alive process never answers", async () => { const started = Date.now(); await expect(waitForLocalReadinessWithMetadata("http://127.0.0.1:1", 1, "/", 250, undefined, { isAlive: async () => true })).rejects.toMatchObject({ code: "QA_SERVER_READY_TIMEOUT" }); expect(Date.now() - started).toBeLessThan(2000); });
});
