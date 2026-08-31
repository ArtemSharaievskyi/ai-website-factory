import { createHash } from "node:crypto";
import { CodebaseMemoryError } from "./errors";
import { CodebaseMemoryQueryPlanSchema, CodeSymbolReferenceSchema, CodeRelationshipSchema, ImpactAnalysisSchema, SourceExcerptSchema } from "./contracts";
import type { CodebaseMemoryConfig } from "./config";
import type { CodebaseMemoryIndex, CodebaseMemoryPort, CodebaseMemoryQueryPlan, CodebaseMemoryResult, CodebaseMemorySafeEventSink, CodeRelationship, CodeSymbolReference, ImpactAnalysis, SourceExcerpt, WorkspaceScope } from "./contracts";
import { assertExistingWorkspace, canonicalWorkspaceIdentity, computeSourceManifest, isSafeQueryText, CODEBASE_MEMORY_POLICY_VERSION } from "./policy";
import { metadataForIndex, parsePersistedIndex, parsePersistedResult, readCodebaseMemoryMetadata, writeCodebaseMemoryMetadata } from "./metadata";
import type { UpstreamTool, UpstreamTransport } from "./transport";
import { redactToolText } from "@/orchestration/tooling/executors";

const ADAPTER_VERSION = "codebase-memory-adapter-v1";
const MAX_IDEMPOTENCY_ENTRIES = 10000;
const MAX_CACHE_ENTRIES = 10000;
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const upstreamProjectName = (scope: Pick<WorkspaceScope, "projectId" | "projectVersion">) => `${scope.projectId}-v${scope.projectVersion}`;
function truncateUtf8(text: string, maxBytes: number) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return text.slice(0, end);
}
type Stored = { index: CodebaseMemoryIndex };
type CacheEntry = { scopeKey: string; expiresAt: number; result: CodebaseMemoryResult };
type IdempotencyEntry = { scopeKey: string; inputHash: string };
export const CODEBASE_MEMORY_RAW_RESULT_MAX_BYTES = 200_000;

function parseUpstreamResult(raw: string): unknown {
  if (typeof raw !== "string") throw new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Codebase Memory returned a non-serialized result.");
  if (Buffer.byteLength(raw, "utf8") > CODEBASE_MEMORY_RAW_RESULT_MAX_BYTES) throw new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Codebase Memory result exceeded the bounded transport limit.");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Codebase Memory result was not valid JSON.", error);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function upstreamRows(raw: unknown): unknown[] {
  const envelope = record(raw);
  const value = record(envelope?.structuredContent) ?? envelope ?? {};
  if (Array.isArray(value.results)) return value.results;
  if (!Array.isArray(value.rows)) return [];
  const columns = Array.isArray(value.cols) ? value.cols.filter((column): column is string => typeof column === "string") : [];
  return value.rows.map((row) => {
    if (!Array.isArray(row)) return row;
    const mapped = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    const qn = typeof mapped.qn === "string" ? mapped.qn : undefined;
    const lines = typeof mapped.lines === "string" ? mapped.lines.match(/^(\d+)(?:-(\d+))?$/) : undefined;
    return {
      ...mapped,
      name: typeof mapped.name === "string" ? mapped.name : qn?.split(".").at(-1),
      lineStart: lines ? Number(lines[1]) : undefined,
      lineEnd: lines ? Number(lines[2] ?? lines[1]) : undefined,
    };
  });
}

export class CodebaseMemoryService implements CodebaseMemoryPort {
  private readonly indexes = new Map<string, Stored>();
  private readonly indexInFlight = new Map<string, Promise<CodebaseMemoryIndex>>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly stateInFlight = new Map<string, Promise<void>>();
  private readonly persistInFlight = new Map<string, Promise<void>>();
  private readonly loadedState = new Set<string>();
  private active = 0;
  private queue: Array<{ run: () => void; signal?: AbortSignal }> = [];

  constructor(private readonly transport: UpstreamTransport, private readonly config: CodebaseMemoryConfig, private readonly events?: CodebaseMemorySafeEventSink) {}

  async ensureIndex(scope: WorkspaceScope, taskId?: string, signal?: AbortSignal) { return this.index(scope, false, taskId, signal); }
  async refreshIndex(scope: WorkspaceScope, taskId?: string, signal?: AbortSignal) { return this.index(scope, true, taskId, signal); }

  async getIndexStatus(scope: WorkspaceScope, signal?: AbortSignal) {
    this.assertNotCancelled(signal);
    const safe = await assertExistingWorkspace(scope);
    this.assertNotCancelled(signal);
    const manifest = await computeSourceManifest(safe);
    this.assertNotCancelled(signal);
    const key = canonicalWorkspaceIdentity(safe);
    await this.ensureStateLoaded(safe, key);
    this.assertNotCancelled(signal);
    const stored = this.indexes.get(key);
    if (!stored) return this.baseIndex(safe, manifest.checksum, "NOT_INDEXED");
    if (stored.index.manifestChecksum !== manifest.checksum && stored.index.status === "READY") {
      stored.index = { ...stored.index, status: "STALE", updatedAt: new Date().toISOString() };
      this.assertNotCancelled(signal);
      await this.persistState(safe, key);
      void this.event({ type: "index.stale", ...this.meta(safe), indexChecksum: manifest.checksum });
    }
    return stored.index;
  }

  findSymbol(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.query(plan, "findSymbol", "search_graph", { query: plan.symbol ?? plan.topic, format: "json" }, signal); }
  findFile(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.query(plan, "findFile", "search_graph", { label: "File", file_pattern: plan.file ?? plan.topic, name_pattern: ".*", format: "json" }, signal); }
  findReferences(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.graph(plan, "findReferences", "CALL_REFERENCE", signal); }
  findImports(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.graph(plan, "findImports", "IMPORTS", signal); }
  findCallers(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.trace(plan, "findCallers", "inbound", signal); }
  findCallees(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.trace(plan, "findCallees", "outbound", signal); }
  findRoutes(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.query(plan, "findRoutes", "search_graph", { label: "Route", name_pattern: `.*${escapeRegex(plan.topic ?? plan.symbol ?? ".*")}.*`, format: "json" }, signal); }
  getRelevantSource(plan: CodebaseMemoryQueryPlan, signal?: AbortSignal) { return this.query(plan, "getRelevantSource", "get_code_snippet", { qualified_name: plan.symbol ?? plan.topic }, signal); }

  async analyzeImpact(plan: CodebaseMemoryQueryPlan & { changeTarget: string; authorizedFileScope: string[]; maximumDepth: number }, signal?: AbortSignal): Promise<ImpactAnalysis> {
    const result = await this.graph(plan, "analyzeImpact", "CALL_REFERENCE", signal);
    const files = [...new Set([...result.symbols.map((x) => x.file), ...result.excerpts.map((x) => x.file)])];
    const outside = files.filter((file) => !plan.authorizedFileScope.some((scope) => file === scope || file.startsWith(scope.replace("**", "").replace(/\/$/, ""))));
    if (outside.length) throw new CodebaseMemoryError("CODEBASE_MEMORY_SCOPE_EXPANSION_REQUIRED", "Impact analysis found files outside the authorized task scope.");
    const impact = ImpactAnalysisSchema.parse({ taskId: plan.taskId, target: plan.changeTarget, affectedFiles: files.slice(0, this.config.maxResults), relationships: result.relationships.slice(0, 200), confidence: result.relationships.length ? 0.8 : 0.4, provenance: "Codebase Memory normalized graph query", scopeExpansionRequired: false });
    void this.event({ type: "impact.completed", ...this.meta(plan), resultCount: impact.affectedFiles.length });
    return impact;
  }

  private async index(scope: WorkspaceScope, refresh: boolean, taskId?: string, signal?: AbortSignal) {
    this.assertNotCancelled(signal);
    const safe = await assertExistingWorkspace(scope);
    const key = canonicalWorkspaceIdentity(safe);
    await this.ensureStateLoaded(safe, key);
    this.assertNotCancelled(signal);
    const existing = this.indexInFlight.get(key);
    if (existing) return this.awaitWithSignal(existing, signal);
    const work = this.indexInternal(safe, key, refresh, taskId);
    this.indexInFlight.set(key, work);
    void work.then(() => this.clearIndexWork(key, work), () => this.clearIndexWork(key, work));
    return this.awaitWithSignal(work, signal);
  }

  private async indexInternal(safe: WorkspaceScope, key: string, refresh: boolean, taskId?: string) {
    const manifest = await computeSourceManifest(safe);
    const prior = this.indexes.get(key)?.index;
    if (!refresh && prior?.status === "READY" && prior.manifestChecksum === manifest.checksum) return prior;
    const index = this.baseIndex(safe, manifest.checksum, "INDEXING");
    this.indexes.set(key, { index });
    void this.event({ type: "index.requested", ...this.meta(safe), taskId, indexChecksum: manifest.checksum });
    let serviceBoundaryRejected = false;
    try {
      const raw = await this.limited((requestSignal) => this.transport("index_repository", { repo_path: safe.workspacePath, name: upstreamProjectName(safe) }, requestSignal));
      try {
        parseUpstreamResult(raw);
      } catch (error) {
        serviceBoundaryRejected = true;
        throw error;
      }
      const ready = { ...index, status: "READY" as const, indexedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.indexes.set(key, { index: ready });
      await this.persistState(safe, key);
      void this.event({ type: "index.ready", ...this.meta(safe), taskId, indexChecksum: manifest.checksum });
      return ready;
    } catch (error) {
      const mapped = error instanceof CodebaseMemoryError ? error : new CodebaseMemoryError("CODEBASE_MEMORY_INDEX_FAILED", "Indexing failed safely.", error);
      if (serviceBoundaryRejected) throw mapped;
      this.indexes.set(key, { index: { ...index, status: "FAILED", updatedAt: new Date().toISOString(), errorCode: mapped.code } });
      await this.persistState(safe, key);
      void this.event({ type: "index.failed", ...this.meta(safe), taskId, errorCode: mapped.code });
      throw mapped;
    }
  }

  private async query(plan: CodebaseMemoryQueryPlan, operation: CodebaseMemoryQueryPlan["operation"] | string, tool: UpstreamTool, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.runQuery(plan, operation as CodebaseMemoryQueryPlan["operation"], (requestSignal) => this.transport(tool, { project: upstreamProjectName(plan), ...args }, requestSignal), signal);
  }

  private async graph(plan: CodebaseMemoryQueryPlan, operation: string, type: string, signal?: AbortSignal) {
    const target = plan.symbol ?? plan.file ?? plan.topic ?? "";
    isSafeQueryText(target);
    return this.runQuery(plan, operation as CodebaseMemoryQueryPlan["operation"], (requestSignal) => this.transport("query_graph", { project: upstreamProjectName(plan), query: `MATCH (s)-[r:${type}]->(t) WHERE s.name CONTAINS '${target.replaceAll("'", "")}' RETURN s,r,t LIMIT ${plan.maxResults}` }, requestSignal), signal);
  }

  private async trace(plan: CodebaseMemoryQueryPlan, operation: string, direction: "inbound" | "outbound", signal?: AbortSignal) {
    return this.runQuery(plan, operation as CodebaseMemoryQueryPlan["operation"], (requestSignal) => this.transport("trace_path", { project: upstreamProjectName(plan), function_name: plan.symbol ?? plan.topic, direction, depth: 3, limit: plan.maxResults }, requestSignal), signal);
  }

  private async runQuery(plan: CodebaseMemoryQueryPlan, operation: CodebaseMemoryQueryPlan["operation"], work: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<CodebaseMemoryResult> {
    CodebaseMemoryQueryPlanSchema.parse({ ...plan, operation });
    if (plan.workspaceScope.projectId !== plan.projectId || plan.workspaceScope.projectVersion !== plan.projectVersion) throw new CodebaseMemoryError("CODEBASE_MEMORY_WORKSPACE_INVALID", "The query workspace scope does not match the query project identity.");
    isSafeQueryText(plan.symbol ?? plan.file ?? plan.topic ?? "");
    await this.ensureStateLoaded(plan.workspaceScope, canonicalWorkspaceIdentity(plan.workspaceScope));
    const index = this.findIndex(plan);
    if (!index || index.status !== "READY" || index.manifestChecksum !== plan.sourceManifestChecksum) throw new CodebaseMemoryError("CODEBASE_MEMORY_INDEX_STALE", "A current READY Codebase Memory index is required.");
    const scopeKey = canonicalWorkspaceIdentity(index.scope);
    const key = `${plan.projectId}:${plan.projectVersion}:${plan.sourceManifestChecksum}:${operation}:${sha(JSON.stringify(plan))}`;
    const prior = this.idempotency.get(plan.queryId);
    if (prior && (prior.scopeKey !== scopeKey || prior.inputHash !== key)) throw new CodebaseMemoryError("IDEMPOTENCY_CONFLICT", "Codebase Memory query id was reused with a different input.");
    this.rememberIdempotency(plan.queryId, { scopeKey, inputHash: key });
    const cached = this.cache.get(key);
    if (cached && cached.scopeKey === scopeKey && cached.expiresAt > Date.now()) {
      void this.event({ type: "cache.hit", ...this.meta(plan), operation });
      return { ...cached.result, cache: "hit" };
    }
    void this.event({ type: "cache.miss", ...this.meta(plan), operation });
    if (signal?.aborted) throw new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory query was cancelled.");
    const raw = await this.limited(work, signal);
    const normalized = this.normalize(parseUpstreamResult(raw), plan, operation, index);
    this.rememberCache(key, { scopeKey, expiresAt: Date.now() + this.config.cacheTtlSeconds * 1000, result: normalized });
    await this.persistState(index.scope, scopeKey);
    void this.event({ type: "query.completed", ...this.meta(plan), operation, resultCount: normalized.symbols.length + normalized.relationships.length, sourceByteCount: normalized.totalBytes });
    return normalized;
  }

  private normalize(raw: unknown, plan: CodebaseMemoryQueryPlan, operation: CodebaseMemoryQueryPlan["operation"], index: CodebaseMemoryIndex): CodebaseMemoryResult {
    const value = raw as { content?: Array<{ text?: string }> };
    const rows = upstreamRows(raw);
    const symbols = [];
    const relationships: CodeRelationship[] = [];
    for (const row of rows.slice(0, plan.maxResults)) {
      const item = row as Record<string, unknown>;
      if (typeof item.name === "string" && typeof item.file === "string") symbols.push(CodeSymbolReferenceSchema.parse({ symbol: item.name, kind: typeof item.label === "string" ? item.label : "symbol", file: item.file, lineStart: typeof item.lineStart === "number" ? item.lineStart : undefined, lineEnd: typeof item.lineEnd === "number" ? item.lineEnd : undefined, exported: undefined, signatureSummary: typeof item.signature === "string" ? item.signature : undefined }));
      if (typeof item.source === "string" && typeof item.target === "string") relationships.push(CodeRelationshipSchema.parse({ sourceSymbol: item.source, targetSymbol: item.target, relationshipType: this.relationshipType(operation), provenance: "Codebase Memory MCP" }));
    }
    const excerpts: SourceExcerpt[] = [];
    const rawText = (Array.isArray(value?.content) ? value.content : rows).map((row) => typeof row === "string" ? row : typeof (row as { text?: unknown })?.text === "string" ? (row as { text: string }).text : "").filter(Boolean).join("\n");
    const text = truncateUtf8(rawText, plan.maxBytes);
    if (text) excerpts.push(SourceExcerptSchema.parse({ file: plan.file ?? plan.symbol ?? "result", text, lineStart: 1, lineEnd: text.split(/\r?\n/).length, bytes: Buffer.byteLength(text, "utf8"), checksum: sha(text) }));
    return { queryId: plan.queryId, operation, index, symbols, relationships, excerpts, totalBytes: Buffer.byteLength(text, "utf8"), cache: "miss" };
  }

  private relationshipType(operation: string): CodeRelationship["relationshipType"] { return operation.includes("Import") ? "imports" : operation.includes("Caller") ? "called-by" : operation.includes("Callee") ? "calls" : operation.includes("Reference") ? "references" : "depends-on"; }
  private baseIndex(scope: WorkspaceScope, manifestChecksum: string, status: CodebaseMemoryIndex["status"]): CodebaseMemoryIndex { return { indexId: sha(canonicalWorkspaceIdentity(scope) + manifestChecksum), scope, workspaceIdentity: canonicalWorkspaceIdentity(scope), manifestChecksum, policyVersion: CODEBASE_MEMORY_POLICY_VERSION, adapterVersion: ADAPTER_VERSION, status, updatedAt: new Date().toISOString() }; }
  private meta(input: WorkspaceScope | CodebaseMemoryQueryPlan) { return { projectId: input.projectId, projectVersion: input.projectVersion }; }
  private findIndex(plan: CodebaseMemoryQueryPlan) { const workspaceIdentity = canonicalWorkspaceIdentity(plan.workspaceScope); return [...this.indexes.values()].map((value) => value.index).find((index) => index.workspaceIdentity === workspaceIdentity); }
  private async event(event: Parameters<CodebaseMemorySafeEventSink>[0]) { await this.events?.(event); }

  private async ensureStateLoaded(scope: WorkspaceScope, key: string) {
    if (this.loadedState.has(key)) return;
    const existing = this.stateInFlight.get(key);
    if (existing) return existing;
    const work = this.loadState(scope, key);
    this.stateInFlight.set(key, work);
    try { await work; } finally { this.stateInFlight.delete(key); }
  }

  private async loadState(scope: WorkspaceScope, key: string) {
    const state = await readCodebaseMemoryMetadata(scope);
    if (!state) { this.loadedState.add(key); return; }
    const expectedIdentity = canonicalWorkspaceIdentity(scope);
    if (state.projectId !== scope.projectId || state.projectVersion !== scope.projectVersion || state.workspaceIdentity !== expectedIdentity || state.index.workspaceIdentity !== expectedIdentity || canonicalWorkspaceIdentity(state.index.scope) !== expectedIdentity || state.metadata.currentIndexId !== state.index.indexId || state.metadata.manifestChecksum !== state.index.manifestChecksum || state.metadata.status !== state.index.status) throw new CodebaseMemoryError("CODEBASE_MEMORY_METADATA_INVALID", "Codebase Memory metadata is bound to a different project, version, or workspace.");
    this.indexes.set(key, { index: parsePersistedIndex(state.index) });
    for (const entry of state.idempotency) this.rememberIdempotency(entry.queryId, { scopeKey: key, inputHash: entry.inputHash });
    for (const entry of state.cache) if (entry.expiresAt > Date.now()) this.rememberCache(entry.key, { scopeKey: key, expiresAt: entry.expiresAt, result: parsePersistedResult(entry.result) });
    this.loadedState.add(key);
  }

  private async persistState(scope: WorkspaceScope, key: string) {
    const previous = this.persistInFlight.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.persistStateSnapshot(scope, key));
    this.persistInFlight.set(key, next);
    try { await next; } finally { if (this.persistInFlight.get(key) === next) this.persistInFlight.delete(key); }
  }

  private async persistStateSnapshot(scope: WorkspaceScope, key: string) {
    const stored = this.indexes.get(key);
    if (!stored) return;
    const now = Date.now();
    const state = {
      schemaVersion: 1 as const,
      projectId: scope.projectId,
      projectVersion: scope.projectVersion,
      workspaceIdentity: key,
      metadata: metadataForIndex(stored.index),
      index: stored.index,
      idempotency: [...this.idempotency.entries()].filter(([, entry]) => entry.scopeKey === key).map(([queryId, entry]) => ({ queryId, inputHash: entry.inputHash })),
      cache: [...this.cache.entries()].filter(([, entry]) => entry.scopeKey === key && entry.expiresAt > now).map(([cacheKey, entry]) => ({ key: cacheKey, expiresAt: entry.expiresAt, result: this.redactPersistedResult({ ...entry.result, cache: "miss" as const }) })),
    };
    await writeCodebaseMemoryMetadata(scope, state);
  }

  private rememberIdempotency(queryId: string, entry: IdempotencyEntry) {
    this.idempotency.delete(queryId);
    this.idempotency.set(queryId, entry);
    while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) this.idempotency.delete(this.idempotency.keys().next().value as string);
  }

  private rememberCache(key: string, entry: CacheEntry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
  }

  private assertNotCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.");
  }

  private awaitWithSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled."));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.")); };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      work.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
  }

  private clearIndexWork(key: string, work: Promise<CodebaseMemoryIndex>) {
    if (this.indexInFlight.get(key) === work) this.indexInFlight.delete(key);
  }

  private redactPersistedResult(result: CodebaseMemoryResult): CodebaseMemoryResult {
    const redactSymbol = (symbol: CodeSymbolReference): CodeSymbolReference => ({
      ...symbol,
      symbol: redactToolText(symbol.symbol),
      kind: redactToolText(symbol.kind),
      file: redactToolText(symbol.file),
      ...(symbol.signatureSummary === undefined ? {} : { signatureSummary: redactToolText(symbol.signatureSummary) }),
    });
    const redactLocation = (location: Partial<CodeSymbolReference>) => ({
      ...location,
      ...(location.symbol === undefined ? {} : { symbol: redactToolText(location.symbol) }),
      ...(location.kind === undefined ? {} : { kind: redactToolText(location.kind) }),
      ...(location.file === undefined ? {} : { file: redactToolText(location.file) }),
      ...(location.signatureSummary === undefined ? {} : { signatureSummary: redactToolText(location.signatureSummary) }),
    });
    const redactRelationship = (relationship: CodeRelationship): CodeRelationship => ({
      ...relationship,
      sourceSymbol: redactToolText(relationship.sourceSymbol),
      targetSymbol: redactToolText(relationship.targetSymbol),
      ...(relationship.sourceLocation === undefined ? {} : { sourceLocation: redactLocation(relationship.sourceLocation) }),
    });
    const excerpts = result.excerpts.map((excerpt) => {
      const text = truncateUtf8(redactToolText(excerpt.text), 20_000);
      return { ...excerpt, text, bytes: Buffer.byteLength(text, "utf8"), checksum: sha(text) };
    });
    const impact = result.impact === undefined ? undefined : {
      ...result.impact,
      affectedFiles: result.impact.affectedFiles.map((file) => redactToolText(file)),
      relationships: result.impact.relationships.map(redactRelationship),
    };
    return {
      ...result,
      symbols: result.symbols.map(redactSymbol),
      relationships: result.relationships.map(redactRelationship),
      excerpts,
      ...(impact === undefined ? {} : { impact }),
      totalBytes: excerpts.reduce((total, excerpt) => total + excerpt.bytes, 0),
    };
  }

  private async limited<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.");
    if (this.active >= this.config.maxConcurrentRequests) {
      await new Promise<void>((resolve, reject) => {
        const waiter = { run: resolve, signal };
        const onAbort = () => { const index = this.queue.indexOf(waiter); if (index >= 0) this.queue.splice(index, 1); reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.")); };
        signal?.addEventListener("abort", onAbort, { once: true });
        this.queue.push(waiter);
      });
    }
    this.active++;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const transport = Promise.resolve().then(() => work(controller.signal));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancellation = signal ? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.")), { once: true })) : undefined;
      try {
        return await Promise.race([transport, new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new CodebaseMemoryError("CODEBASE_MEMORY_TIMEOUT", "Codebase Memory request timed out.")); }, this.config.timeoutMs); }), ...(cancellation ? [cancellation] : [])]);
      } catch (error) {
        const mapped = error instanceof CodebaseMemoryError ? error : new CodebaseMemoryError("CODEBASE_MEMORY_INDEX_FAILED", "Codebase Memory request failed safely.", error);
        if (mapped.code === "CODEBASE_MEMORY_TIMEOUT" || mapped.code === "CODEBASE_MEMORY_CANCELLED") { controller.abort(); await transport.catch(() => undefined); }
        throw mapped;
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
      this.active--;
      while (this.queue.length) { const next = this.queue.shift(); if (next?.signal?.aborted) continue; next?.run(); break; }
    }
  }
}
