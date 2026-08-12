/** Executor identities are host-owned constants; callers cannot register new executors through a ToolRequest. */
export const REGISTERED_TOOL_EXECUTOR_IDS = [
  "openai-structured-output-provider",
  "context7-documentation-service",
  "shadcn-registry-service",
  "codebase-memory-service",
  "generated-runtime-validator",
  "functional-qa-service",
  "controlled-edit-layer",
] as const;

export type RegisteredToolExecutorId = (typeof REGISTERED_TOOL_EXECUTOR_IDS)[number];
