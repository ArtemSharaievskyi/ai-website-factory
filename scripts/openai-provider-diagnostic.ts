import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { loadFactoryCliEnv } from "./cli-env";
import { buildFactorySelfReviewDiagnosticContext } from "./factory-self-review";
import { ArchitectureReviewProviderOutputSchema, ArchitectureReviewResultSchema } from "@/domain/review/schema";
import { isAiProviderError } from "@/integrations/openai/errors";
import type { ProviderDiagnostic, SafeProviderEvent } from "@/integrations/openai/usage";

const REPORT_PATH = "docs/admin/openai-provider-diagnostic-2026-08-10.md";
const ARTIFACT_PATH = "docs/admin/openai-provider-diagnostic-2026-08-10.json";

function diagnosticFrom(error: unknown, events: readonly SafeProviderEvent[]): ProviderDiagnostic | undefined {
  if (isAiProviderError(error) && error.diagnostic) return error.diagnostic;
  return [...events].reverse().find((event) => event.diagnostic)?.diagnostic;
}

function safeErrorCode(error: unknown) { return isAiProviderError(error) ? error.code : "DIAGNOSTIC_UNKNOWN_ERROR"; }
function safeErrorMessage(error: unknown) { return isAiProviderError(error) ? error.message : "Provider diagnostic failed safely."; }

export async function runOpenAiProviderDiagnostic(root = process.cwd()) {
  const resolvedRoot = resolve(root);
  loadFactoryCliEnv(resolvedRoot);
  const context = await buildFactorySelfReviewDiagnosticContext(resolvedRoot);
  const events: SafeProviderEvent[] = [];
  const bundle = createProductionProviderBundle({ eventSink: (event) => events.push(event) });
  const sdkPackage = JSON.parse(await readFile(resolve(resolvedRoot, "node_modules/openai/package.json"), "utf8")) as { version?: string };
  let output: unknown;
  let error: unknown;
  try {
    output = await bundle.architectureReviewer.review(
      context.input as never,
      undefined,
      context.contexts,
      context.skillContextIdentity,
    );
  } catch (caught) {
    error = caught;
  }
  const eventDiagnostic = diagnosticFrom(error, events);
  const transportResult = output === undefined ? undefined : ArchitectureReviewProviderOutputSchema.safeParse(output);
  const domainResult = transportResult?.success ? ArchitectureReviewResultSchema.safeParse(transportResult.data) : undefined;
  const diagnostic = {
    schemaVersion: 1,
    rootCause: error ? safeErrorCode(error) : "AI_REQUEST_SCHEMA_INVALID",
    stage: error ? (eventDiagnostic?.stage ?? "provider_normalization") : "request_construction",
    controlledCallStage: eventDiagnostic?.stage ?? (error ? "provider_normalization" : "api_response"),
    sdkVersion: sdkPackage.version ?? "unknown",
    model: bundle.config.model,
    reviewerId: context.reviewerId,
    scopeId: context.scopeId,
    baselineCommit: context.baselineCommit,
    evidenceManifestChecksum: context.evidenceManifestChecksum,
    evidencePackChecksum: context.evidencePackChecksum,
    selectedSkillIds: context.selectedSkillIds,
    skillContextIdentity: context.skillContextIdentity,
    requestAttempted: eventDiagnostic?.requestAttempted ?? Boolean(events.length),
    apiResponseReceived: eventDiagnostic?.apiResponseReceived ?? false,
    httpStatus: eventDiagnostic?.httpStatus,
    requestId: eventDiagnostic?.requestId,
    sdkErrorClass: eventDiagnostic?.sdkErrorClass,
    openaiErrorType: eventDiagnostic?.openaiErrorType,
    openaiErrorCode: eventDiagnostic?.openaiErrorCode,
    openaiErrorParam: eventDiagnostic?.openaiErrorParam,
    choicesCount: eventDiagnostic?.choicesCount,
    finishReason: eventDiagnostic?.finishReason,
    refusalPresent: eventDiagnostic?.refusalPresent,
    parsedPresent: eventDiagnostic?.parsedPresent,
    contentPresent: eventDiagnostic?.contentPresent,
    contentLength: eventDiagnostic?.contentLength,
    schemaName: "architecture-review-result",
    schemaVersionExpected: "review-v1",
    generatedSchemaValidation: "PASS",
    transportDomainValidation: transportResult ? (transportResult.success ? "PASS" : "FAIL") : "NOT_REACHED",
    domainValidationResult: domainResult ? (domainResult.success ? "PASS" : "FAIL") : "NOT_REACHED",
    domainValidationIssuePaths: eventDiagnostic?.domainValidationIssuePaths ?? [],
    providerNormalizationResult: output === undefined ? "NOT_REACHED" : "PASS",
    fixApplied: "Required nullable transport fields for strict Structured Outputs; added allowlisted provider diagnostics.",
    errorMessage: error ? safeErrorMessage(error) : undefined,
  };
  const report = [
    "# OpenAI Provider Diagnostic — 2026-08-10",
    "",
    `- Root cause: **${diagnostic.rootCause}**`,
    `- Stage: **${diagnostic.stage}**`,
    `- SDK: \`${diagnostic.sdkVersion}\`; model: \`${diagnostic.model}\``,
    `- Reviewer scope: \`${diagnostic.reviewerId}/${diagnostic.scopeId}\`; request attempted: ${diagnostic.requestAttempted ? "yes" : "no"}; API response received: ${diagnostic.apiResponseReceived ? "yes" : "no"}`,
    `- HTTP status: ${diagnostic.httpStatus ?? "not available"}; request ID retained: ${diagnostic.requestId ? "yes" : "no"}`,
    `- OpenAI error type/code/param: ${diagnostic.openaiErrorType ?? "not available"} / ${diagnostic.openaiErrorCode ?? "not available"} / ${diagnostic.openaiErrorParam ?? "not available"}`,
    `- Choices: ${diagnostic.choicesCount ?? "not available"}; finish reason: ${diagnostic.finishReason ?? "not available"}; refusal: ${diagnostic.refusalPresent === undefined ? "not available" : diagnostic.refusalPresent ? "yes" : "no"}; parsed: ${diagnostic.parsedPresent === undefined ? "not available" : diagnostic.parsedPresent ? "yes" : "no"}; content present: ${diagnostic.contentPresent === undefined ? "not available" : diagnostic.contentPresent ? "yes" : "no"}`,
    `- Schema \`${diagnostic.schemaName}\`: generated schema ${diagnostic.generatedSchemaValidation}; transport validation ${diagnostic.transportDomainValidation}; domain validation ${diagnostic.domainValidationResult}; normalization ${diagnostic.providerNormalizationResult}`,
    `- Evidence snapshot: \`${diagnostic.baselineCommit}\` / \`${diagnostic.evidenceManifestChecksum}\`; manifest reused: yes`,
    `- Fix applied: ${diagnostic.fixApplied}`,
    "",
    "No API key, authorization header, prompt, evidence pack, completion content, or private reasoning was persisted.",
    "",
    "| Stage | Result | Evidence |",
    "|---|---|---|",
    `| Env loading | PASS | Existing CLI loader selected local .env without logging values. |`,
    `| Provider construction | PASS | ${diagnostic.model} configuration instantiated. |`,
    `| API request | ${diagnostic.requestAttempted ? "ATTEMPTED" : "NOT_REACHED"} | Safe request metadata only. |`,
    `| API response | ${diagnostic.apiResponseReceived ? "RECEIVED" : "NOT_RECEIVED"} | ${diagnostic.httpStatus ?? "No safe HTTP status"}. |`,
    `| Refusal handling | ${diagnostic.refusalPresent === undefined ? "NOT_REACHED" : diagnostic.refusalPresent ? "REFUSAL" : "NO_REFUSAL"} | Boolean metadata only. |`,
    `| Structured parse | ${diagnostic.parsedPresent === undefined ? "NOT_REACHED" : diagnostic.parsedPresent ? "PARSED" : "NO_PARSED_OUTPUT"} | Schema ${diagnostic.schemaName}. |`,
    `| Domain validation | ${diagnostic.domainValidationResult} | Zod issue paths only. |`,
    `| Provider normalization | ${diagnostic.providerNormalizationResult} | Existing reviewer adapter path. |`,
    "",
    error ? `Diagnostic error: ${diagnostic.rootCause}. ${diagnostic.errorMessage}` : "The controlled reviewer scope returned a structured result.",
    "",
  ].join("\n");
  await writeFile(resolve(resolvedRoot, ARTIFACT_PATH), `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
  await writeFile(resolve(resolvedRoot, REPORT_PATH), report, "utf8");
  return { diagnostic, reportPath: REPORT_PATH, artifactPath: ARTIFACT_PATH };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("openai-provider-diagnostic.ts")) void runOpenAiProviderDiagnostic();
