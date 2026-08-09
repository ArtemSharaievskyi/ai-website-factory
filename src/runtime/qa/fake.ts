import type { PlaywrightFunctionalRunner } from "./contracts";
import { FunctionalQaError } from "./errors";

export class DeterministicFakeBrowserRunner implements PlaywrightFunctionalRunner {
  readonly operations: string[] = []; private launched = false; private route = "/"; private readonly errors: Awaited<ReturnType<PlaywrightFunctionalRunner["readConsoleErrors"]>> = [];
  constructor(private readonly behavior: { failingAction?: string; externalRequest?: boolean; navigationStatus?: number } = {}) {}
  async launch() { this.launched = true; this.operations.push("launch"); if (this.behavior.externalRequest) this.errors.push({ kind: "external-request", safeSummary: "External browser request blocked.", safeErrorCode: "QA_EXTERNAL_REQUEST_BLOCKED", approvedNoise: false }); }
  private act(name: string) { if (!this.launched) throw new Error("fake browser not launched"); this.operations.push(name); if (this.behavior.failingAction === name) throw new FunctionalQaError("QA_ASSERTION_FAILED", `Fake action ${name} failed.`); }
  async navigate(route: string) { this.act(`navigate:${route}`); this.route = route; const status = this.behavior.navigationStatus ?? 200; if (status === 404) throw new FunctionalQaError("QA_ROUTE_MISSING", "The approved local route returned HTTP 404."); return status; }
  async fill(selector: string) { this.act(`fill:${selector}`); }
  async click(selector: string) { this.act(`click:${selector}`); }
  async submit(selector: string) { this.act(`submit:${selector}`); }
  async select(selector: string, value: string) { this.act(`select:${selector}:${value}`); }
  async check(selector: string) { this.act(`check:${selector}`); }
  async waitFor(input: { selector?: string }) { this.act(`waitFor:${input.selector ?? "timeout"}`); }
  async assertText(selector: string, expected: string) { this.act(`assertText:${selector}:${expected}`); }
  async assertVisible(selector: string) { this.act(`assertVisible:${selector}`); }
  async assertUrl(route: string) { this.act(`assertUrl:${route}`); if (route !== this.route) throw new FunctionalQaError("QA_ASSERTION_FAILED", "Fake route mismatch."); }
  async assertStatus(expected: number) { this.act(`assertStatus:${expected}`); if (expected !== 200) throw new FunctionalQaError("QA_ROUTE_RUNTIME_ERROR", "Fake status mismatch."); }
  async readConsoleErrors() { return this.errors; }
  async close() { this.operations.push("close"); this.launched = false; }
}
