import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { RegressionLedgerEntrySchema, type ImpactNode, type RegressionLedgerEntry } from "./contracts";

const MAX_LEDGER_ENTRIES = 1000;
const MAX_LEDGER_BYTES = 1_000_000;

export interface RegressionLedgerStore {
  read(): Promise<RegressionLedgerEntry[]>;
  write(entries: readonly RegressionLedgerEntry[]): Promise<void>;
}

export class InMemoryRegressionLedgerStore implements RegressionLedgerStore {
  private entries: RegressionLedgerEntry[] = [];

  async read() { return this.entries.map((entry) => ({ ...entry, regressionTestRefs: [...entry.regressionTestRefs], affectedContracts: [...entry.affectedContracts], affectedRuntimeBoundaries: [...entry.affectedRuntimeBoundaries] })); }
  async write(entries: readonly RegressionLedgerEntry[]) { this.entries = entries.map((entry) => RegressionLedgerEntrySchema.parse(entry)); }
}

/** Bounded, host-selected evidence storage. It never stores provider prose. */
export class FileRegressionLedgerStore implements RegressionLedgerStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    if (!path.isAbsolute(filePath)) throw new Error("REGRESSION_LEDGER_PATH_MUST_BE_ABSOLUTE");
    this.filePath = path.resolve(filePath);
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_LEDGER_BYTES) throw new Error("REGRESSION_LEDGER_TOO_LARGE");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("REGRESSION_LEDGER_INVALID");
      if (parsed.length > MAX_LEDGER_ENTRIES) throw new Error("REGRESSION_LEDGER_TOO_LARGE");
      return parsed.map((entry) => RegressionLedgerEntrySchema.parse(entry));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async write(entries: readonly RegressionLedgerEntry[]) {
    if (entries.length > MAX_LEDGER_ENTRIES) throw new Error("REGRESSION_LEDGER_TOO_LARGE");
    const parsed = entries.map((entry) => RegressionLedgerEntrySchema.parse(entry));
    const content = JSON.stringify(parsed, null, 2) + "\n";
    if (Buffer.byteLength(content, "utf8") > MAX_LEDGER_BYTES) throw new Error("REGRESSION_LEDGER_TOO_LARGE");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: "w", mode: 0o600 });
    try { await rename(temporary, this.filePath); } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
  }
}

export class RegressionLedger {
  constructor(private readonly store: RegressionLedgerStore = new InMemoryRegressionLedgerStore()) {}

  async list(status?: RegressionLedgerEntry["status"]) {
    const entries = await this.store.read();
    return entries.filter((entry) => !status || entry.status === status).sort((a, b) => a.regressionId.localeCompare(b.regressionId));
  }

  async register(value: RegressionLedgerEntry) {
    const entry = RegressionLedgerEntrySchema.parse(value);
    const entries = await this.store.read();
    const existing = entries.find((candidate) => candidate.regressionId === entry.regressionId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error("REGRESSION_LEDGER_CONFLICT");
      return existing;
    }
    if (entries.length >= MAX_LEDGER_ENTRIES) throw new Error("REGRESSION_LEDGER_TOO_LARGE");
    await this.store.write([...entries, entry]);
    return entry;
  }

  /** Exact host-identity matching makes ledger discovery deterministic and non-fuzzy. */
  async discoverForImpact(nodes: readonly ImpactNode[], reachableNodeIds: readonly string[]) {
    const reachable = new Set(reachableNodeIds);
    const exactIdentities = new Set<string>();
    for (const node of nodes) {
      if (!reachable.has(node.nodeId)) continue;
      exactIdentities.add(node.nodeId);
      exactIdentities.add(node.label);
      if (node.path) exactIdentities.add(node.path);
    }
    const entries = await this.list("ACTIVE");
    return entries.filter((entry) => [entry.subsystem, ...entry.affectedContracts, ...entry.affectedRuntimeBoundaries].some((identity) => exactIdentities.has(identity)));
  }
}
