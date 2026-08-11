import type { GeneratedProjectRuntimeValidator, RuntimeCommandResult, RuntimeReadiness, RuntimeValidationReport, RuntimeValidatorInput } from "@/runtime/validation/contracts";
import { TOOL_RESULT_MAX_BYTES, ToolResultSchema, type ToolId, type ToolResult } from "@/domain/tooling/schema";
import { getOperationDefinition, registeredToolOutputIsValid } from "./registry";

export type ControlledRuntimeOperation = "install-locked" | "npm-ci" | "lint" | "typecheck" | "unit-test" | "build";

const secretPattern = /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|CONTEXT7_API_KEY|NPM_TOKEN|API[_-]?KEY|CLIENT[_-]?SECRET|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN)\s*[:=]\s*["']?[^\s,}"']+["']?|Bearer\s+\S+)/gi;
const jsonSecretKeyPattern = /(\\?["'])((?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|CONTEXT7_API_KEY|NPM_TOKEN|API[_-]?KEY|CLIENT[_-]?SECRET|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN))\1\s*:\s*(\\?["'])(?:\\.|(?!\3)[^])*?\3/gi;
const configuredSecretNames = ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "CONTEXT7_API_KEY", "NPM_TOKEN"] as const;
const EXTERNAL_RESULT_PREVALIDATION_MAX_BYTES = 200_000;

export function redactToolText(value: string) {
  let redacted = value.replace(jsonSecretKeyPattern, (_match, quote: string, key: string, valueQuote: string) => `${quote}${key}${quote}: ${valueQuote}[REDACTED]${valueQuote}`).replace(secretPattern, "[REDACTED]");
  const configuredSecrets = configuredSecretNames.map((name) => process.env[name]).filter((secret): secret is string => Boolean(secret && secret.length >= 8)).sort((left, right) => right.length - left.length);
  for (const secret of configuredSecrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}

export function boundToolText(value: string, maxBytes = 16_000, maxLineBytes = 2_000) {
  const redacted = redactToolText(value);
  const sliceToBytes = (text: string, limit: number, fromEnd = false) => {
    const characters = [...text];
    const selected: string[] = [];
    let bytes = 0;
    const source = fromEnd ? characters.reverse() : characters;
    for (const character of source) {
      const characterBytes = Buffer.byteLength(character, "utf8");
      if (bytes + characterBytes > limit) break;
      selected.push(character);
      bytes += characterBytes;
    }
    return fromEnd ? selected.reverse().join("") : selected.join("");
  };
  const lines = redacted.split(/\r?\n/).map((line) => Buffer.byteLength(line, "utf8") > maxLineBytes ? `${sliceToBytes(line, Math.max(0, maxLineBytes - 3))}...` : line);
  const joined = lines.join("\n");
  if (Buffer.byteLength(joined, "utf8") <= maxBytes) return { value: joined, truncated: false, redactionApplied: redacted !== value };
  const marker = "\n...[TRUNCATED]...\n";
  const available = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  const prefix = sliceToBytes(joined, Math.ceil(available / 2));
  const suffix = sliceToBytes(joined, Math.floor(available / 2), true);
  return { value: `${prefix}${marker}${suffix}`, truncated: true, redactionApplied: redacted !== value };
}

function resultData(value: unknown, maxBytes: number) {
  const serialized = JSON.stringify(value) ?? "null";
  const envelopeReserve = 1_024;
  const bounded = boundToolText(serialized, Math.max(1, maxBytes - envelopeReserve), Math.max(1, maxBytes - envelopeReserve));
  if (bounded.truncated) return { data: { truncated: true, preview: bounded.value }, truncated: true, redactionApplied: bounded.redactionApplied };
  try {
    const structured = JSON.parse(bounded.value) as unknown;
    const data = { structured };
    if (Buffer.byteLength(JSON.stringify(data), "utf8") <= maxBytes) return { data, truncated: false, redactionApplied: bounded.redactionApplied };
  } catch {
    // Fall through to the bounded preview when redaction or truncation makes the structured form invalid.
  }
  const preview = boundToolText(serialized, Math.max(1, maxBytes - envelopeReserve), Math.max(1, maxBytes - envelopeReserve));
  return { data: { truncated: true, preview: preview.value }, truncated: true, redactionApplied: preview.redactionApplied };
}

function runtimeResultData(result: RuntimeCommandResult | RuntimeReadiness | RuntimeValidationReport) {
  if ("commandType" in result) return { commandType: result.commandType, passed: result.passed, safeFailureCode: result.safeFailureCode, diagnostics: result.diagnostics, sourceChecksum: result.sourceChecksum, validationRunId: result.validationRunId };
  if ("overallStatus" in result) return { overallStatus: result.overallStatus, validationRunId: result.validationRunId, commandResults: result.commandResults.map((command) => ({ commandType: command.commandType, passed: command.passed, safeFailureCode: command.safeFailureCode, sourceChecksum: command.sourceChecksum })), packageChecksum: result.packageChecksum, lockfileChecksum: result.lockfileChecksum };
  return { projectId: result.projectId, projectVersion: result.projectVersion, packageChecksum: result.packageChecksum, lockfileChecksum: result.lockfileChecksum, sourceChecksum: result.sourceChecksum, testFileCount: result.testFileCount, scripts: result.scripts };
}

export function runtimeResultToToolResult(operationId: ControlledRuntimeOperation, result: RuntimeCommandResult | RuntimeReadiness | RuntimeValidationReport, durationMs = 0): ToolResult {
  if (!registeredToolOutputIsValid("generated-runtime-validation", operationId, result)) throw new Error(`Runtime result does not satisfy the registered output contract for ${operationId}.`);
  const operation = getOperationDefinition("generated-runtime-validation", operationId);
  if (!operation) throw new Error(`No registered operation exists for ${operationId}.`);
  const policy = operation.resultPolicy;
  const command = "commandType" in result ? result : undefined;
  const stdoutResult = command ? boundToolText(command.stdoutSummary, policy.maxBytes, policy.maxLineBytes) : undefined;
  const stderrResult = command ? boundToolText(command.stderrSummary, policy.maxBytes, policy.maxLineBytes) : undefined;
  const stdout = stdoutResult?.value;
  const stderr = stderrResult?.value;
  const dataResult = resultData(runtimeResultData(result), Math.min(policy.maxBytes, TOOL_RESULT_MAX_BYTES));
  const status = "overallStatus" in result ? result.overallStatus === "passed" ? "passed" : result.overallStatus === "cancelled" ? "cancelled" : "failed" : command?.cancelled ? "cancelled" : command ? command.passed ? "passed" : "failed" : "passed";
  const summaryResult = boundToolText(stdout || stderr || `Controlled ${operationId} completed.`, policy.maxBytes, policy.maxLineBytes);
  return ToolResultSchema.parse({ toolId: "generated-runtime-validation", operationId, status, contentTrust: "HOST_VALIDATED", data: dataResult.data, summary: summaryResult.value, ...(stdout ? { stdout } : {}), ...(stderr ? { stderr } : {}), evidenceIdentity: ["sourceChecksum" in result && result.sourceChecksum ? `source:${result.sourceChecksum}` : "runtime-policy:generated-runtime-v1"], durationMs, redactionApplied: dataResult.redactionApplied || Boolean(stdoutResult?.redactionApplied) || Boolean(stderrResult?.redactionApplied) || summaryResult.redactionApplied, outputTruncated: dataResult.truncated || Boolean(command?.outputTruncated), retryable: Boolean(command && !command.passed && !command.cancelled) });
}

export function registeredOutputToToolResult(toolId: ToolId, operationId: string, serializedValue: string, durationMs = 0): ToolResult {
  const operation = getOperationDefinition(toolId, operationId);
  if (!operation) throw new Error(`No registered operation exists for ${toolId}:${operationId}.`);
  if (typeof serializedValue !== "string") throw new Error(`Tool output must be serialized JSON text for ${toolId}:${operationId}.`);
  if (Buffer.byteLength(serializedValue, "utf8") > EXTERNAL_RESULT_PREVALIDATION_MAX_BYTES) throw new Error(`Tool output exceeds the pre-validation resource bound for ${toolId}:${operationId}.`);
  let value: unknown;
  try {
    value = JSON.parse(serializedValue) as unknown;
  } catch (error) {
    throw new Error(`Tool output is not valid serialized JSON for ${toolId}:${operationId}.`, { cause: error });
  }
  if (!registeredToolOutputIsValid(toolId, operationId, value)) throw new Error(`Tool output does not satisfy the registered contract for ${toolId}:${operationId}.`);
  const dataResult = resultData(value, Math.min(operation.resultPolicy.maxBytes, TOOL_RESULT_MAX_BYTES));
  const summaryResult = boundToolText(`Untrusted result from ${toolId}:${operationId}.`, operation.resultPolicy.maxBytes, operation.resultPolicy.maxLineBytes);
  return ToolResultSchema.parse({ toolId, operationId, status: "passed", contentTrust: "UNTRUSTED_EXTERNAL", data: dataResult.data, summary: summaryResult.value, evidenceIdentity: [`executor:${operation.executorId}`, `tool-policy:${operation.resultPolicy.redactionPolicy}`], durationMs, redactionApplied: dataResult.redactionApplied || summaryResult.redactionApplied, outputTruncated: dataResult.truncated, retryable: false });
}

export async function executeControlledRuntimeOperation(input: { operationId: ControlledRuntimeOperation; runtimeInput: RuntimeValidatorInput; validator: GeneratedProjectRuntimeValidator }): Promise<ToolResult> {
  const started = Date.now();
  let result: RuntimeCommandResult | RuntimeReadiness | RuntimeValidationReport;
  switch (input.operationId) {
    case "install-locked": result = await input.validator.prepareNpmLockfile(input.runtimeInput); break;
    case "npm-ci": result = await input.validator.runNpmCi(input.runtimeInput); break;
    case "lint": result = await input.validator.runLint(input.runtimeInput); break;
    case "typecheck": result = await input.validator.runTypecheck(input.runtimeInput); break;
    case "unit-test": result = await input.validator.runTests(input.runtimeInput); break;
    case "build": result = await input.validator.runBuild(input.runtimeInput); break;
  }
  return runtimeResultToToolResult(input.operationId, result, Date.now() - started);
}
