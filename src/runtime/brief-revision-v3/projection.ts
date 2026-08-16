import type { PersistenceDatabase } from "@/persistence/database/types";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { BriefV3ProjectionPort } from "./ports";

export class BriefV3ProjectionService {
  constructor(private readonly database: PersistenceDatabase, private readonly projection: BriefV3ProjectionPort) {}

  async processPending(limit = 20) {
    const jobs = await this.database.transaction((tx) => tx.listBriefRevisionProjectionSync(limit));
    const results: Array<{ id: string; status: "SYNCED" | "FAILED_RETRYABLE" | "SUPERSEDED" }> = [];
    for (const job of jobs) {
      const current = await this.database.transaction((tx) => tx.getDocument(job.projectId, job.projectVersion, "brief-v3"));
      if (!current || current.checksum !== job.documentChecksum) {
        await this.database.transaction((tx) => tx.updateBriefRevisionProjectionSync({ id: job.id, expectedStatus: job.status, status: "SUPERSEDED", failureCode: null, nextAttemptAt: null, updatedAt: new Date().toISOString() }));
        results.push({ id: job.id, status: "SUPERSEDED" });
        continue;
      }
      try {
        await this.projection.writeVersionSnapshot(job.projectId, job.projectVersion, { "brief-v3.json": mapRowToDocument(current) });
        const after = await this.database.transaction((tx) => tx.getDocument(job.projectId, job.projectVersion, "brief-v3"));
        const status = after?.checksum === job.documentChecksum ? "SYNCED" as const : "SUPERSEDED" as const;
        await this.database.transaction((tx) => tx.updateBriefRevisionProjectionSync({ id: job.id, expectedStatus: job.status, status, failureCode: null, nextAttemptAt: null, updatedAt: new Date().toISOString() }));
        results.push({ id: job.id, status });
      } catch {
        const nextAttemptAt = new Date(Date.now() + 1000).toISOString();
        await this.database.transaction((tx) => tx.updateBriefRevisionProjectionSync({ id: job.id, expectedStatus: job.status, status: "FAILED_RETRYABLE", attemptCount: job.attemptCount + 1, failureCode: "PROJECT_MEMORY_SYNC_FAILED", nextAttemptAt, updatedAt: new Date().toISOString() }));
        results.push({ id: job.id, status: "FAILED_RETRYABLE" });
      }
    }
    return results;
  }
}
