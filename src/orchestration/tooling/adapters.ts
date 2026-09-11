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

export type SerializedToolExecutor<T> = Readonly<{
  [K in keyof T]: T[K] extends (...args: infer Args) => Promise<unknown> ? (...args: Args) => Promise<string> : never;
}>;

export type ControlledEditHost = Readonly<{
  applyAstPatch: (input: { proposalId: string; operationId: string; relativePath: string; expectedFileChecksum: string }) => Promise<string>;
}>;

export type FontpairReadHost = Readonly<{
  resolveCuratedPair: (input: { idempotencyKey: string; displayFamily?: string; bodyFamily?: string }) => Promise<string>;
}>;
export type DesignQualityValidationHost = Readonly<{
  detectAntipatterns: (input: { files: Array<{ path: string; content: string }> }) => Promise<string>;
}>;
export type DesignSourceDiscoveryHost = Readonly<{
  search21stComponents: (input: { category: string; directionId: string }) => Promise<string>;
  searchReactBitsComponents: (input: { category: string; directionId: string }) => Promise<string>;
  searchMagicUiComponents: (input: { category: string; directionId: string }) => Promise<string>;
  discoverShadcnBase: (input: { category: string; directionId: string }) => Promise<string>;
  searchGoogleFonts: (input: { idempotencyKey: string; query?: string; languageCoverage: string[]; sort: "alpha" | "date" | "popularity" | "style" | "trending" }) => Promise<string>;
  searchColorHuntPalettes: (input: { idempotencyKey: string; characteristics: string[] }) => Promise<string>;
  searchAceternityComponents: (input: { directionId: string; componentNames: string[] }) => Promise<string>;
  inspectAceternityComponent: (input: { directionId: string; componentName: string }) => Promise<string>;
}>;

export type ToolExecutorBindings = Readonly<{
  "openai-structured-output-provider": unknown;
  "context7-documentation-service": SerializedToolExecutor<Context7DocumentationPort>;
  "shadcn-registry-service": SerializedToolExecutor<ShadcnRegistryPort>;
  "codebase-memory-service": SerializedToolExecutor<CodebaseMemoryPort>;
  "generated-runtime-validator": GeneratedProjectRuntimeValidator;
  "functional-qa-service": SerializedToolExecutor<FunctionalQaService>;
  "controlled-edit-layer": ControlledEditHost;
  "fontpair-read-service": FontpairReadHost;
  "design-quality-validation-service": DesignQualityValidationHost;
  "design-source-discovery-service": DesignSourceDiscoveryHost;
}>;

export type BoundToolOperation =
  | { toolId: "context7-read"; operationId: "resolve-library"; executor: SerializedToolExecutor<Context7DocumentationPort>; input: Context7ResolutionInput }
  | { toolId: "context7-read"; operationId: "query-documentation"; executor: SerializedToolExecutor<Context7DocumentationPort>; input: Context7QueryInput }
  | { toolId: "shadcn-registry-read"; operationId: "resolve-component"; executor: SerializedToolExecutor<ShadcnRegistryPort>; input: ShadcnRegistryInput }
  | { toolId: "shadcn-registry-read"; operationId: "fetch-component-reference"; executor: SerializedToolExecutor<ShadcnRegistryPort>; input: { plan: ShadcnComponentQueryPlan; cancellation?: AbortSignal; idempotencyKey: string; designMetadata?: ShadcnRegistryInput["designMetadata"] } }
  | { toolId: "codebase-memory-read"; operationId: "ensure-index"; executor: SerializedToolExecutor<CodebaseMemoryPort>; input: { scope: WorkspaceScope; taskId?: string; signal?: AbortSignal } }
  | { toolId: "codebase-memory-read"; operationId: "find-symbol"; executor: SerializedToolExecutor<CodebaseMemoryPort>; input: { plan: CodebaseMemoryQueryPlan; signal?: AbortSignal } }
  | { toolId: "codebase-memory-read"; operationId: "get-relevant-source"; executor: SerializedToolExecutor<CodebaseMemoryPort>; input: { plan: CodebaseMemoryQueryPlan; signal?: AbortSignal } }
  | { toolId: "playwright-functional-qa"; operationId: "run-functional-flow"; executor: SerializedToolExecutor<FunctionalQaService>; input: FunctionalQaServiceInput }
  | { toolId: "controlled-edit"; operationId: "ast-patch"; executor: ControlledEditHost; input: { proposalId: string; operationId: string; relativePath: string; expectedFileChecksum: string } }
  | { toolId: "fontpair-read"; operationId: "resolve-curated-pair"; executor: FontpairReadHost; input: { idempotencyKey: string; displayFamily?: string; bodyFamily?: string } }
  | { toolId: "design-quality-validation"; operationId: "detect-antipatterns"; executor: DesignQualityValidationHost; input: { files: Array<{ path: string; content: string }> } }
  | { toolId: "design-source-discovery"; operationId: "search-21st-components" | "search-react-bits-components" | "search-magic-ui-components" | "discover-shadcn-base"; executor: DesignSourceDiscoveryHost; input: { category: string; directionId: string } }
  | { toolId: "design-source-discovery"; operationId: "search-google-fonts"; executor: DesignSourceDiscoveryHost; input: { idempotencyKey: string; query?: string; languageCoverage: string[]; sort: "alpha" | "date" | "popularity" | "style" | "trending" } }
  | { toolId: "design-source-discovery"; operationId: "search-color-hunt-palettes"; executor: DesignSourceDiscoveryHost; input: { idempotencyKey: string; characteristics: string[] } }
  | { toolId: "design-source-discovery"; operationId: "search-aceternity-components"; executor: DesignSourceDiscoveryHost; input: { directionId: string; componentNames: string[] } }
  | { toolId: "design-source-discovery"; operationId: "inspect-aceternity-component"; executor: DesignSourceDiscoveryHost; input: { directionId: string; componentName: string } };

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
    case "ast-patch": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.applyAstPatch(input.input), Date.now() - started);
    case "resolve-curated-pair": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.resolveCuratedPair(input.input), Date.now() - started);
    case "detect-antipatterns": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.detectAntipatterns(input.input), Date.now() - started);
    case "search-21st-components": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.search21stComponents(input.input), Date.now() - started);
    case "search-react-bits-components": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.searchReactBitsComponents(input.input), Date.now() - started);
    case "search-magic-ui-components": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.searchMagicUiComponents(input.input), Date.now() - started);
    case "discover-shadcn-base": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.discoverShadcnBase(input.input), Date.now() - started);
    case "search-google-fonts": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.searchGoogleFonts(input.input), Date.now() - started);
    case "search-color-hunt-palettes": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.searchColorHuntPalettes(input.input), Date.now() - started);
    case "search-aceternity-components": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.searchAceternityComponents(input.input), Date.now() - started);
    case "inspect-aceternity-component": return registeredOutputToToolResult(input.toolId, input.operationId, await input.executor.inspectAceternityComponent(input.input), Date.now() - started);
  }
}
