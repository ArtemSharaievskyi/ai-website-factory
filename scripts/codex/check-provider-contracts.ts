import { isAiProviderError } from "@/integrations/openai/errors";
import { pathToFileURL } from "node:url";
import { buildProductionResponseFormat } from "@/integrations/openai/client";
import {
  BriefDraftStructuredOutputSchema,
  DesignDirectionStructuredOutputSchema,
  ImplementationChangeProposalStructuredOutputSchema,
  OrchestrationPlanSchema,
  PlanningPackageStructuredOutputSchema,
} from "@/integrations/openai/adapters";
import { ProviderBriefChangeSetSchema } from "@/integrations/openai-v3/changeset";
import { PlanningChangeSetProviderOutputSchema } from "@/agents/planner/changeset";
import { ClarificationPlanProviderOutputSchema, LeadAnalysisProviderOutputSchema } from "@/agents/lead/contracts";
import { ArchitectureReviewProviderOutputSchema, CodeIntegrationReviewProviderOutputSchema, ContractAuditProviderOutputSchema, SecurityReviewProviderOutputSchema, TestQualityReviewProviderOutputSchema } from "@/domain/review/schema";
import { fingerprintFailure } from "./baseline-failures";
import { loadProviderContractRegistry, type ProviderContractMetadata } from "./config";

type ProviderSchema = unknown;
type Builder = () => unknown;
export type ProviderContractFailure = { guardId: "provider-contracts"; key: string; id: string; schemaName: string; code: string; fingerprint: string; triggerPathPrefixes: string[]; affectedPathPrefixes?: string[] };
export type ProviderContractResult = { id: string; schemaName: string; passed: boolean; code: string };
export type ProviderContractGuardResult = { passed: boolean; results: ProviderContractResult[]; failures: ProviderContractFailure[]; knownProductDefects: string[] };

const builders: Record<string, Builder> = {
  "lead-analysis": () => buildProductionResponseFormat(LeadAnalysisProviderOutputSchema, "lead-analysis"),
  "clarification-plan": () => buildProductionResponseFormat(ClarificationPlanProviderOutputSchema, "clarification-plan"),
  "project-brief": () => buildProductionResponseFormat(BriefDraftStructuredOutputSchema, "brief-draft"),
  "brief-revision-v3": () => buildProductionResponseFormat(ProviderBriefChangeSetSchema, "brief-revision-v3"),
  "planning-package": () => buildProductionResponseFormat(PlanningPackageStructuredOutputSchema, "planning-package"),
  "planning-change-set": () => buildProductionResponseFormat(PlanningChangeSetProviderOutputSchema, "planning-change-set"),
  "design-direction-set": () => buildProductionResponseFormat(DesignDirectionStructuredOutputSchema, "design-direction-set"),
  "implementation-change-proposal": () => buildProductionResponseFormat(ImplementationChangeProposalStructuredOutputSchema, "implementation-change-proposal"),
  "orchestration-plan": () => buildProductionResponseFormat(OrchestrationPlanSchema, "orchestration-plan"),
  "architecture-review-result": () => buildProductionResponseFormat(ArchitectureReviewProviderOutputSchema, "architecture-review-result"),
  "contract-audit-result": () => buildProductionResponseFormat(ContractAuditProviderOutputSchema, "contract-audit-result"),
  "code-integration-review-result": () => buildProductionResponseFormat(CodeIntegrationReviewProviderOutputSchema, "code-integration-review-result"),
  "security-review-result": () => buildProductionResponseFormat(SecurityReviewProviderOutputSchema, "security-review-result"),
  "test-quality-review-result": () => buildProductionResponseFormat(TestQualityReviewProviderOutputSchema, "test-quality-review-result"),
};

const hostOwnedNames = new Set(["projectId", "projectVersion", "briefChecksum", "basePlanningSemanticChecksum", "baseBriefChecksum", "targetBriefChecksum", "authorizationScopeChecksum", "semanticChecksum", "documentChecksum", "approval", "approvedAt", "approvedBy", "currentness", "history", "trace"]);

function responseSchema(value: unknown) {
  const format = value as { type?: unknown; json_schema?: { name?: unknown; strict?: unknown; schema?: ProviderSchema } };
  if (format.type !== "json_schema" || !format.json_schema || typeof format.json_schema.schema !== "object" || !format.json_schema.schema) throw new Error("RESPONSE_FORMAT_INVALID");
  return format.json_schema;
}

function inspectJsonSchema(schema: unknown, pathName = "$"): string | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const node = schema as Record<string, unknown>;
  if (node.type === "object") {
    if (node.additionalProperties !== false) return `UNKNOWN_FIELDS_NOT_REJECTED:${pathName}`;
    if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
      for (const [name, child] of Object.entries(node.properties as Record<string, unknown>)) {
        const issue = inspectJsonSchema(child, `${pathName}.${name}`);
        if (issue) return issue;
      }
    }
  }
  if (node.type === "array" && node.items) return inspectJsonSchema(node.items, `${pathName}[]`);
  if (Array.isArray(node.anyOf)) for (const [index, child] of node.anyOf.entries()) { const issue = inspectJsonSchema(child, `${pathName}.anyOf${index}`); if (issue) return issue; }
  if (Array.isArray(node.oneOf)) for (const [index, child] of node.oneOf.entries()) { const issue = inspectJsonSchema(child, `${pathName}.oneOf${index}`); if (issue) return issue; }
  return undefined;
}

function findHostOwnedField(schema: unknown, pathName = "$"): string | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const node = schema as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
    for (const [name, child] of Object.entries(node.properties as Record<string, unknown>)) {
      if (hostOwnedNames.has(name)) return `${pathName}.${name}`;
      const issue = findHostOwnedField(child, `${pathName}.${name}`);
      if (issue) return issue;
    }
  }
  if (node.items) return findHostOwnedField(node.items, `${pathName}[]`);
  if (Array.isArray(node.anyOf)) for (const child of node.anyOf) { const issue = findHostOwnedField(child, `${pathName}.anyOf`); if (issue) return issue; }
  return undefined;
}

function failureCode(error: unknown) {
  if (isAiProviderError(error)) return error.diagnostic?.outputStage ?? error.diagnostic?.issueCode ?? error.code;
  if (error instanceof Error && error.message === "RESPONSE_FORMAT_INVALID") return "RESPONSE_FORMAT_INVALID";
  return "REQUEST_SCHEMA_CONSTRUCTION_FAILED";
}

export function evaluateProviderContract(metadata: ProviderContractMetadata, builder: Builder): ProviderContractResult {
  try {
    const jsonSchema = responseSchema(builder());
    if (jsonSchema.name !== metadata.schemaName) return { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: "SCHEMA_NAME_MISMATCH" };
    if (jsonSchema.strict !== true) return { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: "STRICT_MODE_DISABLED" };
    const strictIssue = inspectJsonSchema(jsonSchema.schema);
    if (strictIssue) return { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: strictIssue.split(":", 1)[0]! };
    const hostOwnedField = findHostOwnedField(jsonSchema.schema);
    if (hostOwnedField) return { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: "HOST_OWNED_FIELD_IN_PROVIDER_SCHEMA" };
    return { id: metadata.id, schemaName: metadata.schemaName, passed: true, code: "PASS" };
  } catch (error) {
    return { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: failureCode(error) };
  }
}

export async function runProviderContractGuard(options: { emit?: boolean } = {}): Promise<ProviderContractGuardResult> {
  const registry = await loadProviderContractRegistry();
  const results: ProviderContractResult[] = registry.contracts.map((metadata) => builders[metadata.id] ? evaluateProviderContract(metadata, builders[metadata.id]!) : { id: metadata.id, schemaName: metadata.schemaName, passed: false, code: "PRODUCTION_BUILDER_NOT_REGISTERED" });
  const failures = results.filter((result) => !result.passed).map((result) => {
    const metadata = registry.contracts.find((contract) => contract.id === result.id);
    const triggerPathPrefixes = metadata?.triggerPathPrefixes ?? [];
    return {
      guardId: "provider-contracts" as const,
      key: result.id,
      id: result.id,
      schemaName: result.schemaName,
      code: result.code,
      fingerprint: fingerprintFailure("provider-contracts", result.id, result.code, result.schemaName),
      triggerPathPrefixes,
      ...(metadata?.affectedPathPrefixes?.length ? { affectedPathPrefixes: metadata.affectedPathPrefixes } : {}),
    };
  });
  const knownProductDefects: string[] = [];
  const output: ProviderContractGuardResult = { passed: failures.length === 0, results, failures, knownProductDefects };
  if (options.emit !== false) printProviderContractResult(output);
  return output;
}

export function printProviderContractResult(result: ProviderContractGuardResult) {
  console.log("PROVIDER CONTRACTS");
  for (const contract of result.results) console.log(`${contract.id.padEnd(32, ".")} ${contract.passed ? "PASS" : "FAIL"}`);
  for (const failure of result.failures) console.log(`  ${failure.id}: ${failure.code}`);
  if (result.knownProductDefects.length) console.log("CURRENT PRODUCT DEFECT DETECTED BY NEW GUARD");
  console.log(`PROVIDER CONTRACTS: ${result.passed ? "PASS" : "FAIL"}`);
}

async function main() {
  const result = await runProviderContractGuard({ emit: true });
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_PROVIDER_GUARD_FAILED"); process.exitCode = 1; });
