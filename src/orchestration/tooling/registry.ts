import { z } from "zod";
import { agentCatalog } from "@/agents/catalog";
import {
  CapabilityDefinitionSchema,
  ToolDefinitionSchema,
  type CapabilityDefinition,
  type ToolDefinition,
  type ToolInput,
  type ToolOperationDefinition,
  type ToolId,
} from "@/domain/tooling/schema";
import { RuntimeCommandResultSchema } from "@/runtime/validation/contracts";
import { Context7LibrarySchema, Context7QueryResultSchema } from "@/integrations/context7/contracts";
import { ShadcnComponentQueryPlanSchema, ShadcnReferenceResultSchema } from "@/integrations/shadcn/contracts";
import { CodebaseMemoryIndexSchema, CodebaseMemoryResultSchema } from "@/integrations/codebase-memory/contracts";
import { FunctionalQaReportSchema } from "@/runtime/qa/contracts";
import { FontpairNormalizedPairSchema, ImpeccableDetectorResultSchema, DesignSourceResearchSchema } from "@/integrations/design/contracts";
import { AceternityComponentCandidateSchema, AceternityDiscoverySchema, ColorHuntResearchSchema, GoogleFontResearchSchema } from "@/domain/design/resources";
import { REGISTERED_TOOL_EXECUTOR_IDS } from "./executor-ids";

const resultPolicy = {
  maxBytes: 16_000,
  maxLineBytes: 2_000,
  redactionPolicy: "tool-result-redaction-v1",
} as const;

const operation = (value: Omit<ToolOperationDefinition, "resultPolicy">): ToolOperationDefinition => ({
  ...value,
  resultPolicy,
});

const definition = (value: ToolDefinition) => {
  const parsed = ToolDefinitionSchema.parse(value);
  return Object.freeze({ ...parsed, operations: Object.freeze(parsed.operations.map((operation) => Object.freeze(operation))) }) as ToolDefinition;
};

export const TOOL_REGISTRY: Readonly<Record<ToolId, ToolDefinition>> = Object.freeze({
  "openai-generation": definition({
    id: "openai-generation",
    version: "1.0.0",
    kind: "agent-transport",
    availability: "AVAILABLE",
    operations: [operation({ operationId: "generate-structured-output", requiredCapabilities: [], mutationMode: "READ_ONLY", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "NONE", executorId: "openai-structured-output-provider", inputSchemaRef: "openai.structured-output.input", outputSchemaRef: "openai.structured-output.output" })],
  }),
  "context7-read": definition({
    id: "context7-read",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [
      operation({ operationId: "resolve-library", requiredCapabilities: ["docs.library-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "CURRENT_PROJECT", executorId: "context7-documentation-service", inputSchemaRef: "context7.resolve-library.input", outputSchemaRef: "context7.resolve-library.output" }),
      operation({ operationId: "query-documentation", requiredCapabilities: ["docs.library-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "CURRENT_PROJECT", executorId: "context7-documentation-service", inputSchemaRef: "context7.query-documentation.input", outputSchemaRef: "context7.query-documentation.output", timeoutMs: 30_000 }),
    ],
  }),
  "shadcn-registry-read": definition({
    id: "shadcn-registry-read",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [
      operation({ operationId: "resolve-component", requiredCapabilities: ["ui.registry-read"], mutationMode: "READ_ONLY", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "CURRENT_PROJECT", executorId: "shadcn-registry-service", inputSchemaRef: "shadcn.resolve-component.input", outputSchemaRef: "shadcn.resolve-component.output" }),
      operation({ operationId: "fetch-component-reference", requiredCapabilities: ["ui.registry-read"], mutationMode: "READ_ONLY", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "CURRENT_PROJECT", executorId: "shadcn-registry-service", inputSchemaRef: "shadcn.fetch-component-reference.input", outputSchemaRef: "shadcn.fetch-component-reference.output", timeoutMs: 30_000 }),
    ],
  }),
  "codebase-memory-read": definition({
    id: "codebase-memory-read",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [
      operation({ operationId: "ensure-index", requiredCapabilities: ["codebase.structure-read"], mutationMode: "READ_ONLY", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "codebase-memory-service", inputSchemaRef: "codebase-memory.ensure-index.input", outputSchemaRef: "codebase-memory.ensure-index.output" }),
      operation({ operationId: "find-symbol", requiredCapabilities: ["codebase.structure-read"], mutationMode: "READ_ONLY", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "codebase-memory-service", inputSchemaRef: "codebase-memory.find-symbol.input", outputSchemaRef: "codebase-memory.find-symbol.output" }),
      operation({ operationId: "get-relevant-source", requiredCapabilities: ["source.inspect", "codebase.structure-read"], mutationMode: "READ_ONLY", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "codebase-memory-service", inputSchemaRef: "codebase-memory.get-relevant-source.input", outputSchemaRef: "codebase-memory.get-relevant-source.output" }),
    ],
  }),
  "generated-runtime-validation": definition({
    id: "generated-runtime-validation",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [
      operation({ operationId: "install-locked", requiredCapabilities: ["dependency.materialize"], mutationMode: "VALIDATION_EXECUTION", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.install-locked.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 300_000 }),
      operation({ operationId: "npm-ci", requiredCapabilities: ["dependency.materialize"], mutationMode: "VALIDATION_EXECUTION", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.npm-ci.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 300_000 }),
      operation({ operationId: "lint", requiredCapabilities: ["validation.lint"], mutationMode: "VALIDATION_EXECUTION", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.lint.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 120_000 }),
      operation({ operationId: "typecheck", requiredCapabilities: ["validation.typecheck"], mutationMode: "VALIDATION_EXECUTION", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.typecheck.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 120_000 }),
      operation({ operationId: "unit-test", requiredCapabilities: ["validation.unit-test"], mutationMode: "VALIDATION_EXECUTION", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.unit-test.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 180_000 }),
      operation({ operationId: "build", requiredCapabilities: ["validation.build"], mutationMode: "VALIDATION_EXECUTION", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "generated-runtime-validator", inputSchemaRef: "runtime.build.input", outputSchemaRef: "runtime.command-result.output", timeoutMs: 300_000 }),
    ],
  }),
  "playwright-functional-qa": definition({
    id: "playwright-functional-qa",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [operation({ operationId: "run-functional-flow", requiredCapabilities: ["validation.functional"], mutationMode: "VALIDATION_EXECUTION", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "functional-qa-service", inputSchemaRef: "qa.run-functional-flow.input", outputSchemaRef: "qa.run-functional-flow.output", timeoutMs: 120_000 })],
  }),
  "controlled-edit": definition({
    id: "controlled-edit",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [operation({ operationId: "ast-patch", requiredCapabilities: ["edit.ast-patch"], mutationMode: "MUTATION_VIA_CHANGE_PROPOSAL", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "controlled-edit-layer", inputSchemaRef: "controlled-edit.ast-patch.input", outputSchemaRef: "controlled-edit.ast-patch.output" })],
  }),
  "fontpair-read": definition({
    id: "fontpair-read",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [operation({ operationId: "resolve-curated-pair", requiredCapabilities: ["design.fontpair-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "fontpair-read-service", inputSchemaRef: "design.fontpair.resolve-curated-pair.input", outputSchemaRef: "design.fontpair.resolve-curated-pair.output", timeoutMs: 30_000 })],
  }),
  "design-quality-validation": definition({
    id: "design-quality-validation",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [operation({ operationId: "detect-antipatterns", requiredCapabilities: ["design.quality-detect"], mutationMode: "READ_ONLY", networkMode: "NO_NETWORK", workspaceScope: "CURRENT_TASK_WORKSPACE", executorId: "design-quality-validation-service", inputSchemaRef: "design.quality.detect-antipatterns.input", outputSchemaRef: "design.quality.detect-antipatterns.output" })],
  }),
  "design-source-discovery": definition({
    id: "design-source-discovery",
    version: "1.0.0",
    kind: "developer-tool",
    availability: "AVAILABLE",
    operations: [
      operation({ operationId: "search-21st-components", requiredCapabilities: ["design.twenty-first-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.component-discovery.input", outputSchemaRef: "design.component-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "search-react-bits-components", requiredCapabilities: ["design.react-bits-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.component-discovery.input", outputSchemaRef: "design.component-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "search-magic-ui-components", requiredCapabilities: ["design.magic-ui-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.component-discovery.input", outputSchemaRef: "design.component-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "discover-shadcn-base", requiredCapabilities: ["design.shadcn-discovery"], mutationMode: "READ_ONLY", networkMode: "CURRENT_EXISTING_INTEGRATION", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.component-discovery.input", outputSchemaRef: "design.component-discovery.output" }),
      operation({ operationId: "search-google-fonts", requiredCapabilities: ["design.google-fonts-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.typography-discovery.input", outputSchemaRef: "design.typography-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "search-color-hunt-palettes", requiredCapabilities: ["design.color-hunt-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.palette-discovery.input", outputSchemaRef: "design.palette-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "search-aceternity-components", requiredCapabilities: ["design.aceternity-read"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.aceternity-discovery.input", outputSchemaRef: "design.aceternity-discovery.output", timeoutMs: 30_000 }),
      operation({ operationId: "inspect-aceternity-component", requiredCapabilities: ["design.aceternity-inspect"], mutationMode: "READ_ONLY", networkMode: "APPROVED_EXTERNAL_READ_ONLY", workspaceScope: "NONE", executorId: "design-source-discovery-service", inputSchemaRef: "design.aceternity-inspection.input", outputSchemaRef: "design.aceternity-inspection.output", timeoutMs: 30_000 }),
    ],
  }),
});

export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = Object.freeze([
  CapabilityDefinitionSchema.parse({ id: "source.inspect", description: "Inspect bounded current source context for the task.", eligibleOperations: [{ toolId: "codebase-memory-read", operationId: "get-relevant-source" }], taskTypes: ["implement-*", "write-*", "repair-targeted-failure"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "docs.library-read", description: "Read approved version-specific library documentation.", eligibleOperations: [{ toolId: "context7-read", operationId: "resolve-library" }, { toolId: "context7-read", operationId: "query-documentation" }], taskTypes: ["create-technical-architecture", "implement-*", "write-*", "repair-targeted-failure"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "ui.registry-read", description: "Read approved official shadcn component metadata.", eligibleOperations: [{ toolId: "shadcn-registry-read", operationId: "resolve-component" }, { toolId: "shadcn-registry-read", operationId: "fetch-component-reference" }], taskTypes: ["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "codebase.structure-read", description: "Read bounded current Codebase Memory structure.", eligibleOperations: [{ toolId: "codebase-memory-read", operationId: "ensure-index" }, { toolId: "codebase-memory-read", operationId: "find-symbol" }, { toolId: "codebase-memory-read", operationId: "get-relevant-source" }], taskTypes: ["implement-*", "write-*", "repair-targeted-failure"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "validation.lint", description: "Run the fixed generated-project lint validation.", eligibleOperations: [{ toolId: "generated-runtime-validation", operationId: "lint" }], taskTypes: ["validate-lint"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "validation.typecheck", description: "Run the fixed generated-project TypeScript validation.", eligibleOperations: [{ toolId: "generated-runtime-validation", operationId: "typecheck" }], taskTypes: ["validate-typecheck"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "validation.unit-test", description: "Run the fixed generated-project unit-test validation.", eligibleOperations: [{ toolId: "generated-runtime-validation", operationId: "unit-test" }], taskTypes: ["validate-unit-tests"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "validation.build", description: "Run the fixed generated-project build validation.", eligibleOperations: [{ toolId: "generated-runtime-validation", operationId: "build" }], taskTypes: ["validate-build"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "validation.functional", description: "Run the approved functional QA scenario plan.", eligibleOperations: [{ toolId: "playwright-functional-qa", operationId: "run-functional-flow" }], taskTypes: ["validate-functional-flow"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "dependency.materialize", description: "Materialize only the current host-authorized generated dependency state.", eligibleOperations: [{ toolId: "generated-runtime-validation", operationId: "install-locked" }, { toolId: "generated-runtime-validation", operationId: "npm-ci" }], taskTypes: ["implement-project-foundation", "validate-typecheck", "validate-lint", "validate-unit-tests", "validate-build"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "edit.ast-patch", description: "Apply a bounded TypeScript structural patch through the current ChangeProposal transaction when the host explicitly assigns the structural-edit strategy to a code task.", eligibleOperations: [{ toolId: "controlled-edit", operationId: "ast-patch" }], taskTypes: ["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form", "implement-motion", "repair-targeted-failure"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.fontpair-read", description: "Read one curated Fontpair recommendation through the dedicated allowlisted adapter.", eligibleOperations: [{ toolId: "fontpair-read", operationId: "resolve-curated-pair" }], taskTypes: ["create-design-directions"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.quality-detect", description: "Run the host-controlled deterministic Impeccable anti-pattern detector over bounded source text.", eligibleOperations: [{ toolId: "design-quality-validation", operationId: "detect-antipatterns" }], taskTypes: ["create-design-directions", "implement-design-system", "implement-page", "validate-lint"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.twenty-first-read", description: "Read bounded public 21st.dev composition metadata without source-write authority.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-21st-components" }], taskTypes: ["create-design-directions"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.react-bits-read", description: "Read bounded free React Bits discovery metadata without source-write authority.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-react-bits-components" }], taskTypes: ["create-design-directions"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.magic-ui-read", description: "Read bounded free Magic UI registry metadata without source-write authority.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-magic-ui-components" }], taskTypes: ["create-design-directions"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.shadcn-discovery", description: "Resolve the existing approved shadcn/ui base primitive authority for design evidence.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "discover-shadcn-base" }], taskTypes: ["create-design-directions"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.google-fonts-read", description: "Read bounded Google Fonts metadata for typography candidate evaluation; it never authorizes runtime stylesheet loading.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-google-fonts" }], taskTypes: ["create-design-directions", "implement-design-system", "implement-shared-layout", "implement-page", "implement-shared-component"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.color-hunt-read", description: "Read bounded Color Hunt palette candidates as inspiration only; semantic conversion and contrast validation remain host/design obligations.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-color-hunt-palettes" }], taskTypes: ["create-design-directions", "implement-design-system", "implement-shared-layout", "implement-page", "implement-shared-component"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.aceternity-read", description: "Search and inspect the official Aceternity namespaced registry without installation or source-write authority.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "search-aceternity-components" }], taskTypes: ["create-design-directions", "implement-design-system", "implement-shared-layout", "implement-page", "implement-shared-component"], availability: "AVAILABLE" }),
  CapabilityDefinitionSchema.parse({ id: "design.aceternity-inspect", description: "Inspect one named Aceternity registry component before any separately authorized adaptation.", eligibleOperations: [{ toolId: "design-source-discovery", operationId: "inspect-aceternity-component" }], taskTypes: ["create-design-directions", "implement-design-system", "implement-shared-layout", "implement-page", "implement-shared-component"], availability: "AVAILABLE" }),
]);

const noArguments = z.object({}).strict();
const input = (schema: z.ZodType): z.ZodType => schema;
const TOOL_INPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  "openai.structured-output.input": input(z.record(z.string(), z.unknown())),
  "context7.resolve-library.input": input(z.object({ packageName: z.string().min(1), version: z.string().min(1).optional() }).strict()),
  "context7.query-documentation.input": input(z.object({ packageName: z.string().min(1), resolvedLibraryId: z.string().min(1), version: z.string().min(1).optional(), topic: z.string().min(1), reason: z.string().min(1).max(500) }).strict()),
  "shadcn.resolve-component.input": input(z.object({ componentName: z.string().regex(/^[a-z0-9-]+$/), expectedComponentRole: z.string().min(1), reason: z.string().min(1).max(500) }).strict()),
  "shadcn.fetch-component-reference.input": input(z.object({ queryId: z.string().uuid(), idempotencyKey: z.string().min(1) }).strict()),
  "codebase-memory.ensure-index.input": input(noArguments),
  "codebase-memory.find-symbol.input": input(z.object({ symbol: z.string().min(1).max(160) }).strict()),
  "codebase-memory.get-relevant-source.input": input(z.object({ file: z.string().max(240).optional(), relativePath: z.string().max(240).optional(), topic: z.string().max(240).optional() }).strict()),
  "runtime.install-locked.input": input(noArguments),
  "runtime.npm-ci.input": input(noArguments),
  "runtime.lint.input": input(noArguments),
  "runtime.typecheck.input": input(noArguments),
  "runtime.unit-test.input": input(noArguments),
  "runtime.build.input": input(noArguments),
  "qa.run-functional-flow.input": input(z.object({ scenarioId: z.string().min(1) }).strict()),
  "controlled-edit.ast-patch.input": input(z.object({ proposalId: z.string().uuid(), operationId: z.string().uuid(), relativePath: z.string().min(1).max(240), expectedFileChecksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  "design.fontpair.resolve-curated-pair.input": input(z.object({ idempotencyKey: z.string().min(1).max(200), displayFamily: z.string().min(1).max(120).optional(), bodyFamily: z.string().min(1).max(120).optional() }).strict()),
  "design.quality.detect-antipatterns.input": input(z.object({ files: z.array(z.object({ path: z.string().min(1).max(240), content: z.string().max(100_000) }).strict()).max(80) }).strict()),
  "design.component-discovery.input": input(z.object({ category: z.string().min(1).max(100), directionId: z.string().uuid() }).strict()),
  "design.typography-discovery.input": input(z.object({ idempotencyKey: z.string().min(1).max(200), query: z.string().max(160).optional(), languageCoverage: z.array(z.string().min(1).max(40)).max(20).default([]), sort: z.enum(["alpha", "date", "popularity", "style", "trending"]).default("alpha") }).strict()),
  "design.palette-discovery.input": input(z.object({ idempotencyKey: z.string().min(1).max(200), characteristics: z.array(z.string().min(1).max(50)).max(8).default([]) }).strict()),
  "design.aceternity-discovery.input": input(z.object({ directionId: z.string().uuid(), componentNames: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).max(6) }).strict()),
  "design.aceternity-inspection.input": input(z.object({ directionId: z.string().uuid(), componentName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict()),
});

const genericToolOutputSchema = z.record(z.string(), z.unknown());
const TOOL_OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  "openai.structured-output.output": genericToolOutputSchema,
  "context7.resolve-library.output": Context7LibrarySchema,
  "context7.query-documentation.output": Context7QueryResultSchema,
  "shadcn.resolve-component.output": ShadcnComponentQueryPlanSchema,
  "shadcn.fetch-component-reference.output": ShadcnReferenceResultSchema,
  "codebase-memory.ensure-index.output": CodebaseMemoryIndexSchema,
  "codebase-memory.find-symbol.output": CodebaseMemoryResultSchema,
  "codebase-memory.get-relevant-source.output": CodebaseMemoryResultSchema,
  "runtime.command-result.output": RuntimeCommandResultSchema,
  "qa.run-functional-flow.output": FunctionalQaReportSchema,
  "controlled-edit.ast-patch.output": input(z.object({ operationId: z.string().uuid(), status: z.enum(["accepted", "applied", "idempotent", "denied"]), evidenceId: z.string().min(1).max(300) }).strict()),
  "design.fontpair.resolve-curated-pair.output": FontpairNormalizedPairSchema,
  "design.quality.detect-antipatterns.output": ImpeccableDetectorResultSchema,
  "design.component-discovery.output": DesignSourceResearchSchema,
  "design.typography-discovery.output": GoogleFontResearchSchema,
  "design.palette-discovery.output": ColorHuntResearchSchema,
  "design.aceternity-discovery.output": AceternityDiscoverySchema,
  "design.aceternity-inspection.output": AceternityComponentCandidateSchema,
});

export function registeredToolInputIsValid(toolId: string, operationId: string, value: ToolInput) {
  const operation = getOperationDefinition(toolId, operationId);
  return operation ? TOOL_INPUT_SCHEMAS[operation.inputSchemaRef]?.safeParse(value).success ?? false : false;
}

export function registeredToolOutputIsValid(toolId: string, operationId: string, value: unknown) {
  const operation = getOperationDefinition(toolId, operationId);
  return operation ? TOOL_OUTPUT_SCHEMAS[operation.outputSchemaRef]?.safeParse(value).success ?? false : false;
}

export const LEGACY_TOOL_ID_ALIASES: Readonly<Record<string, ToolId>> = Object.freeze({
  "Context7-read": "context7-read",
  "Playwright-functional": "playwright-functional-qa",
});

export function canonicalToolId(value: string) {
  return LEGACY_TOOL_ID_ALIASES[value] ?? value;
}

export class ToolRegistryError extends Error {
  constructor(readonly code: "DUPLICATE_TOOL" | "UNKNOWN_TOOL_PERMISSION" | "UNKNOWN_CAPABILITY" | "UNKNOWN_OPERATION" | "UNKNOWN_EXECUTOR" | "FORBIDDEN_OPERATION", message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export function getToolDefinition(toolId: string, registry: Readonly<Record<ToolId, ToolDefinition>> = TOOL_REGISTRY) {
  return registry[canonicalToolId(toolId) as ToolId];
}

export function getOperationDefinition(toolId: string, operationId: string, registry: Readonly<Record<ToolId, ToolDefinition>> = TOOL_REGISTRY) {
  return getToolDefinition(canonicalToolId(toolId), registry)?.operations.find((operation) => operation.operationId === operationId);
}

export function validateToolRegistry(registry: Readonly<Record<ToolId, ToolDefinition>> = TOOL_REGISTRY, capabilities: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY) {
  const tools = Object.values(registry);
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) throw new ToolRegistryError("DUPLICATE_TOOL", "Tool IDs must be unique.");
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  if (capabilityIds.size !== capabilities.length) throw new ToolRegistryError("UNKNOWN_CAPABILITY", "Capability IDs must be unique.");
  const operationReferences = new Set(tools.flatMap((tool) => tool.operations.map((operation) => `${tool.id}:${operation.operationId}`)));
  for (const tool of tools) {
    for (const operation of tool.operations) {
      for (const capability of operation.requiredCapabilities) if (!capabilityIds.has(capability)) throw new ToolRegistryError("UNKNOWN_CAPABILITY", `Operation ${tool.id}:${operation.operationId} references an unknown capability.`);
      if (!REGISTERED_TOOL_EXECUTOR_IDS.includes(operation.executorId as typeof REGISTERED_TOOL_EXECUTOR_IDS[number])) throw new ToolRegistryError("UNKNOWN_EXECUTOR", `Operation ${tool.id}:${operation.operationId} references an unbound executor.`);
      if (!TOOL_INPUT_SCHEMAS[operation.inputSchemaRef]) throw new ToolRegistryError("UNKNOWN_OPERATION", `Operation ${tool.id}:${operation.operationId} references an unknown input schema.`);
      if (!TOOL_OUTPUT_SCHEMAS[operation.outputSchemaRef]) throw new ToolRegistryError("UNKNOWN_OPERATION", `Operation ${tool.id}:${operation.operationId} references an unknown output schema.`);
      if (["write-file", "edit-file", "delete-file", "move-file", "shell", "terminal", "execute-command", "powershell", "cmd"].includes(operation.operationId)) throw new ToolRegistryError("FORBIDDEN_OPERATION", `Forbidden generic operation is registered: ${operation.operationId}.`);
    }
  }
  for (const capability of capabilities) for (const reference of capability.eligibleOperations) {
    const operation = getOperationDefinition(reference.toolId, reference.operationId, registry);
    if (!operation) throw new ToolRegistryError("UNKNOWN_OPERATION", `Capability ${capability.id} references an unknown operation.`);
    if (!capabilityIds.has(capability.id) || !operationReferences.has(`${reference.toolId}:${reference.operationId}`)) throw new ToolRegistryError("UNKNOWN_CAPABILITY", `Capability ${capability.id} is not registered.`);
    if (!operation.requiredCapabilities.includes(capability.id)) throw new ToolRegistryError("UNKNOWN_CAPABILITY", `Capability ${capability.id} advertises an operation that does not require it.`);
  }
  for (const agent of agentCatalog) for (const toolId of agent.allowedTools) if (!getToolDefinition(toolId, registry)) throw new ToolRegistryError("UNKNOWN_TOOL_PERMISSION", `Agent ${agent.agentId} references an unregistered tool: ${toolId}.`);
  return { tools: tools.length, operations: tools.reduce((count, tool) => count + tool.operations.length, 0), capabilities: capabilities.length };
}

validateToolRegistry();
