export type ProviderUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; requestCount: number; retryCount: number; correctionCount: number; provider: string; model: string; role: string; promptVersion: string };
export type ProviderUsageSink = (usage: ProviderUsage) => void | Promise<void>;
export type SafeProviderEvent = { type: "request.started" | "request.completed" | "request.failed"; provider: string; model: string; role: string; promptVersion: string; requestId?: string; code?: string; retryCount?: number; startedAt?: string; completedAt?: string; elapsedMs?: number };
export type ProviderEventSink = (event: SafeProviderEvent) => void;
