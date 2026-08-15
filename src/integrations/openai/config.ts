import { z } from "zod";
import { AiProviderError } from "./errors";

export const DEFAULT_AI_MODEL_LABEL = "GPT-5.6 Luna";
export const DEFAULT_AI_MAX_COMPLETION_TOKENS = 24000;
const EnvironmentSchema = z.object({ OPENAI_API_KEY: z.string().min(1).optional(), OPENAI_MODEL: z.string().min(1), OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1), OPENAI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(8).default(2), OPENAI_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(1000).max(64000).default(DEFAULT_AI_MAX_COMPLETION_TOKENS) }).strict();
export type AiProviderConfig = { apiKey: string; model: string; modelLabel: string; maxRetries: number; maxConcurrentRequests: number; maxCompletionTokens?: number };
export function readAiProviderConfig(env: Record<string, string | undefined> = process.env, requireKey = true): AiProviderConfig {
  if (env.NEXT_PUBLIC_OPENAI_API_KEY) throw new AiProviderError("AI_CONFIGURATION_INVALID", "OpenAI credentials must remain server-only.");
  const parsed = EnvironmentSchema.safeParse({ OPENAI_API_KEY: env.OPENAI_API_KEY, OPENAI_MODEL: env.OPENAI_MODEL, OPENAI_MAX_RETRIES: env.OPENAI_MAX_RETRIES, OPENAI_MAX_CONCURRENT_REQUESTS: env.OPENAI_MAX_CONCURRENT_REQUESTS, OPENAI_MAX_COMPLETION_TOKENS: env.OPENAI_MAX_COMPLETION_TOKENS });
  if (!parsed.success || (requireKey && !parsed.data?.OPENAI_API_KEY)) throw new AiProviderError("AI_CONFIGURATION_INVALID", "OPENAI_API_KEY and valid provider configuration are required.");
  return { apiKey: parsed.data.OPENAI_API_KEY ?? "", model: parsed.data.OPENAI_MODEL, modelLabel: DEFAULT_AI_MODEL_LABEL, maxRetries: parsed.data.OPENAI_MAX_RETRIES, maxConcurrentRequests: parsed.data.OPENAI_MAX_CONCURRENT_REQUESTS, maxCompletionTokens: parsed.data.OPENAI_MAX_COMPLETION_TOKENS };
}
