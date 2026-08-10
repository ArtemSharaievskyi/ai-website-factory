import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createConfiguredPool, safeDatabaseCode } from "./db-common.mjs";

const directory = path.resolve("supabase/migrations");
const files = (await readdir(directory)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
let pool;
let client;
try {
  pool = createConfiguredPool();
  client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('ai-website-factory:migrations'))");
  await client.query("CREATE TABLE IF NOT EXISTS factory_schema_migrations (filename text primary key, checksum char(64) not null, applied_at timestamptz not null default now())");
  for (const filename of files) {
    const sql = await readFile(path.join(directory, filename), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    const existing = (await client.query("SELECT checksum FROM factory_schema_migrations WHERE filename=$1", [filename])).rows[0];
    if (existing && existing.checksum !== checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${filename}`);
    if (existing) { console.log(`${filename}: already applied`); continue; }
    await client.query("BEGIN");
    try { await client.query(sql); await client.query("INSERT INTO factory_schema_migrations (filename, checksum) VALUES ($1,$2)", [filename, checksum]); await client.query("COMMIT"); console.log(`${filename}: applied`); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} catch (error) { console.error(error?.message?.startsWith("MIGRATION_CHECKSUM_MISMATCH") ? "MIGRATION_CHECKSUM_MISMATCH" : safeDatabaseCode(error)); process.exitCode = 1; }
finally { if (client) { await client.query("SELECT pg_advisory_unlock(hashtext('ai-website-factory:migrations'))").catch(() => undefined); client.release(); } if (pool) await pool.end(); }
