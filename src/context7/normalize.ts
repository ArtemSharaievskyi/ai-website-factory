import { createHash } from "node:crypto";
import { Context7Error } from "./errors";
import { DocumentationExcerptSchema, type Context7QueryPlan, type DocumentationExcerpt } from "./contracts";
import { SUSPICIOUS_DOCUMENTATION } from "./policy";

type RawExcerpt = { title?: unknown; content?: unknown; sourceReference?: unknown; documentedVersion?: unknown; relevanceReason?: unknown; symbol?: unknown };
export function normalizeContext7Response(raw: unknown, plan: Context7QueryPlan, retrievedAt = new Date().toISOString()): DocumentationExcerpt[] {
  if (!Array.isArray(raw)) throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 returned an invalid response shape.");
  const seen = new Set<string>(); const normalized: DocumentationExcerpt[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue; const item = candidate as RawExcerpt; if (typeof item.title !== "string" || typeof item.content !== "string" || typeof item.sourceReference !== "string") continue;
    if (SUSPICIOUS_DOCUMENTATION.test(item.content)) throw new Context7Error("CONTEXT7_UNSAFE_CONTENT", "Documentation contained instruction-like content and was rejected.");
    const content = item.content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").trim(); if (!content) continue; const checksum = createHash("sha256").update(content, "utf8").digest("hex"); if (seen.has(checksum)) continue; seen.add(checksum);
    const value = DocumentationExcerptSchema.parse({ id: `${plan.queryId}-${normalized.length + 1}`, library: plan.packageName, resolvedLibraryId: plan.resolvedLibraryId, requestedVersion: plan.version, documentedVersion: typeof item.documentedVersion === "string" ? item.documentedVersion : undefined, topic: plan.topic, symbol: typeof item.symbol === "string" ? item.symbol : plan.symbol, title: item.title, content, sourceReference: item.sourceReference, retrievedAt, checksum, relevanceReason: typeof item.relevanceReason === "string" ? item.relevanceReason : plan.reason, truncationState: "complete" });
    normalized.push(value);
  }
  const bounded: DocumentationExcerpt[] = []; let bytes = 0; for (const excerpt of normalized.sort((a, b) => a.title.localeCompare(b.title))) { const excerptBytes = Buffer.byteLength(excerpt.content, "utf8"); if (bounded.length >= plan.maxExcerpts || excerptBytes > plan.maxBytes || bytes + excerptBytes > plan.maxBytes) continue; bounded.push(excerpt); bytes += excerptBytes; }
  return bounded;
}
