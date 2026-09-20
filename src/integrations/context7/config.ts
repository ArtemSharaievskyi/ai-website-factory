import { z } from "zod";
import { Context7Error } from "./errors";

export const CONTEXT7_DEFAULT_ENDPOINT = "https://mcp.context7.com/mcp";
const EnvironmentSchema = z.object({
  CONTEXT7_ENABLED: z.enum(["true", "false"]).default("false"),
  CONTEXT7_ENDPOINT: z.string().url().default(CONTEXT7_DEFAULT_ENDPOINT),
  CONTEXT7_API_KEY: z.string().min(1).optional(),
  CONTEXT7_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  CONTEXT7_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  CONTEXT7_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(2),
  CONTEXT7_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(900),
}).strict();
export type Context7Config = { enabled: boolean; endpoint: string; apiKey?: string; timeoutMs: number; maxRetries: number; maxConcurrentRequests: number; cacheTtlSeconds: number };
export function readContext7Config(env: Record<string, string | undefined> = process.env): Context7Config {
  if (env.NEXT_PUBLIC_CONTEXT7_ENABLED || env.NEXT_PUBLIC_CONTEXT7_API_KEY) throw new Context7Error("CONTEXT7_CONFIGURATION_INVALID", "Context7 configuration must remain server-only.");
  const parsed = EnvironmentSchema.safeParse({ CONTEXT7_ENABLED: env.CONTEXT7_ENABLED, CONTEXT7_ENDPOINT: env.CONTEXT7_ENDPOINT, CONTEXT7_API_KEY: env.CONTEXT7_API_KEY, CONTEXT7_REQUEST_TIMEOUT_MS: env.CONTEXT7_REQUEST_TIMEOUT_MS, CONTEXT7_MAX_RETRIES: env.CONTEXT7_MAX_RETRIES, CONTEXT7_MAX_CONCURRENT_REQUESTS: env.CONTEXT7_MAX_CONCURRENT_REQUESTS, CONTEXT7_CACHE_TTL_SECONDS: env.CONTEXT7_CACHE_TTL_SECONDS });
  if (!parsed.success) throw new Context7Error("CONTEXT7_CONFIGURATION_INVALID", "Context7 configuration is invalid.");
  return { enabled: parsed.data.CONTEXT7_ENABLED === "true", endpoint: parsed.data.CONTEXT7_ENDPOINT, ...(parsed.data.CONTEXT7_API_KEY ? { apiKey: parsed.data.CONTEXT7_API_KEY } : {}), timeoutMs: parsed.data.CONTEXT7_REQUEST_TIMEOUT_MS, maxRetries: parsed.data.CONTEXT7_MAX_RETRIES, maxConcurrentRequests: parsed.data.CONTEXT7_MAX_CONCURRENT_REQUESTS, cacheTtlSeconds: parsed.data.CONTEXT7_CACHE_TTL_SECONDS };
}
