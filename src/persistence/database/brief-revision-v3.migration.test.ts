import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { createPostgresPool } from "./postgres";

const migrationPath = new URL("../../../supabase/migrations/202608160001_brief_revision_v3_transaction.sql", import.meta.url);
const claimMigrationPath = new URL("../../../supabase/migrations/202609040001_brief_revision_projection_claim.sql", import.meta.url);
const claimGuardMigrationPath = new URL("../../../supabase/migrations/202609040002_brief_revision_projection_claim_guard.sql", import.meta.url);
const claimGenerationMigrationPath = new URL("../../../supabase/migrations/202609040003_brief_revision_projection_claim_generation.sql", import.meta.url);
const configuredDatabaseUrl = () => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*DATABASE_URL\s*=/.test(candidate));
    const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
};
const databaseUrl = configuredDatabaseUrl();

async function withMigrationSandbox(sql: string, work: (client: PoolClient) => Promise<void>) {
  if (!databaseUrl) return false;
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_temp, public");
    await client.query("CREATE TEMP TABLE factory_projects (id uuid primary key)");
    await client.query("CREATE TEMP TABLE workflow_events (id uuid primary key, project_id uuid not null)");
    await client.query("CREATE TEMP TABLE decision_records (id uuid primary key, project_id uuid not null)");
    await work(client);
    return true;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function withRollbackSandbox(sql: string) {
  if (!databaseUrl) return false;
  const pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_temp, public");
    await client.query("CREATE TEMP TABLE factory_projects (id uuid primary key)");
    await client.query("CREATE TEMP TABLE workflow_events (id uuid primary key, project_id uuid not null)");
    await client.query("CREATE TEMP TABLE decision_records (id uuid primary key, project_id uuid not null)");
    await client.query(sql);
    await client.query("ROLLBACK");
    const result = await client.query("SELECT to_regclass('pg_temp.brief_revision_attempts') AS name");
    expect(result.rows[0]?.name).toBeNull();
    return true;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

describe("Brief Revision V3 transaction migration", () => {
  it("is additive and idempotent for fresh and existing schemas", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/create table if not exists brief_revision_attempts/i);
    expect(sql).toMatch(/create table if not exists brief_revision_history/i);
    expect(sql).toMatch(/create table if not exists brief_revision_projection_sync/i);
    expect(sql).toMatch(/alter table workflow_events add column if not exists revision_attempt_id/i);
    expect(sql).toMatch(/alter table decision_records add column if not exists revision_attempt_id/i);
    expect(sql).toMatch(/unique\(operation_kind, operation_key\)/i);
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(await withMigrationSandbox(sql, async (client) => {
      await client.query(sql);
      const result = await client.query("SELECT count(*)::int AS count FROM pg_class WHERE relname IN ('brief_revision_attempts','brief_revision_history','brief_revision_projection_sync') AND relnamespace = pg_my_temp_schema()");
      expect(result.rows[0]?.count).toBe(3);
    })).toBe(databaseUrl ? true : false);
  });

  it("declares the database invariants required by the transaction boundary", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(/unique\(operation_kind, operation_key\)/i);
    expect(sql).toMatch(/foreign key \(revision_attempt_id\) references brief_revision_attempts\(id\)/i);
    expect(sql).toMatch(/attempt_id uuid not null unique references brief_revision_attempts\(id\)/i);
    expect(sql).toMatch(/status in \('RESERVED','PROVIDER_PENDING','COMMITTED','FAILED_RETRYABLE','REJECTED_INVALID','REJECTED_STALE'\)/i);
    expect(sql).toMatch(/status = 'PROVIDER_PENDING' and lease_owner is not null and lease_expires_at is not null/i);
    expect(sql).toMatch(/status <> 'PROVIDER_PENDING' and lease_owner is null and lease_expires_at is null/i);
    expect(sql).toMatch(/status = 'COMMITTED' and committed_result is not null/i);
    expect(sql).toMatch(/status <> 'COMMITTED' and committed_result is null/i);
    expect(sql).toMatch(/create unique index if not exists workflow_events_revision_attempt_idx/i);
    expect(sql).toMatch(/create unique index if not exists decision_records_revision_attempt_idx/i);
    expect(sql).toMatch(/alter table brief_revision_attempts enable row level security/i);
    expect(sql).toMatch(/alter table brief_revision_history enable row level security/i);
    expect(sql).toMatch(/alter table brief_revision_projection_sync enable row level security/i);
    expect(await withMigrationSandbox(sql, async (client) => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      const attemptId = "22222222-2222-4222-8222-222222222222";
      await client.query(sql);
      await client.query("INSERT INTO pg_temp.factory_projects (id) VALUES ($1)", [projectId]);
      await client.query("INSERT INTO pg_temp.brief_revision_attempts (id, operation_kind, operation_key, payload_hash, project_id, project_version, currentness_token, status, created_at, updated_at) VALUES ($1,'REQUEST_BRIEF_CHANGES_V3','migration-test-operation',$2,$3,1,'{}','RESERVED',now(),now())", [attemptId, "a".repeat(64), projectId]);
      const rls = await client.query("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('brief_revision_attempts','brief_revision_history','brief_revision_projection_sync') AND relnamespace = pg_my_temp_schema() ORDER BY relname");
      expect(rls.rows).toEqual([
        { relname: "brief_revision_attempts", relrowsecurity: true },
        { relname: "brief_revision_history", relrowsecurity: true },
        { relname: "brief_revision_projection_sync", relrowsecurity: true },
      ]);
      const rejects = async (statement: string, values: unknown[]) => {
        await client.query("SAVEPOINT v3_invalid");
        let failed = false;
        try { await client.query(statement, values); } catch { failed = true; }
        await client.query("ROLLBACK TO SAVEPOINT v3_invalid");
        expect(failed).toBe(true);
      };
      await rejects("INSERT INTO pg_temp.brief_revision_attempts (id, operation_kind, operation_key, payload_hash, project_id, project_version, currentness_token, status, created_at, updated_at) VALUES ($1,'REQUEST_BRIEF_CHANGES_V3','migration-test-operation',$2,$3,1,'{}','RESERVED',now(),now())", ["33333333-3333-4333-8333-333333333333", "b".repeat(64), projectId]);
      await rejects("INSERT INTO pg_temp.brief_revision_attempts (id, operation_kind, operation_key, payload_hash, project_id, project_version, currentness_token, status, created_at, updated_at) VALUES ($1,'REQUEST_BRIEF_CHANGES_V3','missing-lease',$2,$3,1,'{}','PROVIDER_PENDING',now(),now())", ["44444444-4444-4444-8444-444444444444", "c".repeat(64), projectId]);
      await rejects("INSERT INTO pg_temp.brief_revision_history (id, attempt_id, project_id, project_version, revision_reference, previous_current_checksum, next_current_checksum, change_set_checksum, entries, created_at) VALUES ($1,$2,$3,1,'missing-attempt',$4,$4,$4,'[]',now())", ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666", projectId, "d".repeat(64)]);
    })).toBe(databaseUrl ? true : false);
  });

  it("leaves legacy V1/V2 documents and migration rollback semantics untouched", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/update\s+workflow_documents/i);
    expect(sql).not.toMatch(/delete\s+from\s+workflow_documents/i);
    expect(sql).not.toMatch(/drop\s+(table|column)/i);
    expect(sql).toMatch(/references factory_projects\(id\)/i);
    expect(await withRollbackSandbox(sql)).toBe(databaseUrl ? true : false);
  });

  it("adds an idempotent generation-bound projection claim schema", async () => {
    const baseSql = await readFile(migrationPath, "utf8");
    const claimSql = await readFile(claimMigrationPath, "utf8");
    const claimGuardSql = await readFile(claimGuardMigrationPath, "utf8");
    const claimGenerationSql = await readFile(claimGenerationMigrationPath, "utf8");
    expect(claimSql).toMatch(/add column if not exists claim_generation integer not null default 0/i);
    expect(claimSql).toMatch(/add column if not exists lease_owner text/i);
    expect(claimSql).toMatch(/add column if not exists lease_expires_at timestamptz/i);
    expect(claimSql).toMatch(/brief_revision_projection_claim_state_check/i);
    expect(claimSql).toMatch(/brief_revision_projection_claim_idx/i);
    expect(claimSql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(claimGuardSql).toMatch(/conrelid = 'brief_revision_projection_sync'::regclass/i);
    expect(claimGuardSql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(claimGenerationSql).toMatch(/claim_generation >= 0/i);
    expect(claimGenerationSql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(await withMigrationSandbox(baseSql, async (client) => {
      await client.query(baseSql);
      await client.query(claimSql);
      await client.query(claimGuardSql);
      await client.query(claimGenerationSql);
      await client.query(claimSql);
      await client.query(claimGuardSql);
      await client.query(claimGenerationSql);
      const columns = await client.query("SELECT attname FROM pg_attribute WHERE attrelid='pg_temp.brief_revision_projection_sync'::regclass AND attname = ANY($1::text[]) AND NOT attisdropped ORDER BY attname", [["claim_generation", "lease_owner", "lease_expires_at"]]);
      expect(columns.rows).toEqual([{ attname: "claim_generation" }, { attname: "lease_expires_at" }, { attname: "lease_owner" }]);
      const constraint = await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='pg_temp.brief_revision_projection_sync'::regclass AND conname='brief_revision_projection_claim_state_check'");
      expect(constraint.rows[0]?.count).toBe(1);
      const generationConstraint = await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='pg_temp.brief_revision_projection_sync'::regclass AND conname='brief_revision_projection_claim_generation_check'");
      expect(generationConstraint.rows[0]?.count).toBe(1);
      const index = await client.query("SELECT to_regclass('pg_temp.brief_revision_projection_claim_idx') AS name");
      expect(index.rows[0]?.name).toBe("brief_revision_projection_claim_idx");
    })).toBe(databaseUrl ? true : false);
  });
});

if (!databaseUrl) console.log("BRIEF REVISION V3 MIGRATION INTEGRITY: STATIC ONLY (DATABASE_URL unavailable)");
else console.log("BRIEF REVISION V3 MIGRATION INTEGRITY: REAL TEMP-SCHEMA EXECUTION ENABLED");
