import OpenAI from "openai";
import { readAiProviderConfig } from "./config";
import { OpenAiStructuredClient, type StructuredExecutor } from "./client";
import { createProviderAdapters } from "./adapters";
import type { ProviderEventSink, ProviderUsageSink } from "./usage";
export function createProductionProviderBundle(options: { env?: Record<string, string | undefined>; client?: OpenAI; executor?: StructuredExecutor; usageSink?: ProviderUsageSink; eventSink?: ProviderEventSink } = {}) { const config = readAiProviderConfig(options.env, true); const ai = new OpenAiStructuredClient(config, options); return { config, ai, ...createProviderAdapters(ai) }; }
