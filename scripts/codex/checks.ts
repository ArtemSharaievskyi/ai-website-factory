import type { SafeProcessResult } from "./process";
import { runNpm } from "./process";

export type ControlledCheckId =
  | "typecheck"
  | "lint"
  | "architecture"
  | "provider-contracts"
  | "openai-tests"
  | "lead-provider-tests"
  | "brief-tests"
  | "brief-revision-certification"
  | "brief-revision-tests"
  | "lead-tests"
  | "trial-entry-production-tests"
  | "workbench-tests"
  | "route-tests"
  | "persistence-tests"
  | "db-validation"
  | "db-integrity"
  | "db-verify"
  | "asset-tests"
  | "context-lossless"
  | "tooling-tests";

export type ControlledCheckResult = {
  id: ControlledCheckId;
  label: string;
  passed: boolean;
  code: string;
  knownProductDefects?: string[];
};

type CommandCheck = { label: string; kind: "command"; args: readonly string[] };
type InternalCheck = { label: string; kind: "provider-contracts" };

export const CONTROLLED_CHECKS: Record<ControlledCheckId, CommandCheck | InternalCheck> = {
  typecheck: { label: "Typecheck", kind: "command", args: ["run", "typecheck"] },
  lint: { label: "Lint", kind: "command", args: ["run", "lint"] },
  architecture: { label: "Architecture boundaries", kind: "command", args: ["run", "check:architecture"] },
  "provider-contracts": { label: "Provider contracts", kind: "provider-contracts" },
  "openai-tests": { label: "OpenAI tests", kind: "command", args: ["run", "test", "--", "src/integrations/openai/provider.test.ts", "src/integrations/openai-v3/brief-v3-provider-contract.test.ts"] },
  "lead-provider-tests": { label: "Lead/provider tests", kind: "command", args: ["run", "test", "--", "src/agents/lead/lead.test.ts", "src/runtime/trial-entry/service.test.ts"] },
  "brief-tests": { label: "Brief tests", kind: "command", args: ["run", "test", "--", "src/domain/requirements/v3/certification.test.ts"] },
  "brief-revision-certification": { label: "Brief Revision V3 certification", kind: "command", args: ["run", "test:brief-revision:certify"] },
  "brief-revision-tests": { label: "Brief revision tests", kind: "command", args: ["run", "test", "--", "src/runtime/workbench/brief-revision-production-trace.test.ts", "src/runtime/workbench/brief-revision-lossless.test.ts", "src/runtime/workbench/brief-revision-idempotency.test.ts"] },
  "lead-tests": { label: "Lead tests", kind: "command", args: ["run", "test", "--", "src/agents/lead/lead.test.ts", "src/agents/lead/lead-analysis-repair.test.ts", "src/agents/lead/memory.test.ts"] },
  "trial-entry-production-tests": { label: "Trial Entry tests", kind: "command", args: ["run", "test", "--", "src/runtime/trial-entry/service.test.ts", "src/runtime/trial-entry/sequential-clarification-idempotency.test.ts", "src/runtime/trial-entry/cli-boundary.test.ts"] },
  "workbench-tests": { label: "Workbench tests", kind: "command", args: ["run", "test", "--", "src/runtime/workbench/workbench.test.ts", "src/runtime/workbench/respond-contract.test.ts", "src/runtime/workbench/respond-ux.test.ts", "src/runtime/workbench/brief-revision-production-trace.test.ts"] },
  "route-tests": { label: "Workbench route tests", kind: "command", args: ["run", "test", "--", "src/app/api/workbench/route.test.ts", "src/runtime/workbench/diagnostics.test.ts"] },
  "persistence-tests": { label: "Persistence tests", kind: "command", args: ["run", "test", "--", "src/persistence/database/persistence.test.ts", "src/persistence/database/postgres.test.ts", "src/persistence/database/migration-evidence.test.ts"] },
  "db-validation": { label: "DB migration validation", kind: "command", args: ["run", "db:validate"] },
  "db-integrity": { label: "DB migration integrity", kind: "command", args: ["run", "db:test-integrity"] },
  "db-verify": { label: "DB verification", kind: "command", args: ["run", "db:verify"] },
  "asset-tests": { label: "Asset tests", kind: "command", args: ["run", "test", "--", "src/runtime/assets/service.test.ts", "src/runtime/workbench/asset-upload.test.ts", "src/runtime/trial-entry/lead-asset-context.test.ts"] },
  "context-lossless": { label: "Context losslessness", kind: "command", args: ["run", "test", "--", "src/runtime/context/lossless-context.test.ts"] },
  "tooling-tests": { label: "Codex tooling tests", kind: "command", args: ["run", "test", "--", "src/runtime/codex/tooling.test.ts", "src/runtime/codex/task-envelope.test.ts", "src/runtime/codex/architecture.test.ts"] },
};

export const controlledCheckIds = () => Object.keys(CONTROLLED_CHECKS) as ControlledCheckId[];
export const isControlledCheckId = (value: string): value is ControlledCheckId => value in CONTROLLED_CHECKS;

export async function runControlledCheck(id: ControlledCheckId, root: string): Promise<ControlledCheckResult> {
  const definition = CONTROLLED_CHECKS[id];
  if (definition.kind === "provider-contracts") {
    const { runProviderContractGuard } = await import("./check-provider-contracts");
    const result = await runProviderContractGuard({ emit: false });
    return { id, label: definition.label, passed: result.passed, code: result.passed ? "PASS" : result.failures.map((failure) => failure.code).join(",") || "PROVIDER_CONTRACT_FAILED", knownProductDefects: result.knownProductDefects };
  }
  const result: SafeProcessResult = await runNpm(root, definition.args);
  return { id, label: definition.label, passed: result.code === 0, code: result.code === 0 ? "PASS" : `EXIT_${result.code}` };
}

export async function runControlledChecks(ids: readonly ControlledCheckId[], root: string) {
  const results: ControlledCheckResult[] = [];
  for (const id of ids) results.push(await runControlledCheck(id, root));
  return results;
}

export const requiredChecksPassed = (results: readonly ControlledCheckResult[]) => results.every((result) => result.passed);
