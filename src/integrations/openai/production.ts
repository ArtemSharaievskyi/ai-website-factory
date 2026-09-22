import OpenAI from "openai";
import { readAiProviderConfig } from "./config";
import { OpenAiStructuredClient, type StructuredExecutor } from "./client";
import { createProviderAdapters } from "./adapters";
import { OpenAiFlareImageProvider } from "./images";
import type { ProviderEventSink, ProviderUsageSink } from "./usage";
export function createProductionProviderBundle(options: { env?: Record<string, string | undefined>; client?: OpenAI; executor?: StructuredExecutor; usageSink?: ProviderUsageSink; eventSink?: ProviderEventSink } = {}) { const config = readAiProviderConfig(options.env, true); const client = options.client ?? new OpenAI({ apiKey: config.apiKey, maxRetries: 0 }); const ai = new OpenAiStructuredClient(config, { ...options, client }); return { config, ai, image: new OpenAiFlareImageProvider(client), ...createProviderAdapters(ai) }; }
