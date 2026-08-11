import type { Context7DocumentationPort } from "@/integrations/context7/contracts";
import type { ShadcnRegistryPort } from "@/integrations/shadcn/contracts";
import type { CodebaseMemoryPort } from "@/integrations/codebase-memory/contracts";
import type { GeneratedProjectRuntimeValidator } from "@/runtime/validation/contracts";
import type { FunctionalQaService } from "@/runtime/qa/service";
import type { Context7ResolutionInput, Context7QueryInput } from "@/integrations/context7/contracts";
import type { ShadcnRegistryInput, ShadcnComponentQueryPlan } from "@/integrations/shadcn/contracts";
import type { WorkspaceScope, CodebaseMemoryQueryPlan } from "@/integrations/codebase-memory/contracts";
import type { FunctionalQaServiceInput } from "@/runtime/qa/contracts";
import type { ToolResult } from "@/domain/tooling/schema";
import { registeredOutputToToolResult } from "./executors";

/** Static executor identities bind registry operations to existing typed integrations. */
export { REGISTERED_TOOL_EXECUTOR_IDS } from "./executor-ids";

export type ToolExecutorBindings = Readonly<{
  "openai-structured-output-provider": unknown;
  "context7-documentation-service": Context7DocumentationPort;
  "shadcn-registry-service": ShadcnRegistryPort;
  "codebase-memory-service": CodebaseMemoryPort;
  "generated-runtime-validator": GeneratedProjectRuntimeValidator;
  "functional-qa-service": FunctionalQaService;
}>;

export type BoundToolOperation =
  | { toolId: "context7-read"; operationId: "resolve-library"; executor: Context7DocumentationPort; input: Context7ResolutionInput }
  | { toolId: "context7-read"; operationId: "query-documentation"; executor: Context7DocumentationPort; input: Context7QueryInput }
  | { toolId: "shadcn-registry-read"; operationId: "resolve-component"; executor: ShadcnRegistryPort; input: ShadcnRegistryInput }
  | { toolId: "shadcn-registry-read"; operationId: "fetch-component-reference"; executor: ShadcnRegistryPort; input: { plan: ShadcnComponentQueryPlan; cancellation?: AbortSignal; idempotencyKey: string; designMetadata?: ShadcnRegistryInput["designMetadata"] } }
  | { toolId: "codebase-memory-read"; operationId: "ensure-index"; executor: CodebaseMemoryPort; input: { scope: WorkspaceScope; taskId?: string; signal?: AbortSignal } }
  | { toolId: "codebase-memory-read"; operationId: "find-symbol"; executor: CodebaseMemoryPort; input: { plan: CodebaseMemoryQueryPlan; signal?: AbortSignal } }
  | { toolId: "codebase-memory-read"; operationId: "get-relevant-source"; executor: CodebaseMemoryPort; input: { plan: CodebaseMemoryQueryPlan; signal?: AbortSignal } }
  | { toolId: "playwright-functional-qa"; operationId: "run-functional-flow"; executor: FunctionalQaService; input: FunctionalQaServiceInput };

/** Host dispatch after authorizeToolRequest; the discriminated input prevents raw shell, URL, or executor selection. */
export async function executeBoundToolOperation(input: BoundToolOperation): Promise<ToolResult> {
  const started = Date.now();
  switch (input.operationId) {
    case "resolve-library": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.resolveLibrary(input.input), Date.now() - started);
    case "query-documentation": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.queryDocumentation(input.input), Date.now() - started);
    case "resolve-component": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.resolveComponent(input.input), Date.now() - started);
    case "fetch-component-reference": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.fetchComponentReference(input.input), Date.now() - started);
    case "ensure-index": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.ensureIndex(input.input.scope, input.input.taskId, input.input.signal), Date.now() - started);
    case "find-symbol": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.findSymbol(input.input.plan, input.input.signal), Date.now() - started);
    case "get-relevant-source": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.getRelevantSource(input.input.plan, input.input.signal), Date.now() - started);
    case "run-functional-flow": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.run(input.input), Date.now() - started);
  }
}
