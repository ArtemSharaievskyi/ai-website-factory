import { describe, expect, it } from "vitest";
import { assertCleanupInventoryComplete, SYNTHETIC_CLEANUP_ARTIFACTS, SYNTHETIC_CLEANUP_DELETE_STATEMENTS, executeSyntheticCleanupTransaction, verifySyntheticCleanup, type CleanupQuerySession } from "./cleanup-policy";

function recordingSession(calls: string[]): CleanupQuerySession {
  return { query: async <T extends Record<string, unknown>>(sql: string) => { calls.push(sql); if (sql.startsWith("SELECT id FROM brief_revision_projection_sync")) return { rows: [] as T[] }; if (sql.startsWith("SELECT")) return { rows: [{ count: 0 }] as unknown as T[] }; return { rows: [] as unknown as T[] }; } };
}

describe("Brief Revision V3 synthetic cleanup policy", () => {
  it("executes the complete dependency-ordered deletion policy and verifies independently", async () => {
    const deletionCalls: string[] = [];
    const verificationCalls: string[] = [];
    const deletion = await executeSyntheticCleanupTransaction(recordingSession(deletionCalls), "33333333-3333-4333-8333-333333333333");
    const verification = await verifySyntheticCleanup(recordingSession(verificationCalls), "33333333-3333-4333-8333-333333333333");
    expect(deletion).toEqual({ attempted: true, succeeded: true });
    expect(deletionCalls).toContain("BEGIN");
    expect(deletionCalls).toContain("COMMIT");
    expect(deletionCalls.filter((call) => call.startsWith("DELETE FROM"))).toHaveLength(SYNTHETIC_CLEANUP_DELETE_STATEMENTS.length);
    expect(verification.complete).toBe(true);
    expect(verificationCalls).not.toEqual(deletionCalls);
    expect(Object.keys(verification.remainingByArtifact).sort()).toEqual([...SYNTHETIC_CLEANUP_ARTIFACTS].sort());
    expect(Object.values(verification.remainingByArtifact).every((count) => count === 0)).toBe(true);
  });

  it("fails closed when independent verification observes a remaining artifact", async () => {
    const session: CleanupQuerySession = { query: async <T extends Record<string, unknown>>(sql: string) => sql.startsWith("SELECT") ? { rows: [{ count: 1 }] as unknown as T[] } : { rows: [] as unknown as T[] } };
    const result = await verifySyntheticCleanup(session, "33333333-3333-4333-8333-333333333333");
    expect(result.complete).toBe(false);
    expect(Object.values(result.remainingByArtifact).some((count) => count > 0)).toBe(true);
  });

  it("blocks cleanup while a projection lease is active and rolls back", async () => {
    const calls: string[] = [];
    const session: CleanupQuerySession = { query: async <T extends Record<string, unknown>>(sql: string) => { calls.push(sql); if (sql.startsWith("SELECT id FROM brief_revision_projection_sync")) return { rows: [{ id: "projection-1" }] as unknown as T[] }; return { rows: [] as unknown as T[] }; } };
    await expect(executeSyntheticCleanupTransaction(session, "33333333-3333-4333-8333-333333333333")).resolves.toEqual({ attempted: true, succeeded: false, blockedByActiveClaim: true });
    expect(calls).toEqual(["BEGIN", "SELECT id FROM factory_projects WHERE id = $1 FOR UPDATE", "SELECT id FROM brief_revision_projection_sync WHERE project_id = $1 AND lease_owner IS NOT NULL AND lease_expires_at > now() LIMIT 1", "ROLLBACK"]);
  });

  it("fails closed when the authoritative inventory omits a known owned artifact", () => {
    expect(() => assertCleanupInventoryComplete(SYNTHETIC_CLEANUP_ARTIFACTS.filter((artifact) => artifact !== "idempotency_records"))).toThrow("SYNTHETIC_CLEANUP_INVENTORY_INCOMPLETE:idempotency_records");
  });

  it("owns the generic idempotency table with a project-scoped key pattern", () => {
    expect(SYNTHETIC_CLEANUP_ARTIFACTS).toContain("idempotency_records");
    expect(SYNTHETIC_CLEANUP_DELETE_STATEMENTS.at(-1)).toMatch(/idempotency_records/);
  });
});
