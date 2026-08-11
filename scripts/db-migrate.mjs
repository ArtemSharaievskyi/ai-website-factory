import path from "node:path";
import { readFile } from "node:fs/promises";
import { createConfiguredPool, safeDatabaseCode } from "./db-common.mjs";
import { readMigrationManifest } from "./migration-evidence.mjs";

const directory = path.resolve("supabase/migrations");
let manifest;
let files;
const executionEvidence = [];
let pool;
let client;
try {
  pool = createConfiguredPool();
  manifest = await readMigrationManifest(directory);
  if (!manifest.entries.length) throw new Error("MIGRATION_SET_EMPTY");
  files = manifest.entries.map((entry) => entry.filename);
  client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('ai-website-factory:migrations'))");
  await client.query("CREATE TABLE IF NOT EXISTS factory_schema_migrations (filename text primary key, checksum char(64) not null, applied_at timestamptz not null default now())");
  for (const filename of files) {
    const entry = manifest.entries.find((candidate) => candidate.filename === filename);
    const checksum = entry.checksum;
    const existing = (await client.query("SELECT checksum FROM factory_schema_migrations WHERE filename=$1", [filename])).rows[0];
    if (existing && existing.checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
    if (existing) { executionEvidence.push({ filename, checksum, executionStatus: "already-applied", transactionStatus: "not-run" }); console.log(`${filename}: already applied`); continue; }
    await client.query("BEGIN");
    try { const sql = await readFile(path.join(directory, filename), "utf8"); await client.query(sql); await client.query("INSERT INTO factory_schema_migrations (filename, checksum) VALUES ($1,$2)", [filename, checksum]); await client.query("COMMIT"); executionEvidence.push({ filename, checksum, executionStatus: "applied", transactionStatus: "committed" }); console.log(`${filename}: applied`); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  console.log(JSON.stringify({ status: "passed", targetDomain: "FACTORY_PERSISTENCE", migrationSetChecksum: manifest.migrationSetChecksum, migrations: executionEvidence, executionEvidence: "migration-history-and-transaction-result" }));
} catch (error) { console.error(error?.message?.startsWith("MIGRATION_CHECKSUM_MISMATCH") ? "MIGRATION_CHECKSUM_MISMATCH" : error?.message === "MIGRATION_SET_EMPTY" ? "MIGRATION_SET_EMPTY" : safeDatabaseCode(error)); process.exitCode = 1; }
finally { if (client) { await client.query("SELECT pg_advisory_unlock(hashtext('ai-website-factory:migrations'))").catch(() => undefined); client.release(); } if (pool) await pool.end(); }
