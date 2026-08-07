import { z } from "zod";
import { AiProviderError } from "./errors";

export const DEFAULT_AI_MODEL_LABEL = "GPT-5.6 Luna";
const EnvironmentSchema = z.object({ OPENAI_API_KEY: z.string().min(1).optional(), OPENAI_MODEL: z.string().min(1).optional(), OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000), OPENAI_PLANNER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).optional(), OPENAI_DESIGN_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).optional(), OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1), OPENAI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(8).default(2) }).strict();
export type AiProviderConfig = { apiKey: string; model: string; modelLabel: string; timeoutMs: number; roleTimeoutMs?: { planner?: number; design?: number }; maxRetries: number; maxConcurrentRequests: number };
export function readAiProviderConfig(env: Record<string, string | undefined> = process.env, requireKey = true): AiProviderConfig {
  if (env.NEXT_PUBLIC_OPENAI_API_KEY) throw new AiProviderError("AI_CONFIGURATION_INVALID", "OpenAI credentials must remain server-only.");
  const parsed = EnvironmentSchema.safeParse({ OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_MODEL: env.OPENAI_MODEL, OPENAI_REQUEST_TIMEOUT_MS: env.OPENAI_REQUEST_TIMEOUT_MS, OPENAI_PLANNER_REQUEST_TIMEOUT_MS: env.OPENAI_PLANNER_REQUEST_TIMEOUT_MS, OPENAI_DESIGN_REQUEST_TIMEOUT_MS: env.OPENAI_DESIGN_REQUEST_TIMEOUT_MS, OPENAI_MAX_RETRIES: env.OPENAI_MAX_RETRIES, OPENAI_MAX_CONCURRENT_REQUESTS: env.OPENAI_MAX_CONCURRENT_REQUESTS });
  if (!parsed.success || (requireKey && !parsed.data?.OPENAI_API_KEY)) throw new AiProviderError("AI_CONFIGURATION_INVALID", "OPENAI_API_KEY and valid provider configuration are required.");
  return { apiKey: parsed.data.OPENAI_API_KEY ?? "", model: parsed.data.OPENAI_MODEL ?? "", modelLabel: DEFAULT_AI_MODEL_LABEL, timeoutMs: parsed.data.OPENAI_REQUEST_TIMEOUT_MS, roleTimeoutMs: { ...(parsed.data.OPENAI_PLANNER_REQUEST_TIMEOUT_MS === undefined ? {} : { planner: parsed.data.OPENAI_PLANNER_REQUEST_TIMEOUT_MS }), ...(parsed.data.OPENAI_DESIGN_REQUEST_TIMEOUT_MS === undefined ? {} : { design: parsed.data.OPENAI_DESIGN_REQUEST_TIMEOUT_MS }) }, maxRetries: parsed.data.OPENAI_MAX_RETRIES, maxConcurrentRequests: parsed.data.OPENAI_MAX_CONCURRENT_REQUESTS };
}
