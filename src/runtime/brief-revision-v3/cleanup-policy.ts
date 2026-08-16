export const AUTHORITATIVE_SYNTHETIC_OWNED_ARTIFACTS = ["factory_projects", "project_versions", "workflow_documents", "clarification_questions", "clarification_answers", "design_direction_sets", "design_directions", "selected_designs", "agent_tasks", "task_dependencies", "decision_records", "quality_reports", "quality_checks", "release_reports", "workflow_events", "cost_records", "factory_project_assets", "brief_revision_attempts", "brief_revision_history", "brief_revision_projection_sync", "idempotency_records", "project_memory_projection"] as const;
export const SYNTHETIC_CLEANUP_ARTIFACTS = Object.freeze([...AUTHORITATIVE_SYNTHETIC_OWNED_ARTIFACTS]);

export function assertCleanupInventoryComplete(inventory: readonly string[] = SYNTHETIC_CLEANUP_ARTIFACTS) {
  const missing = AUTHORITATIVE_SYNTHETIC_OWNED_ARTIFACTS.filter((artifact) => !inventory.includes(artifact));
  if (missing.length) throw new Error(`SYNTHETIC_CLEANUP_INVENTORY_INCOMPLETE:${missing.join(",")}`);
  return true;
}

export function syntheticIdempotencyOwnershipPattern(projectId: string) { return `%${projectId}%`; }

export const SYNTHETIC_CLEANUP_DELETE_STATEMENTS = [
  "DELETE FROM clarification_answers WHERE question_id IN (SELECT id FROM clarification_questions WHERE project_id = $1)",
  "DELETE FROM design_directions WHERE direction_set_id IN (SELECT id FROM design_direction_sets WHERE project_id = $1)",
  "DELETE FROM selected_designs WHERE project_id = $1",
  "DELETE FROM task_dependencies WHERE task_id IN (SELECT id FROM agent_tasks WHERE project_id = $1) OR dependency_id IN (SELECT id FROM agent_tasks WHERE project_id = $1)",
  "DELETE FROM quality_checks WHERE quality_report_id IN (SELECT id FROM quality_reports WHERE project_id = $1)",
  "DELETE FROM factory_project_assets WHERE project_id = $1",
  "DELETE FROM clarification_questions WHERE project_id = $1",
  "DELETE FROM design_direction_sets WHERE project_id = $1",
  "DELETE FROM decision_records WHERE project_id = $1",
  "DELETE FROM workflow_events WHERE project_id = $1",
  "DELETE FROM cost_records WHERE project_id = $1",
  "DELETE FROM release_reports WHERE project_id = $1",
  "DELETE FROM quality_reports WHERE project_id = $1",
  "DELETE FROM agent_tasks WHERE project_id = $1",
  "DELETE FROM brief_revision_projection_sync WHERE project_id = $1",
  "DELETE FROM brief_revision_history WHERE project_id = $1",
  "DELETE FROM brief_revision_attempts WHERE project_id = $1",
  "DELETE FROM workflow_documents WHERE project_id = $1",
  "DELETE FROM project_versions WHERE project_id = $1",
  "DELETE FROM factory_projects WHERE id = $1",
  "DELETE FROM idempotency_records WHERE idempotency_key LIKE $1",
] as const;

export const SYNTHETIC_CLEANUP_VERIFICATION_QUERIES: Record<string, string> = {
  factory_projects: "SELECT count(*)::int AS count FROM factory_projects WHERE id = $1",
  project_versions: "SELECT count(*)::int AS count FROM project_versions WHERE project_id = $1",
  workflow_documents: "SELECT count(*)::int AS count FROM workflow_documents WHERE project_id = $1",
  clarification_questions: "SELECT count(*)::int AS count FROM clarification_questions WHERE project_id = $1",
  clarification_answers: "SELECT count(*)::int AS count FROM clarification_answers WHERE question_id IN (SELECT id FROM clarification_questions WHERE project_id = $1)",
  design_direction_sets: "SELECT count(*)::int AS count FROM design_direction_sets WHERE project_id = $1",
  design_directions: "SELECT count(*)::int AS count FROM design_directions WHERE direction_set_id IN (SELECT id FROM design_direction_sets WHERE project_id = $1)",
  selected_designs: "SELECT count(*)::int AS count FROM selected_designs WHERE project_id = $1",
  agent_tasks: "SELECT count(*)::int AS count FROM agent_tasks WHERE project_id = $1",
  task_dependencies: "SELECT count(*)::int AS count FROM task_dependencies WHERE task_id IN (SELECT id FROM agent_tasks WHERE project_id = $1) OR dependency_id IN (SELECT id FROM agent_tasks WHERE project_id = $1)",
  decision_records: "SELECT count(*)::int AS count FROM decision_records WHERE project_id = $1",
  quality_reports: "SELECT count(*)::int AS count FROM quality_reports WHERE project_id = $1",
  quality_checks: "SELECT count(*)::int AS count FROM quality_checks WHERE quality_report_id IN (SELECT id FROM quality_reports WHERE project_id = $1)",
  release_reports: "SELECT count(*)::int AS count FROM release_reports WHERE project_id = $1",
  workflow_events: "SELECT count(*)::int AS count FROM workflow_events WHERE project_id = $1",
  cost_records: "SELECT count(*)::int AS count FROM cost_records WHERE project_id = $1",
  factory_project_assets: "SELECT count(*)::int AS count FROM factory_project_assets WHERE project_id = $1",
  brief_revision_attempts: "SELECT count(*)::int AS count FROM brief_revision_attempts WHERE project_id = $1",
  brief_revision_history: "SELECT count(*)::int AS count FROM brief_revision_history WHERE project_id = $1",
  brief_revision_projection_sync: "SELECT count(*)::int AS count FROM brief_revision_projection_sync WHERE project_id = $1",
  idempotency_records: "SELECT count(*)::int AS count FROM idempotency_records WHERE idempotency_key LIKE $1",
};

type CleanupQueryResult = { rows: Array<{ count?: number | string }> };
export type CleanupQuerySession = { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<CleanupQueryResult & { rows: T[] }> };

export async function executeSyntheticCleanupTransaction(client: CleanupQuerySession, projectId: string) {
  let attempted = false;
  try {
    attempted = true;
    await client.query("BEGIN");
    for (const statement of SYNTHETIC_CLEANUP_DELETE_STATEMENTS) await client.query(statement, statement.includes("idempotency_records") ? [syntheticIdempotencyOwnershipPattern(projectId)] : [projectId]);
    await client.query("COMMIT");
    return { attempted, succeeded: true };
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return { attempted, succeeded: false };
  }
}

export async function verifySyntheticCleanup(client: CleanupQuerySession, projectId: string) {
  assertCleanupInventoryComplete();
  const remainingByArtifact: Record<string, number> = Object.fromEntries(SYNTHETIC_CLEANUP_ARTIFACTS.map((artifact) => [artifact, artifact === "project_memory_projection" ? 0 : 1]));
  let complete = true;
  for (const artifact of SYNTHETIC_CLEANUP_ARTIFACTS) {
    if (artifact === "project_memory_projection") continue;
    try {
      const query = SYNTHETIC_CLEANUP_VERIFICATION_QUERIES[artifact];
      if (!query) throw new Error(`SYNTHETIC_CLEANUP_QUERY_MISSING:${artifact}`);
      const result = await client.query<{ count: number | string }>(query, artifact === "idempotency_records" ? [syntheticIdempotencyOwnershipPattern(projectId)] : [projectId]);
      remainingByArtifact[artifact] = Number(result.rows[0]?.count ?? 1);
      if (remainingByArtifact[artifact] !== 0) complete = false;
    } catch {
      complete = false;
    }
  }
  return { complete, remainingByArtifact };
}
