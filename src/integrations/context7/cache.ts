import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactToolText } from "@/orchestration/tooling/executors";
import type { Context7QueryPlan, Context7QueryResult } from "./contracts";

export class Context7Cache {
  constructor(private readonly root: string, private readonly ttlSeconds: number, private readonly maxItems = 100) {}
  private key(plan: Context7QueryPlan) { return createHash("sha256").update(JSON.stringify({ library: plan.resolvedLibraryId, package: plan.packageName, version: plan.version, topic: plan.topic, symbol: plan.symbol, normalization: 1 }), "utf8").digest("hex"); }
  private persisted(result: Context7QueryResult): Context7QueryResult {
    const excerpts = result.excerpts.map((excerpt) => {
      const content = redactToolText(excerpt.content);
      return { ...excerpt, title: redactToolText(excerpt.title), content, sourceReference: redactToolText(excerpt.sourceReference), relevanceReason: redactToolText(excerpt.relevanceReason), checksum: createHash("sha256").update(content, "utf8").digest("hex") };
    });
    return { ...result, excerpts, totalBytes: excerpts.reduce((total, excerpt) => total + Buffer.byteLength(excerpt.content, "utf8"), 0) };
  }
  async get(plan: Context7QueryPlan): Promise<Context7QueryResult | undefined> { try { const file = path.join(this.root, `${this.key(plan)}.json`); const value = JSON.parse(await readFile(file, "utf8")) as { storedAt: number; result: Context7QueryResult }; if (Date.now() - value.storedAt > this.ttlSeconds * 1000) { await rm(file, { force: true }); return undefined; } return { ...value.result, cache: "hit" }; } catch { return undefined; } }
  async set(plan: Context7QueryPlan, result: Context7QueryResult) { await mkdir(this.root, { recursive: true }); const files = (await readdir(this.root)).filter((name) => name.endsWith(".json")); if (files.length >= this.maxItems) await rm(path.join(this.root, files.sort()[0]), { force: true }); await writeFile(path.join(this.root, `${this.key(plan)}.json`), JSON.stringify({ storedAt: Date.now(), result: { ...this.persisted(result), cache: "miss" } }), { encoding: "utf8", flag: "wx" }).catch(() => undefined); }
}
