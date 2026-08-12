import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { FOUNDATION_PACKAGE_JSON } from "../src/agents/implementation/foundation-policy";
import type { WorkbenchProjection } from "../src/runtime/workbench/contracts";
import { chooseLoopbackPort, NodeLocalTestServer, waitForLocalReadiness } from "../src/runtime/qa";

const projectId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const syntheticPrompt = "Create a synthetic local test business website with a home page and contact path.";

const landing: WorkbenchProjection = {
  mode: "NEW_PROJECT",
  status: { label: "New project", detail: "Describe what you want to build.", stage: "Lead", pendingUserAction: "", allowedActions: [], canCompose: true },
  questions: [], dependencies: [], designs: [], conversation: [], projects: [],
};

function projectProjection(answered: boolean): WorkbenchProjection {
  return {
    mode: "PROJECT_WORKBENCH",
    project: { projectId, name: "Synthetic local test business", slug: "synthetic-local-test-business", promptPreview: syntheticPrompt, workflowState: "CLARIFYING", rowVersion: answered ? 3 : 1, projectVersion: 1 },
    status: { label: "Lead is clarifying", detail: answered ? "Lead resumed the same project." : "Answer the required questions before the Brief.", stage: "Lead", pendingUserAction: "ANSWER_LEAD_CLARIFICATIONS", allowedActions: ["ANSWER_LEAD_CLARIFICATIONS"], canCompose: true },
    questions: [{ id: questionId, requirementKey: "business-purpose", category: "business", question: "What is the synthetic business purpose?", blocking: true, required: true, answerStatus: answered ? "answered" : "unresolved", ...(answered ? { answer: "A synthetic local test business." } : {}) }],
    dependencies: [], designs: [], conversation: [{ entryId: "request", actor: "USER", kind: "MESSAGE", title: "Project request", text: syntheticPrompt }, { entryId: "clarification", actor: "FACTORY", kind: "CLARIFICATION", title: "Lead clarification", text: answered ? "0 question(s) remain before the Brief can be prepared." : "1 question(s) remain before the Brief can be prepared.", status: "current" }],
    projects: [{ projectId, name: "Synthetic local test business", slug: "synthetic-local-test-business", workflowState: "CLARIFYING", statusLabel: "Lead is clarifying", updatedAt: "2026-08-12T00:00:00.000Z" }],
  };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-playwright-smoke-"));
  const workspace = path.join(root, "fixture");
  const server = new NodeLocalTestServer();
  let browser: Browser | undefined;
  let handle: Awaited<ReturnType<NodeLocalTestServer["start"]>> | undefined;
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "package.json"), FOUNDATION_PACKAGE_JSON);
    await cp(path.join(process.cwd(), ".next"), path.join(workspace, ".next"), { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
    await symlink(path.join(process.cwd(), "node_modules"), path.join(workspace, "node_modules"), "junction");
    handle = await server.start({ workspacePath: workspace, port: await chooseLoopbackPort() });
    await waitForLocalReadiness(handle.baseUrl, handle.port);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push("console error"); });
    page.on("pageerror", () => errors.push("page error"));
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.protocol !== "http:" || requestUrl.hostname !== "127.0.0.1" || requestUrl.port !== String(handle?.port)) { await route.abort(); return; }
      await route.continue();
    });
    await page.route(`${handle.baseUrl}/api/workbench`, async (route) => {
      const body = route.request().postData() ?? "";
      const request = JSON.parse(body) as { action?: string };
      const data = request.action === "create" ? projectProjection(false) : request.action === "respond" ? projectProjection(true) : landing;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
    });
    const response = await page.goto(`${handle.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
    if (!response || response.status() >= 500) throw new Error("local Factory page returned a server error");
    await page.locator('textarea[aria-label="Project request"]').waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(500);
    await page.locator('textarea[aria-label="Project request"]').fill(syntheticPrompt);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.locator("h1").getByText("Synthetic local test business", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("article.conversation-entry").getByText("Lead clarification", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("article.conversation-entry").getByText("1 question(s) remain", { exact: false }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("section.question-card textarea").fill("A synthetic local test business.");
    await page.getByRole("button", { name: "Send answers to Lead" }).click();
    await page.locator(".stage-copy").getByText("Lead resumed the same project.", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    if (await page.getByText("Start implementation", { exact: true }).count() !== 0) throw new Error("implementation started during Lead clarification");
    if (errors.length) throw new Error(`browser reported ${errors.length} safe error(s)`);
    console.log(JSON.stringify({ status: "passed", flow: "landing-create-lead-clarification-resume", synthetic: true, implementationStarted: false }));
  } catch (error) {
    console.error(`WORKBENCH_PLAYWRIGHT_SMOKE_FAILED: ${error instanceof Error ? error.message : "safe failure"}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    if (handle) await server.stop(handle).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

void main();
