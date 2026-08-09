import { AiProviderError } from "./errors";
type Waiter = { resolve: () => void; reject: (error: unknown) => void; signal?: AbortSignal };
export class FifoConcurrencyLimiter {
  private active = 0; private readonly queue: Waiter[] = [];
  constructor(private readonly limit: number, private readonly maxQueue = 16) {}
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.");
    if (this.active >= this.limit && this.queue.length >= this.maxQueue) throw new AiProviderError("AI_CONCURRENCY_LIMIT_REACHED", "AI provider concurrency queue is full.");
    await new Promise<void>((resolve, reject) => { const waiter = { resolve, reject, signal }; const onAbort = () => { const index = this.queue.indexOf(waiter); if (index >= 0) this.queue.splice(index, 1); reject(new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.")); }; signal?.addEventListener("abort", onAbort, { once: true }); this.queue.push(waiter); this.drain(); });
    try { return await work(); } finally { this.active--; this.drain(); }
  }
  private drain() { while (this.active < this.limit && this.queue.length) { const waiter = this.queue.shift()!; if (waiter.signal?.aborted) { waiter.reject(new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.")); continue; } this.active++; waiter.resolve(); } }
}
