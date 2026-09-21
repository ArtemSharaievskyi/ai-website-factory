import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { classifyBaselineFailures, fingerprintFailure, type GuardFailure } from "../../../scripts/codex/baseline-failures";
import { evaluateProviderContract, runProviderContractGuard } from "../../../scripts/codex/check-provider-contracts";
import { resolveAffectedChecks } from "../../../scripts/codex/affected";
import { loadCheckMap, loadRegressionMap, parseCheckMap, parseRegressionMap, parseProviderContractRegistry } from "../../../scripts/codex/config";
import { CONTROLLED_CHECKS, requiredChecksPassed } from "../../../scripts/codex/checks";
import { loadArchitectureConfig } from "../../../scripts/codex/check-architecture";
import { changedFilesSince, isIgnored, readGitHead, untrackedFiles } from "../../../scripts/codex/git";
import { assertSessionStartAllowed, buildSession, compareProtectedSnapshot, isAllowedDerivedBriefReadinessDifference, loadSession, toProtectedSnapshot } from "../../../scripts/codex/protected-state";
import { verifyProductionPathEvidence } from "../../../scripts/codex/production-paths";

const projectId = "11111111-1111-4111-8111-111111111111";
const snapshot = (overrides: Record<string, unknown> = {}) => toProtectedSnapshot({ projectId, projectVersion: 1, rowVersion: 3, workflowState: "AWAITING_BRIEF_APPROVAL", pendingUserAction: "APPROVE_BRIEF_OR_REQUEST_CHANGES", operatorLanguage: "en", siteLanguage: "en", brief: { checksum: "a".repeat(64), approved: false, readyForApproval: true }, ...overrides });

describe("Codex Level 2 repository guards", () => {
  it("captures the current Git HEAD in a session baseline", async () => {
    const head = await readGitHead(process.cwd());
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(buildSession(head, [snapshot()], "2026-08-16T00:00:00.000Z", ["docs/admin/existing.md"])).toMatchObject({ baselineHead: head, baselineUntrackedFiles: ["docs/admin/existing.md"], protectedProjects: [{ projectId }] });
  });

  it("requires an explicit reset before replacing an active session", () => {
    expect(() => assertSessionStartAllowed(true, false)).toThrow("CODEX_SESSION_ACTIVE");
    expect(() => assertSessionStartAllowed(true, true)).not.toThrow();
    expect(() => assertSessionStartAllowed(false, false)).not.toThrow();
  });

  it("keeps the Codex session workspace ignored", async () => {
    expect(await isIgnored(process.cwd(), ".codex/session.json")).toBe(true);
  });

  it("does not turn baseline docs/admin evidence into affected work", async () => {
    const head = await readGitHead(process.cwd());
    const baseline = await untrackedFiles(process.cwd());
    expect(baseline.some((file) => file.startsWith("docs/admin/"))).toBe(true);
    expect((await changedFilesSince(process.cwd(), head, baseline)).some((file) => file.startsWith("docs/admin/"))).toBe(false);
  });

  it("normalizes Windows paths and maps affected checks without duplicates", async () => {
    const [checkMap, regressionMap] = await Promise.all([loadCheckMap(), loadRegressionMap()]);
    const result = resolveAffectedChecks(["src\\integrations\\openai\\client.ts", "src/integrations/openai/client.ts"], checkMap, regressionMap);
    expect(result.changedFiles).toEqual(["src/integrations/openai/client.ts"]);
    expect(result.checkIds).toContain("provider-contracts");
    expect(result.checkIds.filter((id) => id === "typecheck")).toHaveLength(1);
    expect(result.regressionIds).toContain("PROVIDER_STRICT_OPTIONALITY");
  });

  it("maps Brief, Workbench, persistence, and asset areas to real checks", async () => {
    const [checkMap, regressionMap] = await Promise.all([loadCheckMap(), loadRegressionMap()]);
    const result = resolveAffectedChecks(["src/domain/requirements/v3/reducer.ts", "src/runtime/workbench/application.ts", "src/persistence/database/repositories.ts", "src/runtime/assets/service.ts"], checkMap, regressionMap);
    expect(result.areas).toEqual(expect.arrayContaining(["Brief requirements", "Workbench", "Persistence", "Asset intake"]));
    expect(result.checkIds).toEqual(expect.arrayContaining(["brief-tests", "brief-revision-tests", "workbench-tests", "persistence-tests", "asset-tests", "db-validation", "db-integrity", "db-verify"]));
  });

  it("registers the single-authority guard against obsolete V2 Brief mutation imports", async () => {
    const config = await loadArchitectureConfig();
    expect(config.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "PRODUCTION_BRIEF_MUTATION_CANNOT_IMPORT_V2_MUTATION",
        sourcePrefixes: expect.arrayContaining(["src/runtime/brief-revision-v3/", "src/runtime/trial-entry/", "src/runtime/workbench/"]),
        forbiddenTargetPrefixes: expect.arrayContaining(["src/domain/requirements/revision.ts", "src/runtime/brief-revision-v3/v2-tripwire.ts"]),
      }),
    ]));
  });

  it("rejects unknown checks and regressions safely", () => {
    expect(() => parseCheckMap({ version: 1, defaultCheckIds: ["unknown-command"], rules: [] })).toThrow("CODEX_CONFIG_UNKNOWN_CHECK");
    expect(() => parseRegressionMap({ version: 1, regressions: [{ id: "UNKNOWN", pathPrefixes: ["src/"], checkIds: ["typecheck"], executable: true }] })).toThrow("CODEX_CONFIG_UNKNOWN_REGRESSION");
    expect(() => parseProviderContractRegistry({ version: 1, contracts: [{ id: "x", schemaName: "x", productionReference: "x", triggerPathPrefixes: ["src/"], command: "del *" }] })).not.toThrow();
  });

  it("uses code-owned controlled commands instead of JSON command fields", () => {
    expect(CONTROLLED_CHECKS.typecheck).toMatchObject({ kind: "command", args: ["run", "typecheck"] });
    expect(JSON.stringify(CONTROLLED_CHECKS)).not.toContain("del *");
  });

  it("reports a production schema construction failure as a failed guard", () => {
    const result = evaluateProviderContract({ id: "synthetic", schemaName: "synthetic", productionReference: "synthetic", triggerPathPrefixes: [] }, () => { throw new Error("schema construction failed"); });
    expect(result).toMatchObject({ passed: false, code: "REQUEST_SCHEMA_CONSTRUCTION_FAILED" });
  });

  it("runs the provider guard without network calls", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await runProviderContractGuard({ emit: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.failures.every((failure) => failure.fingerprint && failure.triggerPathPrefixes.length > 0)).toBe(true);
    fetch.mockRestore();
  });

  it("classifies baseline failures differentially without a configuration waiver", () => {
    const makeFailure = (fingerprint: string, triggerPathPrefixes = ["src/integrations/openai/"]): GuardFailure => ({ guardId: "provider-contracts", key: "planning-package", fingerprint, code: "HOST_OWNED_PROVIDER_FIELDS", triggerPathPrefixes });
    const baselineFailure = makeFailure(fingerprintFailure("provider-contracts", "planning-package", "HOST_OWNED_PROVIDER_FIELDS"));
    expect(classifyBaselineFailures([baselineFailure], [baselineFailure], ["docs/task.md"]).baselineFailures[0]?.reason).toBe("BASELINE_FAILURE");
    expect(classifyBaselineFailures([baselineFailure], [baselineFailure], ["src/integrations/openai/adapters.ts"]).blocking[0]?.reason).toBe("TOUCHED_BASELINE_FAILURE");
    const focusedFailure = { ...baselineFailure, affectedPathPrefixes: ["src/integrations/openai/adapters.ts"] };
    expect(classifyBaselineFailures([focusedFailure], [focusedFailure], ["src/integrations/openai/client.ts"]).baselineFailures[0]?.reason).toBe("BASELINE_FAILURE");
    expect(classifyBaselineFailures([focusedFailure], [focusedFailure], ["src/integrations/openai/adapters.ts"]).blocking[0]?.reason).toBe("TOUCHED_BASELINE_FAILURE");
    expect(classifyBaselineFailures([], [baselineFailure], ["docs/task.md"]).blocking[0]?.reason).toBe("NEW_FAILURE");
    const changed = makeFailure(fingerprintFailure("provider-contracts", "planning-package", "REQUEST_SCHEMA_CONSTRUCTION_FAILED"));
    expect(classifyBaselineFailures([baselineFailure], [changed], ["docs/task.md"]).blocking[0]?.reason).toBe("CHANGED_FINGERPRINT");
    expect(classifyBaselineFailures([baselineFailure], [], ["docs/task.md"]).resolved).toEqual([baselineFailure]);
    expect(() => parseProviderContractRegistry({ version: 1, knownFailures: ["planning-package"], contracts: [{ id: "planning-package", schemaName: "planning-package", productionReference: "production", triggerPathPrefixes: ["src/integrations/openai/"] }] })).toThrow("CODEX_PROVIDER_BASELINE_CONFIG_FORBIDDEN");
    expect(classifyBaselineFailures([], [baselineFailure], []).blocking[0]?.reason).toBe("NEW_FAILURE");
  });

  it("stores only safe protected snapshot fields", () => {
    const safe = toProtectedSnapshot({ projectId, projectVersion: 1, rowVersion: 3, workflowState: "AWAITING_BRIEF_APPROVAL", pendingUserAction: "APPROVE_BRIEF_OR_REQUEST_CHANGES", operatorLanguage: "en", siteLanguage: "en", brief: { checksum: "a".repeat(64), approved: false, readyForApproval: true }, originalPrompt: "customer prompt", clarification: { answer: "customer answer" }, assets: [{ path: "secret/path" }], secret: "secret" });
    expect(JSON.stringify(safe)).not.toContain("customer prompt");
    expect(JSON.stringify(safe)).not.toContain("customer answer");
    expect(JSON.stringify(safe)).not.toContain("secret/path");
    expect(safe).toEqual(snapshot());
  });

  it("passes an unchanged protected snapshot and detects row/version/checksum mutations", () => {
    expect(compareProtectedSnapshot(snapshot(), snapshot())).toEqual([]);
    expect(compareProtectedSnapshot(snapshot(), snapshot({ rowVersion: 4 }))).toEqual(expect.arrayContaining([expect.objectContaining({ field: "rowVersion", before: 3, after: 4 })]));
    expect(compareProtectedSnapshot(snapshot(), snapshot({ brief: { checksum: "b".repeat(64), approved: false, readyForApproval: true } }))).toEqual(expect.arrayContaining([expect.objectContaining({ field: "briefChecksum" })]));
  });

  it("allows only the intentional derived Brief readiness transition for the readiness repair", () => {
    const differences = compareProtectedSnapshot(snapshot({ brief: { checksum: "a".repeat(64), approved: false, readyForApproval: false } }), snapshot());
    const paths = ["src/domain/requirements/v3/readiness.ts", "src/runtime/trial-entry/service.ts", "src/runtime/workbench/application.ts"];
    expect(isAllowedDerivedBriefReadinessDifference(differences, paths)).toBe(true);
    expect(isAllowedDerivedBriefReadinessDifference([...differences, { ...differences[0]!, field: "rowVersion", before: 3, after: 4 }], paths)).toBe(false);
    expect(isAllowedDerivedBriefReadinessDifference(differences, paths.slice(0, 2))).toBe(false);
  });

  it("reports missing production-path evidence instead of accepting a unit test", async () => {
    const [present, missing] = await Promise.all([verifyProductionPathEvidence(process.cwd(), ["BRIEF_V3_MUTATION_PATH"]), verifyProductionPathEvidence(process.cwd(), ["NOT_REGISTERED"]) ]);
    expect(present[0]).toMatchObject({ present: true, code: "PASS" });
    expect(missing[0]).toMatchObject({ present: false, code: "FILE_MISSING" });
  });

  it("fails the verification condition when a required check fails", () => {
    expect(requiredChecksPassed([{ id: "typecheck", label: "Typecheck", passed: true, code: "PASS" }])).toBe(true);
    expect(requiredChecksPassed([{ id: "typecheck", label: "Typecheck", passed: false, code: "EXIT_1" }])).toBe(false);
  });

  it("handles a stale or missing session clearly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-session-test-"));
    try { await expect(loadSession(root)).rejects.toThrow("CODEX_SESSION_MISSING_RUN_START"); } finally { await rm(root, { recursive: true, force: true }); }
  });
});
