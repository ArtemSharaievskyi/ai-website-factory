import { createHash } from "node:crypto";
import { Context7Cache } from "./cache";
import { readContext7Config, type Context7Config } from "./config";
import { Context7Error } from "./errors";
import { Context7LibrarySchema, Context7QueryPlanSchema, type Context7DocumentationPort, type Context7QueryInput, type Context7QueryPlan, type Context7QueryResult, type Context7ResolutionInput, type Context7SafeEventSink, type Context7Transport, type ResolvedContext7Library } from "./contracts";
import { normalizeContext7Response } from "./normalize";
import { validatePackageAccess, validateTopic } from "./policy";

const fixedStack = ["next", "react", "react-dom", "typescript", "tailwindcss", "zod", "vitest"];
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.")); }, { once: true }); });
export class Context7Service implements Context7DocumentationPort {
  private readonly inFlight = new Map<string, Promise<Context7QueryResult>>(); private readonly idempotency = new Map<string, string>(); private active = 0; private readonly queued: Array<{ run: () => void; signal?: AbortSignal; cleanup?: () => void }> = [];
  constructor(private readonly transport: Context7Transport, private readonly config: Context7Config = readContext7Config(), private readonly cache = new Context7Cache(".context7-cache", config.cacheTtlSeconds), private readonly eventSink?: Context7SafeEventSink) {}
  async resolveLibrary(input: Context7ResolutionInput): Promise<ResolvedContext7Library> {
    validatePackageAccess(input.packageName, { dependencyPlan: input.dependencyPlan, fixedStack, designApprovesMotion: input.designApprovesMotion });
    const planned = input.dependencyPlan?.find((entry) => entry.name === input.packageName)?.version; const installed = input.packageJson?.[input.packageName];
    if ((input.configuredVersion && planned && input.configuredVersion !== planned) || (planned && installed && installed !== planned)) throw new Context7Error("CONTEXT7_VERSION_CONFLICT", "Approved and detected dependency versions conflict.");
    const version = planned ?? installed ?? input.configuredVersion; const source = planned ? "dependency-plan" : installed ? "package-json" : input.configuredVersion ? "fixed-stack" : "unresolved";
    return Context7LibrarySchema.parse({ packageName: input.packageName, resolvedLibraryId: input.packageName, version, versionUnresolved: !version, source });
  }
  async queryDocumentation(input: Context7QueryInput): Promise<Context7QueryResult> {
    const plan = Context7QueryPlanSchema.parse(input.plan); validateTopic(plan.topic); void this.eventSink?.({ type: "query.planned", queryId: plan.queryId, requesterRole: plan.requesterRole, taskType: plan.taskType, packageName: plan.packageName, version: plan.version, topic: plan.topic }); if (!this.config.enabled) throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 is disabled.");
    if (input.cancellation?.aborted) throw new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.");
    const canonical = createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex"); const priorHash = this.idempotency.get(input.idempotencyKey); if (priorHash && priorHash !== canonical) throw new Context7Error("IDEMPOTENCY_CONFLICT", "Context7 idempotency key was reused with a different query."); this.idempotency.set(input.idempotencyKey, canonical); const prior = this.inFlight.get(input.idempotencyKey); if (prior) return prior;
    const promise = this.run(plan, input.cancellation); this.inFlight.set(input.idempotencyKey, promise); try { return await promise; } finally { this.inFlight.delete(input.idempotencyKey); }
  }
  private async run(plan: Context7QueryPlan, signal?: AbortSignal): Promise<Context7QueryResult> {
    const cached = await this.cache.get(plan); if (cached) { void this.eventSink?.({ type: "cache.hit", queryId: plan.queryId, requesterRole: plan.requesterRole, taskType: plan.taskType, packageName: plan.packageName, version: plan.version, topic: plan.topic, excerptCount: cached.excerpts.length, byteCount: cached.totalBytes, cacheState: "hit" }); return cached; } void this.eventSink?.({ type: "cache.miss", queryId: plan.queryId, requesterRole: plan.requesterRole, taskType: plan.taskType, packageName: plan.packageName, version: plan.version, topic: plan.topic, cacheState: "miss" }); const result = await this.enqueue(() => this.request(plan, signal), signal); if (!signal?.aborted) await this.cache.set(plan, result); return result;
  }
  private enqueue<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> { if (signal?.aborted) return Promise.reject(new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.")); if (this.active < this.config.maxConcurrentRequests) { this.active++; return work().finally(() => this.release()); } return new Promise<T>((resolve, reject) => { const waiter = { run: () => { if (signal?.aborted) { reject(new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.")); return; } this.active++; void work().then(resolve, reject).finally(() => this.release()); }, signal, cleanup: undefined as (() => void) | undefined }; const onAbort = () => { const index = this.queued.indexOf(waiter); if (index >= 0) this.queued.splice(index, 1); waiter.cleanup?.(); reject(new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.")); }; waiter.cleanup = () => signal?.removeEventListener("abort", onAbort); signal?.addEventListener("abort", onAbort, { once: true }); this.queued.push(waiter); }); }
  private release() { this.active--; while (this.queued.length) { const next = this.queued.shift(); next?.cleanup?.(); if (next?.signal?.aborted) continue; next?.run(); break; } }
  private async request(plan: Context7QueryPlan, signal?: AbortSignal): Promise<Context7QueryResult> {
    let controller = new AbortController(); const onAbort = () => controller.abort(); signal?.addEventListener("abort", onAbort, { once: true }); let attempt = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.");
        controller = new AbortController();
        let cancel: (() => void) | undefined; let timeout: ReturnType<typeof setTimeout> | undefined;
        const cancellation = signal ? new Promise<never>((_, reject) => { cancel = () => reject(new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.")); signal.addEventListener("abort", cancel, { once: true }); }) : undefined;
        const transport = Promise.resolve().then(() => this.transport({ libraryId: plan.resolvedLibraryId, packageName: plan.packageName, version: plan.version, topic: plan.topic, symbol: plan.symbol, signal: controller.signal }));
        try {
          const response = await Promise.race([transport, new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Context7Error("CONTEXT7_TIMEOUT", "Context7 request timed out.")); }, this.config.timeoutMs); }), ...(cancellation ? [cancellation] : [])]);
          const excerpts = normalizeContext7Response(response, plan); return { queryId: plan.queryId, excerpts, totalBytes: excerpts.reduce((sum, item) => sum + Buffer.byteLength(item.content, "utf8"), 0), cache: "miss", versionUnresolved: !plan.version };
        } catch (error) {
          const mapped = error instanceof Context7Error ? error : new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 request failed safely.", error);
          if (mapped.code === "CONTEXT7_TIMEOUT" || mapped.code === "CONTEXT7_CANCELLED") { controller.abort(); await transport.catch(() => undefined); }
          if (mapped.code === "CONTEXT7_CANCELLED" || mapped.code === "CONTEXT7_UNSAFE_CONTENT" || mapped.code === "CONTEXT7_TIMEOUT" && signal?.aborted) throw mapped;
          if (!( ["CONTEXT7_TIMEOUT", "CONTEXT7_UNAVAILABLE", "CONTEXT7_RATE_LIMITED"].includes(mapped.code)) || attempt >= this.config.maxRetries) throw attempt ? new Context7Error("CONTEXT7_RETRY_EXHAUSTED", "Context7 retries were exhausted.", mapped) : mapped;
          attempt++; await sleep(20 * attempt, signal);
        } finally { if (timeout) clearTimeout(timeout); if (cancel) signal?.removeEventListener("abort", cancel); }
      }
    } finally { signal?.removeEventListener("abort", onAbort); controller.abort(); }
  }
}
export function createDisabledContext7Service() { return { resolveLibrary: async () => { throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 is disabled."); }, queryDocumentation: async () => { throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 is disabled."); } } satisfies Context7DocumentationPort; }
export function syntheticContext7Transport(): Context7Transport { return async ({ packageName, topic, signal }) => { if (signal.aborted) throw new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled."); return [{ title: `${packageName} documentation`, content: `Synthetic reference for ${topic}.`, sourceReference: "synthetic:context7-smoke", relevanceReason: "Narrow synthetic smoke query" }]; }; }
