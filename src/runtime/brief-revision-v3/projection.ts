import { randomUUID } from "node:crypto";
import type { BriefRevisionProjectionStatus, PersistenceDatabase } from "@/persistence/database/types";
import { PersistenceError } from "@/persistence/database/errors";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { BriefV3ProjectionPort } from "./ports";

export class BriefV3ProjectionService {
  private readonly workerId: string;
  private readonly leaseDurationMs: number;

  constructor(private readonly database: PersistenceDatabase, private readonly projection: BriefV3ProjectionPort, options: { workerId?: string; leaseDurationMs?: number } = {}) {
    this.workerId = options.workerId ?? randomUUID();
    this.leaseDurationMs = options.leaseDurationMs ?? 300_000;
  }

  private async settle(input: { id: string; attemptId: string; expectedStatus: BriefRevisionProjectionStatus; status: "SYNCED" | "FAILED_RETRYABLE" | "SUPERSEDED"; attemptCount?: number; failureCode?: string | null; nextAttemptAt?: string | null; owner: string; claimGeneration: number; updatedAt: string }) {
    try {
      return await this.database.transaction((tx) => tx.updateBriefRevisionProjectionSync(input));
    } catch (error) {
      if (!(error instanceof PersistenceError) || error.code !== "PERSISTENCE_CONFLICT") throw error;
      const current = await this.database.transaction((tx) => tx.getBriefRevisionProjectionSync(input.attemptId));
      if (!current || current.status === input.expectedStatus) throw error;
      return current;
    }
  }

  async processPending(limit = 20) {
    const jobs = await this.database.transaction((tx) => tx.listBriefRevisionProjectionSync(limit));
    const results: Array<{ id: string; status: "SYNCED" | "FAILED_RETRYABLE" | "SUPERSEDED" }> = [];
    for (const discoveredJob of jobs) {
      const claimed = await this.database.transaction((tx) => tx.claimBriefRevisionProjectionSync({ id: discoveredJob.id, projectId: discoveredJob.projectId, owner: this.workerId, now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + this.leaseDurationMs).toISOString() }));
      if (claimed.outcome !== "CLAIMED") continue;
      const job = claimed.row;
      const current = await this.database.transaction((tx) => tx.getDocument(job.projectId, job.projectVersion, "brief-v3"));
      if (!current || current.checksum !== job.documentChecksum) {
        const settled = await this.settle({ id: job.id, attemptId: job.attemptId, expectedStatus: job.status, status: "SUPERSEDED", failureCode: null, nextAttemptAt: null, owner: this.workerId, claimGeneration: job.claimGeneration, updatedAt: new Date().toISOString() });
        results.push({ id: job.id, status: settled.status === "PENDING" ? "SUPERSEDED" : settled.status });
        continue;
      }
      try {
        await this.projection.writeVersionSnapshot(job.projectId, job.projectVersion, { "brief-v3.json": mapRowToDocument(current) });
        const after = await this.database.transaction((tx) => tx.getDocument(job.projectId, job.projectVersion, "brief-v3"));
        const status = after?.checksum === job.documentChecksum ? "SYNCED" as const : "SUPERSEDED" as const;
        const settled = await this.settle({ id: job.id, attemptId: job.attemptId, expectedStatus: job.status, status, failureCode: null, nextAttemptAt: null, owner: this.workerId, claimGeneration: job.claimGeneration, updatedAt: new Date().toISOString() });
        results.push({ id: job.id, status: settled.status === "PENDING" ? status : settled.status });
      } catch {
        const nextAttemptAt = new Date(Date.now() + 1000).toISOString();
        const settled = await this.settle({ id: job.id, attemptId: job.attemptId, expectedStatus: job.status, status: "FAILED_RETRYABLE", attemptCount: job.attemptCount + 1, failureCode: "PROJECT_MEMORY_SYNC_FAILED", nextAttemptAt, owner: this.workerId, claimGeneration: job.claimGeneration, updatedAt: new Date().toISOString() });
        results.push({ id: job.id, status: settled.status === "PENDING" ? "FAILED_RETRYABLE" : settled.status });
      }
    }
    return results;
  }
}
