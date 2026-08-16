import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const WindowIdSchema = z.string().uuid();
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const AcceptanceWindowRecordSchema = z.object({
  schemaVersion: z.literal(1),
  windowId: WindowIdSchema,
  runId: WindowIdSchema,
  sourceFingerprint: DigestSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

const ConsumptionMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  windowId: WindowIdSchema,
  consumedAt: z.string().datetime({ offset: true }),
}).strict();

const FinalizableEvidenceEnvelopeSchema = z.object({
  windowId: WindowIdSchema,
  runId: WindowIdSchema,
  sourceFingerprint: DigestSchema,
  status: z.enum(["NOT_RUN", "PASS", "FAIL", "INCONCLUSIVE"]),
  evidenceDigest: DigestSchema,
  evidenceBody: z.unknown(),
}).strict();

export type AcceptanceWindowState = "CREATED" | "CONSUMED" | "FINALIZED";
export type AcceptanceWindowVerdict = "NOT_RUN" | "PASS" | "FAIL" | "INCONCLUSIVE";
export type AcceptanceWindowFaultPoint = "before-temp-write" | "during-temp-write" | "after-temp-write-before-publication" | "during-atomic-publication" | "after-atomic-publication";
export type AcceptanceWindowFaultInjector = { hit(point: AcceptanceWindowFaultPoint): void | Promise<void> };

export class AcceptanceWindowError extends Error {
  readonly name = "AcceptanceWindowError";

  constructor(readonly code: "ACCEPTANCE_WINDOW_ALREADY_CONSUMED" | "ACCEPTANCE_WINDOW_ALREADY_FINALIZED" | "ACCEPTANCE_WINDOW_NOT_FOUND" | "ACCEPTANCE_WINDOW_INVALID_STATE" | "ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT", message = code) {
    super(message);
  }
}

export type AcceptanceWindow = z.infer<typeof AcceptanceWindowRecordSchema> & { state: AcceptanceWindowState };

async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT");
  }
}

async function createExclusiveJson(filePath: string, value: unknown) {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readFinalEvidence(filePath: string, record: z.infer<typeof AcceptanceWindowRecordSchema>) {
  try {
    const serialized = await readFile(filePath, "utf8");
    const envelope = FinalizableEvidenceEnvelopeSchema.parse(JSON.parse(serialized));
    if (envelope.windowId !== record.windowId || envelope.runId !== record.runId || envelope.sourceFingerprint !== record.sourceFingerprint || envelope.evidenceDigest !== digestValue(envelope.evidenceBody)) throw new Error("binding");
    return envelope;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT");
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]));
  return value;
}

function digestValue(value: unknown) { return createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex"); }

export class AcceptanceWindowStore {
  constructor(private readonly root: string) {}

  private windowDirectory(windowId: string) { return path.join(this.root, windowId); }
  private recordPath(windowId: string) { return path.join(this.windowDirectory(windowId), "window.json"); }
  private consumedPath(windowId: string) { return path.join(this.windowDirectory(windowId), "consumed.json"); }
  private evidencePath(windowId: string) { return path.join(this.windowDirectory(windowId), "evidence.json"); }

  async create(input: { sourceFingerprint: string; windowId?: string; runId?: string; now?: string }) {
    const windowId = input.windowId ?? randomUUID();
    const record = AcceptanceWindowRecordSchema.parse({
      schemaVersion: 1,
      windowId,
      runId: input.runId ?? randomUUID(),
      sourceFingerprint: input.sourceFingerprint,
      createdAt: input.now ?? new Date().toISOString(),
    });
    await mkdir(this.windowDirectory(windowId), { recursive: true });
    await createExclusiveJson(this.recordPath(windowId), record);
    return { ...record, state: "CREATED" as const };
  }

  async read(windowId: string): Promise<AcceptanceWindow> {
    const record = await readJson(this.recordPath(windowId), AcceptanceWindowRecordSchema);
    if (!record) throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_NOT_FOUND");
    if (await readFinalEvidence(this.evidencePath(windowId), record)) return { ...record, state: "FINALIZED" };
    const consumed = await readJson(this.consumedPath(windowId), ConsumptionMarkerSchema);
    return { ...record, state: consumed ? "CONSUMED" : "CREATED" };
  }

  async consume(windowId: string, now = new Date().toISOString()) {
    const current = await this.read(windowId);
    if (current.state !== "CREATED") throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ALREADY_CONSUMED");
    try {
      await createExclusiveJson(this.consumedPath(windowId), { schemaVersion: 1, windowId, consumedAt: now });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ALREADY_CONSUMED");
      throw error;
    }
    return this.read(windowId);
  }

  async finalize(input: { windowId: string; runId: string; sourceFingerprint: string; evidenceDigest: string; evidenceSerialized: string; faults?: AcceptanceWindowFaultInjector; now?: string }) {
    const current = await this.read(input.windowId);
    if (current.state === "CREATED") throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_INVALID_STATE");
    if (current.state === "FINALIZED") throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ALREADY_FINALIZED");
    if (current.runId !== input.runId || current.sourceFingerprint !== input.sourceFingerprint) throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT");
    try {
      const envelope = FinalizableEvidenceEnvelopeSchema.parse(JSON.parse(input.evidenceSerialized));
      if (envelope.windowId !== input.windowId || envelope.runId !== input.runId || envelope.sourceFingerprint !== input.sourceFingerprint || envelope.evidenceDigest !== input.evidenceDigest || envelope.evidenceDigest !== digestValue(envelope.evidenceBody)) throw new Error("binding");
    } catch {
      throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ARTIFACT_CORRUPT");
    }

    await input.faults?.hit("before-temp-write");
    const temporaryPath = path.join(this.windowDirectory(input.windowId), `.evidence-${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx");
    try {
      const split = Math.max(1, Math.floor(input.evidenceSerialized.length / 2));
      await handle.write(input.evidenceSerialized.slice(0, split), undefined, "utf8");
      await input.faults?.hit("during-temp-write");
      await handle.write(input.evidenceSerialized.slice(split), undefined, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await input.faults?.hit("after-temp-write-before-publication");
    try {
      // Hard-link publication is atomic and refuses to replace an existing
      // final artifact, which is the no-overwrite equivalent of a rename.
      await input.faults?.hit("during-atomic-publication");
      await link(temporaryPath, this.evidencePath(input.windowId));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new AcceptanceWindowError("ACCEPTANCE_WINDOW_ALREADY_FINALIZED");
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    await input.faults?.hit("after-atomic-publication");
    return this.read(input.windowId);
  }

  async listTemporaryArtifacts(windowId: string) {
    try {
      return (await readdir(this.windowDirectory(windowId))).filter((entry) => entry.startsWith(".evidence-") && entry.endsWith(".tmp")).sort();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }
}
