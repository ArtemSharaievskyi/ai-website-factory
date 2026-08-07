import { z } from "zod";
import { CodebaseMemoryError } from "./errors";
const EnvironmentSchema = z.object({
  CODEBASE_MEMORY_ENABLED: z.enum(["true", "false"]).default("false"),
  CODEBASE_MEMORY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  CODEBASE_MEMORY_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(8).default(2),
  CODEBASE_MEMORY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(300),
  CODEBASE_MEMORY_MAX_RESULTS: z.coerce.number().int().min(1).max(100).default(30),
  CODEBASE_MEMORY_MAX_SOURCE_BYTES: z.coerce.number().int().min(256).max(100000).default(20000),
  CODEBASE_MEMORY_EXECUTABLE: z.string().min(1).optional(),
  GENERATED_PROJECTS_ROOT: z.string().min(1).optional(),
}).strict();
export type CodebaseMemoryConfig = { enabled: boolean; timeoutMs: number; maxConcurrentRequests: number; cacheTtlSeconds: number; maxResults: number; maxSourceBytes: number; executable?: string; generatedProjectsRoot?: string };
export function readCodebaseMemoryConfig(env: Record<string, string | undefined> = process.env): CodebaseMemoryConfig {
  if (env.NEXT_PUBLIC_CODEBASE_MEMORY_ENABLED || env.NEXT_PUBLIC_CODEBASE_MEMORY_EXECUTABLE) throw new CodebaseMemoryError("CODEBASE_MEMORY_CONFIGURATION_INVALID", "Codebase Memory configuration is server-only.");
  const result = EnvironmentSchema.safeParse({ CODEBASE_MEMORY_ENABLED: env.CODEBASE_MEMORY_ENABLED, CODEBASE_MEMORY_REQUEST_TIMEOUT_MS: env.CODEBASE_MEMORY_REQUEST_TIMEOUT_MS, CODEBASE_MEMORY_MAX_CONCURRENT_REQUESTS: env.CODEBASE_MEMORY_MAX_CONCURRENT_REQUESTS, CODEBASE_MEMORY_CACHE_TTL_SECONDS: env.CODEBASE_MEMORY_CACHE_TTL_SECONDS, CODEBASE_MEMORY_MAX_RESULTS: env.CODEBASE_MEMORY_MAX_RESULTS, CODEBASE_MEMORY_MAX_SOURCE_BYTES: env.CODEBASE_MEMORY_MAX_SOURCE_BYTES, CODEBASE_MEMORY_EXECUTABLE: env.CODEBASE_MEMORY_EXECUTABLE, GENERATED_PROJECTS_ROOT: env.GENERATED_PROJECTS_ROOT }); if (!result.success) throw new CodebaseMemoryError("CODEBASE_MEMORY_CONFIGURATION_INVALID", "Codebase Memory configuration is invalid.");
  return { enabled: result.data.CODEBASE_MEMORY_ENABLED === "true", timeoutMs: result.data.CODEBASE_MEMORY_REQUEST_TIMEOUT_MS, maxConcurrentRequests: result.data.CODEBASE_MEMORY_MAX_CONCURRENT_REQUESTS, cacheTtlSeconds: result.data.CODEBASE_MEMORY_CACHE_TTL_SECONDS, maxResults: result.data.CODEBASE_MEMORY_MAX_RESULTS, maxSourceBytes: result.data.CODEBASE_MEMORY_MAX_SOURCE_BYTES, executable: result.data.CODEBASE_MEMORY_EXECUTABLE, generatedProjectsRoot: result.data.GENERATED_PROJECTS_ROOT };
}
