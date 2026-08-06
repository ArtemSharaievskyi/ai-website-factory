import { createConfiguredPool, safeDatabaseCode } from "./db-common.mjs";
const expectedTables = ["factory_projects", "project_versions", "workflow_documents", "clarification_questions", "clarification_answers", "design_direction_sets", "design_directions", "selected_designs", "agent_tasks", "task_dependencies", "decision_records", "quality_reports", "quality_checks", "release_reports", "workflow_events", "cost_records", "idempotency_records"];
const pool = createConfiguredPool();
try {
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
  const indexes = await pool.query("select count(*)::int as count from pg_indexes where schemaname='public' and indexname in ('clarification_blocking_unresolved_idx','factory_projects_workflow_state_idx','project_versions_lookup_idx','agent_tasks_project_status_idx')");
  const rls = await pool.query("select count(*)::int as count from pg_class where relnamespace='public'::regnamespace and relname = any($1::text[]) and relrowsecurity", [expectedTables]);
  const policies = await pool.query("select count(*)::int as count from pg_policies where schemaname='public' and tablename = any($1::text[])", [expectedTables]);
  console.log(`CONSTRAINTS_VERIFIED ${constraints.rows[0].count} INDEXES_VERIFIED ${indexes.rows[0].count} RLS_ENABLED ${rls.rows[0].count}/${expectedTables.length} PUBLIC_POLICIES ${policies.rows[0].count}`);
  if (rls.rows[0].count !== expectedTables.length || policies.rows[0].count !== 0) throw new Error("DATABASE_RLS_POLICY_UNEXPECTED");
} catch (error) { console.error(error?.message === "DATABASE_SCHEMA_INCOMPLETE" || error?.message === "DATABASE_RLS_POLICY_UNEXPECTED" ? error.message : safeDatabaseCode(error)); process.exitCode = 1; }
finally { await pool.end(); }
