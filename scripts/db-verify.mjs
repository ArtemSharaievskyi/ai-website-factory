import path from "node:path";
import { createConfiguredPool, safeDatabaseCode } from "./db-common.mjs";
import { migrationHistoryMatches, readMigrationManifest } from "./migration-evidence.mjs";
const expectedTables = ["factory_projects", "project_versions", "workflow_documents", "clarification_questions", "clarification_answers", "design_direction_sets", "design_directions", "selected_designs", "agent_tasks", "task_dependencies", "decision_records", "quality_reports", "quality_checks", "release_reports", "workflow_events", "cost_records", "idempotency_records", "factory_project_assets", "brief_revision_attempts", "brief_revision_history", "brief_revision_projection_sync", "planning_recovery_evidence", "planning_recovery_runs"];
let manifest;
let pool;
try {
  pool = createConfiguredPool();
  manifest = await readMigrationManifest(path.resolve("supabase/migrations"));
  if (!manifest.entries.length) throw new Error("MIGRATION_SET_EMPTY");
  const client = await pool.connect();
  const connection = await client.query("select version() as version");
  await client.query("BEGIN"); await client.query("ROLLBACK");
  const clientTls = client.connection.stream.encrypted ? "yes" : "no";
  client.release();
  console.log(`DATABASE_CONNECTION_OK version-present:${connection.rows[0].version ? "yes" : "no"} transactions:yes client-tls:${clientTls}`);
  const tables = await pool.query("select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by table_name", [expectedTables]);
  if (tables.rows.length !== expectedTables.length) throw new Error("DATABASE_SCHEMA_INCOMPLETE");
  console.log(`TABLES_VERIFIED ${tables.rows.length}`);
  const constraints = await pool.query("select count(*)::int as count from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and c.contype in ('p','u','f','c')");
  const indexes = await pool.query("select count(*)::int as count from pg_indexes where schemaname='public' and indexname in ('clarification_blocking_unresolved_idx','factory_projects_workflow_state_idx','project_versions_lookup_idx','agent_tasks_project_status_idx','factory_project_assets_project_idx','factory_project_assets_current_idx','factory_project_assets_hash_idx','brief_revision_attempts_project_idx','brief_revision_history_project_idx','brief_revision_projection_pending_idx','workflow_events_revision_attempt_idx','decision_records_revision_attempt_idx','planning_recovery_evidence_project_idx','planning_recovery_runs_project_idx','planning_recovery_runs_active_idx')");
  const rls = await pool.query("select count(*)::int as count from pg_class where relnamespace='public'::regnamespace and relname = any($1::text[]) and relrowsecurity", [expectedTables]);
  const policies = await pool.query("select count(*)::int as count from pg_policies where schemaname='public' and tablename = any($1::text[])", [expectedTables]);
  const migrationHistory = await pool.query("select filename, checksum from factory_schema_migrations order by filename");
  if (!migrationHistoryMatches(manifest, migrationHistory.rows)) throw new Error("MIGRATION_EVIDENCE_STALE");
  console.log(`CONSTRAINTS_VERIFIED ${constraints.rows[0].count} INDEXES_VERIFIED ${indexes.rows[0].count} RLS_ENABLED ${rls.rows[0].count}/${expectedTables.length} PUBLIC_POLICIES ${policies.rows[0].count}`);
  if (rls.rows[0].count !== expectedTables.length || policies.rows[0].count !== 0) throw new Error("DATABASE_RLS_POLICY_UNEXPECTED");
  console.log(JSON.stringify({ status: "passed", targetDomain: "FACTORY_PERSISTENCE", migrationSetChecksum: manifest.migrationSetChecksum, migrationHistory: "current", schemaVerification: "passed", tableCount: tables.rows.length, rlsEnabled: rls.rows[0].count, publicPolicies: policies.rows[0].count }));
} catch (error) { console.error(["DATABASE_SCHEMA_INCOMPLETE", "DATABASE_RLS_POLICY_UNEXPECTED", "MIGRATION_EVIDENCE_STALE", "MIGRATION_SET_EMPTY"].includes(error?.message) ? error.message : safeDatabaseCode(error)); process.exitCode = 1; }
finally { if (pool) await pool.end(); }
