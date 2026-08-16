import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { DomainError } from "@/domain/shared/errors";
import { readServerEnvironment, requireDatabaseSsl } from "./env";
import { PersistenceError } from "./errors";
import { mapRowToDocument, type DocumentRow } from "./mapping";
import { canonicalBriefChecksumForDocument } from "./brief-revision-v3-contracts";
import type { BriefRevisionAtomicCommitInput, BriefRevisionAtomicCommitResult, BriefRevisionAttemptClaim, BriefRevisionAttemptRow, BriefRevisionAttemptStatus, BriefRevisionAttemptTransition, BriefRevisionProjectionRow, BriefRevisionProjectionStatus, OperationReservation, PersistenceDatabase, PersistenceTransaction, ProjectAssetRow, ProjectRow, ProjectVersionRow, WorkflowEvent, CostRecord } from "./types";
import type { DecisionRecord } from "@/domain/workflow/decision";

const safeProviderError = (error: unknown): never => { const providerCode = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "unknown"; throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The database operation failed.", { providerCode }, error); };
const value = <T>(result: { rows: QueryResultRow[] }) => result.rows[0] as T | undefined;
const isoTimestamp = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const normalizeProjectRow = (row: ProjectRow) => ({ ...row, row_version: Number(row.row_version) });
export const normalizeAssetRow = (row: ProjectAssetRow) => {
  const nullable = row as ProjectAssetRow & { supersedesAssetId?: string | null; rejectionReason?: string | null };
  const { supersedesAssetId, rejectionReason, ...required } = nullable;
  return {
    ...required,
    byteSize: Number(required.byteSize),
    projectVersion: Number(required.projectVersion),
    version: Number(required.version),
    createdAt: isoTimestamp(required.createdAt) as string,
    updatedAt: isoTimestamp(required.updatedAt) as string,
    ...(supersedesAssetId == null ? {} : { supersedesAssetId }),
    ...(rejectionReason == null ? {} : { rejectionReason }),
  };
};
const normalizeVersionRow = (row: ProjectVersionRow) => ({
  ...row,
  rowVersion: Number(row.rowVersion),
  createdAt: isoTimestamp(row.createdAt) as string,
  updatedAt: isoTimestamp(row.updatedAt) as string,
  releasedAt: isoTimestamp(row.releasedAt),
});
const normalizeDocumentRow = (row: DocumentRow): DocumentRow => ({
  ...row,
  projectVersion: Number(row.projectVersion),
  schemaVersion: Number(row.schemaVersion),
  rowVersion: Number(row.rowVersion),
  createdAt: isoTimestamp(row.createdAt) as string,
  updatedAt: isoTimestamp(row.updatedAt) as string,
});
const normalizeBriefRevisionAttempt = (row: Record<string, unknown>): BriefRevisionAttemptRow => ({
  id: String(row.id), operationKind: String(row.operationKind), operationKey: String(row.operationKey), payloadHash: String(row.payloadHash),
  projectId: String(row.projectId), projectVersion: Number(row.projectVersion), currentnessToken: row.currentnessToken as Record<string, unknown>,
  status: String(row.status) as BriefRevisionAttemptStatus, leaseOwner: row.leaseOwner == null ? null : String(row.leaseOwner), leaseExpiresAt: isoTimestamp(row.leaseExpiresAt),
  attemptGeneration: Number(row.attemptGeneration), claimedAt: isoTimestamp(row.claimedAt), committedResult: row.committedResult ?? null, failureCode: row.failureCode == null ? null : String(row.failureCode),
  createdAt: isoTimestamp(row.createdAt) as string, updatedAt: isoTimestamp(row.updatedAt) as string,
});
const normalizeBriefRevisionProjection = (row: Record<string, unknown>): BriefRevisionProjectionRow => ({
  id: String(row.id), attemptId: String(row.attemptId), projectId: String(row.projectId), projectVersion: Number(row.projectVersion), documentChecksum: String(row.documentChecksum),
  status: String(row.status) as BriefRevisionProjectionStatus, attemptCount: Number(row.attemptCount), lastFailureCode: row.lastFailureCode == null ? null : String(row.lastFailureCode),
  nextAttemptAt: isoTimestamp(row.nextAttemptAt), createdAt: isoTimestamp(row.createdAt) as string, updatedAt: isoTimestamp(row.updatedAt) as string,
});

export function createPostgresPool(input: Record<string, string | undefined> = process.env) {
  const environment = readServerEnvironment(input);
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required for the Postgres persistence adapter.");
  return new Pool({ connectionString: requireDatabaseSsl(environment.DATABASE_URL), ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
}

export class PostgresPersistenceDatabase implements PersistenceDatabase {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let commitStarted = false;
    let destroyError: Error | undefined;
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresTransaction(client));
      commitStarted = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (!commitStarted) await client.query("ROLLBACK").catch(() => undefined);
      if (commitStarted) {
        destroyError = error instanceof Error ? error : new Error("The database commit acknowledgement was lost.");
        const providerCode = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "unknown";
        throw new PersistenceError("PERSISTENCE_COMMIT_AMBIGUOUS", "The database commit outcome could not be confirmed.", { providerCode }, error);
      }
      if (error instanceof PersistenceError || error instanceof DomainError) throw error;
      return safeProviderError(error);
    }
    finally { client.release(destroyError); }
  }
}

class PostgresTransaction implements PersistenceTransaction {
  constructor(private readonly db: PoolClient) {}
  private async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) { try { return await this.db.query<T>(text, values); } catch (error) { return safeProviderError(error); } }
  private async idempotent(operation: string, token: { key: string; payloadHash: string } | undefined, result: unknown) {
    if (!token) return undefined;
    const existing = value<{ payload_hash: string; result: unknown }>(await this.query("SELECT payload_hash, result FROM idempotency_records WHERE operation = $1 AND idempotency_key = $2 FOR UPDATE", [operation, token.key]));
    if (existing && existing.payload_hash !== token.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different payload.");
    if (existing) return existing.result;
    await this.query("INSERT INTO idempotency_records (operation, idempotency_key, payload_hash, result) VALUES ($1, $2, $3, $4)", [operation, token.key, token.payloadHash, result]);
    return undefined;
  }

  async getProject(id: string) { const result = value<ProjectRow>(await this.query("SELECT * FROM factory_projects WHERE id = $1", [id])); return result ? normalizeProjectRow(result) : null; }
  async listProjects() { const result = await this.query<ProjectRow>("SELECT * FROM factory_projects ORDER BY updated_at DESC, id DESC LIMIT 40"); return result.rows.map((row) => normalizeProjectRow(row)); }
  async insertProject(row: ProjectRow, token?: { key: string; payloadHash: string }) { const existing = await this.idempotent("project:create", token, row); if (existing) return normalizeProjectRow(existing as ProjectRow); const result = value<ProjectRow>(await this.query("INSERT INTO factory_projects (id, slug, origin, site_language, title, original_prompt, original_prompt_checksum, current_version, workflow_state, created_at, updated_at, implementation_started_at, completed_at, row_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *", [row.id, row.slug, row.origin, row.site_language, row.title, row.original_prompt, row.original_prompt_checksum, row.current_version, row.workflow_state, row.created_at, row.updated_at, row.implementation_started_at, row.completed_at, row.row_version])); if (!result) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "Project insert returned no row."); return normalizeProjectRow(result); }
  async updateProjectState(input: { id: string; expectedState: ProjectRow["workflow_state"]; expectedRowVersion: number; state: ProjectRow["workflow_state"]; updatedAt: string; implementationStartedAt?: string; completedAt?: string }) { const result = value<ProjectRow>(await this.query("UPDATE factory_projects SET workflow_state=$1, updated_at=$2, implementation_started_at=COALESCE($3, implementation_started_at), completed_at=COALESCE($4, completed_at), row_version=row_version+1 WHERE id=$5 AND workflow_state=$6 AND row_version=$7 RETURNING *", [input.state, input.updatedAt, input.implementationStartedAt ?? null, input.completedAt ?? null, input.id, input.expectedState, input.expectedRowVersion])); if (!result) throw new PersistenceError("PERSISTENCE_CONFLICT", "The workflow state is stale."); return normalizeProjectRow(result); }
  async updateProjectSiteLanguage(input: { id: string; siteLanguage: string; updatedAt: string }) { const result = value<ProjectRow>(await this.query("UPDATE factory_projects SET site_language=$1, updated_at=$2 WHERE id=$3 RETURNING *", [input.siteLanguage, input.updatedAt, input.id])); if (!result) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found."); return normalizeProjectRow(result); }
  async listAssets(projectId: string) { const result = await this.query<ProjectAssetRow>("SELECT schema_version AS \"schemaVersion\", asset_id AS \"assetId\", project_id AS \"projectId\", project_version AS \"projectVersion\", category, source, safe_display_name AS \"safeDisplayName\", media_type AS \"mediaType\", byte_size AS \"byteSize\", sha256, storage_identity AS \"storageIdentity\", status, created_at AS \"createdAt\", updated_at AS \"updatedAt\", asset_version AS version, currentness, supersedes_asset_id AS \"supersedesAssetId\", rejection_reason AS \"rejectionReason\" FROM factory_project_assets WHERE project_id=$1 ORDER BY created_at DESC, asset_id DESC", [projectId]); return result.rows.map(normalizeAssetRow); }
  async getAsset(projectId: string, assetId: string) { const result = value<ProjectAssetRow>(await this.query("SELECT schema_version AS \"schemaVersion\", asset_id AS \"assetId\", project_id AS \"projectId\", project_version AS \"projectVersion\", category, source, safe_display_name AS \"safeDisplayName\", media_type AS \"mediaType\", byte_size AS \"byteSize\", sha256, storage_identity AS \"storageIdentity\", status, created_at AS \"createdAt\", updated_at AS \"updatedAt\", asset_version AS version, currentness, supersedes_asset_id AS \"supersedesAssetId\", rejection_reason AS \"rejectionReason\" FROM factory_project_assets WHERE project_id=$1 AND asset_id=$2", [projectId, assetId])); return result ? normalizeAssetRow(result) : null; }
  async insertAsset(row: ProjectAssetRow) { const result = value<ProjectAssetRow>(await this.query("INSERT INTO factory_project_assets (schema_version, asset_id, project_id, project_version, category, source, safe_display_name, media_type, byte_size, sha256, storage_identity, status, created_at, updated_at, asset_version, currentness, supersedes_asset_id, rejection_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING schema_version AS \"schemaVersion\", asset_id AS \"assetId\", project_id AS \"projectId\", project_version AS \"projectVersion\", category, source, safe_display_name AS \"safeDisplayName\", media_type AS \"mediaType\", byte_size AS \"byteSize\", sha256, storage_identity AS \"storageIdentity\", status, created_at AS \"createdAt\", updated_at AS \"updatedAt\", asset_version AS version, currentness, supersedes_asset_id AS \"supersedesAssetId\", rejection_reason AS \"rejectionReason\"", [row.schemaVersion, row.assetId, row.projectId, row.projectVersion, row.category, row.source, row.safeDisplayName, row.mediaType, row.byteSize, row.sha256, row.storageIdentity, row.status, row.createdAt, row.updatedAt, row.version, row.currentness, row.supersedesAssetId ?? null, row.rejectionReason ?? null])); if (!result) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "Asset insert returned no row."); return normalizeAssetRow(result); }
  async updateAsset(row: ProjectAssetRow) { const result = value<ProjectAssetRow>(await this.query("UPDATE factory_project_assets SET project_version=$1, category=$2, safe_display_name=$3, media_type=$4, byte_size=$5, sha256=$6, storage_identity=$7, status=$8, updated_at=$9, asset_version=$10, currentness=$11, supersedes_asset_id=$12, rejection_reason=$13 WHERE project_id=$14 AND asset_id=$15 RETURNING schema_version AS \"schemaVersion\", asset_id AS \"assetId\", project_id AS \"projectId\", project_version AS \"projectVersion\", category, source, safe_display_name AS \"safeDisplayName\", media_type AS \"mediaType\", byte_size AS \"byteSize\", sha256, storage_identity AS \"storageIdentity\", status, created_at AS \"createdAt\", updated_at AS \"updatedAt\", asset_version AS version, currentness, supersedes_asset_id AS \"supersedesAssetId\", rejection_reason AS \"rejectionReason\"", [row.projectVersion, row.category, row.safeDisplayName, row.mediaType, row.byteSize, row.sha256, row.storageIdentity, row.status, row.updatedAt, row.version, row.currentness, row.supersedesAssetId ?? null, row.rejectionReason ?? null, row.projectId, row.assetId])); if (!result) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Asset was not found."); return normalizeAssetRow(result); }
  async deleteAsset(projectId: string, assetId: string) { await this.query("DELETE FROM factory_project_assets WHERE project_id=$1 AND asset_id=$2", [projectId, assetId]); }
  async getVersion(projectId: string, version: number) { const row = (value(await this.query("SELECT id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\" FROM project_versions WHERE project_id=$1 AND version_number=$2", [projectId, version])) as ProjectVersionRow | undefined); return row ? normalizeVersionRow(row) : null; }
  async listVersions(projectId: string) { const result = await this.query("SELECT id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\" FROM project_versions WHERE project_id=$1 ORDER BY version_number", [projectId]); return result.rows.map((row) => normalizeVersionRow(row as ProjectVersionRow)); }
  async reserveNextVersion(projectId: string, token?: { key: string; payloadHash: string }) {
    const existing = token ? value<{ payload_hash: string; result: ProjectVersionRow }>(await this.query("SELECT payload_hash, result FROM idempotency_records WHERE operation='version:reserve' AND idempotency_key=$1 FOR UPDATE", [token.key])) : undefined;
    if (existing && existing.payload_hash !== token?.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different payload.");
    if (existing) return existing.result;
    const project = value<ProjectRow>(await this.query("SELECT * FROM factory_projects WHERE id=$1 FOR UPDATE", [projectId])); if (!project) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found.");
    const current = Number(project.current_version); const currentExists = value<{ exists: boolean }>(await this.query("SELECT exists(select 1 from project_versions where project_id=$1 and version_number=$2)", [projectId, current]))?.exists ?? false; const versionNumber = currentExists ? current + 1 : current; const now = new Date().toISOString();
    const row: ProjectVersionRow = { id: randomUUID(), projectId, versionNumber, state: project.workflow_state, memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: now, updatedAt: now, rowVersion: 1 };
    const inserted = await this.insertVersion(row); await this.query("UPDATE factory_projects SET current_version=$1, updated_at=$2 WHERE id=$3", [versionNumber, now, projectId]); if (token) await this.query("INSERT INTO idempotency_records(operation,idempotency_key,payload_hash,result) VALUES('version:reserve',$1,$2,$3)", [token.key, token.payloadHash, inserted]); return inserted;
  }
  async insertVersion(row: ProjectVersionRow, token?: { key: string; payloadHash: string }) { const existing = await this.idempotent("version:create", token, row); if (existing) return normalizeVersionRow(existing as ProjectVersionRow); const result = value(await this.query("INSERT INTO project_versions (id, project_id, version_number, state, memory_root_path, requirements_checksum, selected_design_checksum, architecture_checksum, released_at, immutable, created_at, updated_at, row_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [row.id, row.projectId, row.versionNumber, row.state, row.memoryRootPath, row.requirementsChecksum, row.selectedDesignChecksum, row.architectureChecksum, row.releasedAt, row.immutable, row.createdAt, row.updatedAt, row.rowVersion])); if (!result) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "Version insert returned no row."); return normalizeVersionRow(result as ProjectVersionRow); }
  async updateVersionImmutable(projectId: string, version: number, releasedAt: string) { const result = value(await this.query("UPDATE project_versions SET state='PROJECT_READY', released_at=$1, immutable=true, updated_at=$1, row_version=row_version+1 WHERE project_id=$2 AND version_number=$3 AND immutable=false RETURNING id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [releasedAt, projectId, version])); if (!result) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Project version is missing or immutable."); return normalizeVersionRow(result as ProjectVersionRow); }
  async updateVersionRequirementsChecksum(input: { projectId: string; version: number; expectedRowVersion: number; checksum: string; updatedAt: string }) { const result = value(await this.query("UPDATE project_versions SET requirements_checksum=$1, updated_at=$2, row_version=row_version+1 WHERE project_id=$3 AND version_number=$4 AND row_version=$5 AND immutable=false RETURNING id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [input.checksum, input.updatedAt, input.projectId, input.version, input.expectedRowVersion])); if (!result) throw new PersistenceError("PERSISTENCE_CONFLICT", "The project version checksum is stale or immutable."); return normalizeVersionRow(result as ProjectVersionRow); }
  async saveDocument(row: DocumentRow, token?: { key: string; payloadHash: string }) { const existing = await this.idempotent(`document:${row.projectId}:${row.projectVersion}:${row.documentType}`, token, row); if (existing) return normalizeDocumentRow(existing as DocumentRow); const result = value(await this.query("INSERT INTO workflow_documents (project_id, project_version, document_type, schema_version, checksum, payload, created_at, updated_at, row_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1) ON CONFLICT (project_id, project_version, document_type) DO UPDATE SET schema_version=EXCLUDED.schema_version, checksum=EXCLUDED.checksum, payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at, row_version=workflow_documents.row_version+1 RETURNING project_id AS \"projectId\", project_version AS \"projectVersion\", document_type AS \"documentType\", schema_version AS \"schemaVersion\", checksum, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [row.projectId, row.projectVersion, row.documentType, row.schemaVersion, row.checksum, row.payload, row.createdAt, row.updatedAt])); if (!result) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "Document save returned no row."); return normalizeDocumentRow(result as DocumentRow); }
  async getDocument(projectId: string, version: number, documentType: string) { const row = value(await this.query("SELECT project_id AS \"projectId\", project_version AS \"projectVersion\", document_type AS \"documentType\", schema_version AS \"schemaVersion\", checksum, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\" FROM workflow_documents WHERE project_id=$1 AND project_version=$2 AND document_type=$3", [projectId, version, documentType])) as DocumentRow | undefined; return row ? normalizeDocumentRow(row) : null; }
  async saveDocumentCAS(input: { row: DocumentRow; expectedRowVersion: number | null; expectedChecksum: string | null }) {
    const row = input.row;
    if (input.expectedRowVersion === null) {
      const inserted = value<DocumentRow>(await this.query("INSERT INTO workflow_documents (project_id, project_version, document_type, schema_version, checksum, payload, created_at, updated_at, row_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1) ON CONFLICT (project_id, project_version, document_type) DO NOTHING RETURNING project_id AS \"projectId\", project_version AS \"projectVersion\", document_type AS \"documentType\", schema_version AS \"schemaVersion\", checksum, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [row.projectId, row.projectVersion, row.documentType, row.schemaVersion, row.checksum, row.payload, row.createdAt, row.updatedAt]));
      if (!inserted) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 current document was created concurrently.");
      return normalizeDocumentRow(inserted);
    }
    if (!input.expectedChecksum) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "A current document checksum is required for CAS.");
    const updated = value<DocumentRow>(await this.query("UPDATE workflow_documents SET schema_version=$1, checksum=$2, payload=$3, updated_at=$4, row_version=row_version+1 WHERE project_id=$5 AND project_version=$6 AND document_type=$7 AND row_version=$8 AND checksum=$9 RETURNING project_id AS \"projectId\", project_version AS \"projectVersion\", document_type AS \"documentType\", schema_version AS \"schemaVersion\", checksum, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\"", [row.schemaVersion, row.checksum, row.payload, row.updatedAt, row.projectId, row.projectVersion, row.documentType, input.expectedRowVersion, input.expectedChecksum]));
    if (!updated) throw new PersistenceError("PERSISTENCE_CONFLICT", "The current document is stale.");
    return normalizeDocumentRow(updated);
  }
  async deleteDocument(projectId: string, version: number, documentType: string) { await this.query("DELETE FROM workflow_documents WHERE project_id=$1 AND project_version=$2 AND document_type=$3", [projectId, version, documentType]); }
  async appendDecision(projectId: string, version: number, record: DecisionRecord, revisionAttemptId?: string) { const result = value<DecisionRecord>(await this.query("INSERT INTO decision_records (id, project_id, project_version, timestamp, actor_type, actor_identifier, category, decision, rationale, affected_documents, requirement_change, user_approval_required, user_approval_status, supersedes_decision_id, revision_attempt_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, timestamp, actor_type AS \"actorType\", actor_identifier AS \"actorIdentifier\", category, decision, rationale, affected_documents AS \"affectedDocuments\", requirement_change AS \"requirementChange\", user_approval_required AS \"userApprovalRequired\", user_approval_status AS \"userApprovalStatus\", supersedes_decision_id AS \"supersedesDecisionId\"", [record.id, projectId, version, record.timestamp, record.actorType, record.actorIdentifier, record.category, record.decision, JSON.stringify(record.affectedDocuments), record.requirementChange, record.userApprovalRequired, record.userApprovalStatus, record.supersedesDecisionId ?? null, revisionAttemptId ?? null])); if (!result) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "Decision insert returned no row."); return result; }
  async listDecisions(projectId: string, version: number) { const result = await this.query<DecisionRecord>("SELECT id, timestamp, actor_type AS \"actorType\", actor_identifier AS \"actorIdentifier\", category, decision, rationale, affected_documents AS \"affectedDocuments\", requirement_change AS \"requirementChange\", user_approval_required AS \"userApprovalRequired\", user_approval_status AS \"userApprovalStatus\", supersedes_decision_id AS \"supersedesDecisionId\" FROM decision_records WHERE project_id=$1 AND project_version=$2 ORDER BY timestamp, id", [projectId, version]); return result.rows; }
  async appendWorkflowEvent(event: WorkflowEvent) { await this.query("INSERT INTO workflow_events (id, project_id, project_version, from_state, to_state, actor, reason, created_at, idempotency_key, revision_attempt_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [event.id, event.projectId, event.projectVersion, event.fromState, event.toState, event.actor, event.reason, event.createdAt, event.idempotencyKey ?? null, event.revisionAttemptId ?? null]); return event; }
  async saveCost(record: CostRecord) { await this.query("INSERT INTO cost_records (id, project_id, project_version, role, task_id, provider, model, input_tokens, cached_input_tokens, output_tokens, estimated_cost, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [record.id, record.projectId, record.projectVersion, record.role, record.taskId ?? null, record.provider, record.model, record.inputTokens, record.cachedInputTokens, record.outputTokens, record.estimatedCost, record.createdAt]); return record; }
  async reserveOperation(input: { operation: string; key: string; payloadHash: string }): Promise<OperationReservation> {
    const inserted = await this.query("INSERT INTO idempotency_records (operation, idempotency_key, payload_hash, result) VALUES ($1, $2, $3, $4) ON CONFLICT (operation, idempotency_key) DO NOTHING RETURNING operation", [input.operation, input.key, input.payloadHash, { status: "IN_PROGRESS" }]);
    if (inserted.rows.length) return { status: "NEW", key: input.key };
    const existing = value<{ payload_hash: string; result: { status?: string; result?: unknown } }>(await this.query("SELECT payload_hash, result FROM idempotency_records WHERE operation = $1 AND idempotency_key = $2 FOR UPDATE", [input.operation, input.key]));
    if (!existing || existing.payload_hash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key was already used with a different payload.");
    if (existing.result.status === "IN_PROGRESS") return { status: "IN_PROGRESS", key: input.key };
    if (existing.result.status === "SUCCEEDED") return { status: "SUCCEEDED", key: input.key, result: existing.result.result };
    await this.query("UPDATE idempotency_records SET result = $1 WHERE operation = $2 AND idempotency_key = $3", [{ status: "IN_PROGRESS" }, input.operation, input.key]);
    return { status: "NEW", key: input.key };
  }
  async completeOperation(input: { operation: string; key: string; payloadHash: string; result: unknown }) {
    const updated = await this.query("UPDATE idempotency_records SET result = $1 WHERE operation = $2 AND idempotency_key = $3 AND payload_hash = $4", [{ status: "SUCCEEDED", result: input.result }, input.operation, input.key, input.payloadHash]);
    if (!updated.rowCount) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key is not current.");
  }
  async failOperation(input: { operation: string; key: string; payloadHash: string }) {
    const updated = await this.query("UPDATE idempotency_records SET result = $1 WHERE operation = $2 AND idempotency_key = $3 AND payload_hash = $4", [{ status: "FAILED" }, input.operation, input.key, input.payloadHash]);
    if (!updated.rowCount) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The operation key is not current.");
  }
  private async readBriefRevisionAttempt(input: { operationKind: string; operationKey: string; forUpdate?: boolean }) {
    const lock = input.forUpdate ? " FOR UPDATE" : "";
    const sql = "SELECT id, operation_kind AS \"operationKind\", operation_key AS \"operationKey\", payload_hash AS \"payloadHash\", project_id AS \"projectId\", project_version AS \"projectVersion\", currentness_token AS \"currentnessToken\", status, lease_owner AS \"leaseOwner\", lease_expires_at AS \"leaseExpiresAt\", attempt_generation AS \"attemptGeneration\", claimed_at AS \"claimedAt\", committed_result AS \"committedResult\", failure_code AS \"failureCode\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM brief_revision_attempts WHERE operation_kind=$1 AND operation_key=$2" + lock;
    const row = value<Record<string, unknown>>(await this.query(sql, [input.operationKind, input.operationKey]));
    return row ? normalizeBriefRevisionAttempt(row) : null;
  }
  async getBriefRevisionAttempt(input: { operationKind: string; operationKey: string; payloadHash?: string }) {
    const row = await this.readBriefRevisionAttempt(input);
    if (row && input.payloadHash && row.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
    return row;
  }
  async getBriefRevisionHistory(attemptId: string) {
    const row = value<Record<string, unknown>>(await this.query("SELECT id, attempt_id AS \"attemptId\", project_id AS \"projectId\", project_version AS \"projectVersion\", revision_reference AS \"revisionReference\", previous_current_checksum AS \"previousCurrentChecksum\", next_current_checksum AS \"nextCurrentChecksum\", change_set_checksum AS \"changeSetChecksum\", entries, created_at AS \"createdAt\" FROM brief_revision_history WHERE attempt_id=$1", [attemptId]));
    return row ? { id: String(row.id), attemptId: String(row.attemptId), projectId: String(row.projectId), projectVersion: Number(row.projectVersion), revisionReference: String(row.revisionReference), previousCurrentChecksum: String(row.previousCurrentChecksum), nextCurrentChecksum: String(row.nextCurrentChecksum), changeSetChecksum: String(row.changeSetChecksum), entries: Array.isArray(row.entries) ? row.entries : [], createdAt: String(row.createdAt) } : null;
  }
  async listBriefRevisionHistory(projectId: string, projectVersion: number) {
    const result = await this.query<Record<string, unknown>>("SELECT id, attempt_id AS \"attemptId\", project_id AS \"projectId\", project_version AS \"projectVersion\", revision_reference AS \"revisionReference\", previous_current_checksum AS \"previousCurrentChecksum\", next_current_checksum AS \"nextCurrentChecksum\", change_set_checksum AS \"changeSetChecksum\", entries, created_at AS \"createdAt\" FROM brief_revision_history WHERE project_id=$1 AND project_version=$2 ORDER BY created_at, id", [projectId, projectVersion]);
    return result.rows.map((row) => ({ id: String(row.id), attemptId: String(row.attemptId), projectId: String(row.projectId), projectVersion: Number(row.projectVersion), revisionReference: String(row.revisionReference), previousCurrentChecksum: String(row.previousCurrentChecksum), nextCurrentChecksum: String(row.nextCurrentChecksum), changeSetChecksum: String(row.changeSetChecksum), entries: Array.isArray(row.entries) ? row.entries : [], createdAt: String(row.createdAt) }));
  }
  async getBriefRevisionProjectionSync(attemptId: string) {
    const row = value<Record<string, unknown>>(await this.query("SELECT id, attempt_id AS \"attemptId\", project_id AS \"projectId\", project_version AS \"projectVersion\", document_checksum AS \"documentChecksum\", status, attempt_count AS \"attemptCount\", last_failure_code AS \"lastFailureCode\", next_attempt_at AS \"nextAttemptAt\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM brief_revision_projection_sync WHERE attempt_id=$1", [attemptId]));
    return row ? normalizeBriefRevisionProjection(row) : null;
  }
  async listWorkflowEvents(projectId: string, projectVersion: number) {
    const result = await this.query<Record<string, unknown>>("SELECT id, project_id AS \"projectId\", project_version AS \"projectVersion\", from_state AS \"fromState\", to_state AS \"toState\", actor, reason, created_at AS \"createdAt\", idempotency_key AS \"idempotencyKey\", revision_attempt_id AS \"revisionAttemptId\" FROM workflow_events WHERE project_id=$1 AND project_version=$2 ORDER BY created_at, id", [projectId, projectVersion]);
    return result.rows.map((row) => ({ id: String(row.id), projectId: String(row.projectId), projectVersion: Number(row.projectVersion), fromState: String(row.fromState) as WorkflowEvent["fromState"], toState: String(row.toState) as WorkflowEvent["toState"], actor: String(row.actor), reason: String(row.reason), createdAt: String(row.createdAt), ...(row.idempotencyKey == null ? {} : { idempotencyKey: String(row.idempotencyKey) }), ...(row.revisionAttemptId == null ? {} : { revisionAttemptId: String(row.revisionAttemptId) }) }));
  }
  async reserveBriefRevisionAttempt(input: { id: string; operationKind: string; operationKey: string; payloadHash: string; projectId: string; projectVersion: number; currentnessToken: Record<string, unknown>; now: string }) {
    await this.query("INSERT INTO brief_revision_attempts (id, operation_kind, operation_key, payload_hash, project_id, project_version, currentness_token, status, attempt_generation, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVED',0,$8,$8) ON CONFLICT (operation_kind, operation_key) DO NOTHING", [input.id, input.operationKind, input.operationKey, input.payloadHash, input.projectId, input.projectVersion, input.currentnessToken, input.now]);
    const row = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!row) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The V3 attempt reservation was not returned.");
    if (row.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
    return row;
  }
  async claimBriefRevisionAttempt(input: { attemptId: string; operationKind: string; operationKey: string; payloadHash: string; owner: string; now: string; leaseExpiresAt: string }): Promise<BriefRevisionAttemptClaim> {
    const row = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!row || row.id !== input.attemptId) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The V3 attempt was not found.");
    if (row.payloadHash !== input.payloadHash) throw new PersistenceError("IDEMPOTENCY_CONFLICT", "The V3 operation key was used with a different payload.");
    if (row.status === "COMMITTED") return { outcome: "COMMITTED_REPLAY", row };
    if (row.status === "REJECTED_INVALID" || row.status === "REJECTED_STALE") return { outcome: "TERMINAL_REPLAY", row };
    if (row.status === "PROVIDER_PENDING" && row.leaseExpiresAt && Date.parse(row.leaseExpiresAt) > Date.parse(input.now)) return { outcome: "IN_PROGRESS_DUPLICATE", row };
    if (!["RESERVED", "FAILED_RETRYABLE", "PROVIDER_PENDING"].includes(row.status)) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt cannot be claimed from its current state.");
    const updated = await this.query("UPDATE brief_revision_attempts SET status='PROVIDER_PENDING', lease_owner=$1, lease_expires_at=$2, attempt_generation=attempt_generation+1, claimed_at=$3, failure_code=NULL, updated_at=$3 WHERE id=$4 AND operation_kind=$5 AND operation_key=$6 AND payload_hash=$7 AND status=$8", [input.owner, input.leaseExpiresAt, input.now, input.attemptId, input.operationKind, input.operationKey, input.payloadHash, row.status]);
    if (!updated.rowCount) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt claim was lost.");
    const claimed = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!claimed) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The V3 attempt claim was not returned.");
    return { outcome: "CLAIMED", row: claimed };
  }
  async transitionBriefRevisionAttempt(input: BriefRevisionAttemptTransition) {
    const allowed: Record<BriefRevisionAttemptStatus, readonly BriefRevisionAttemptStatus[]> = {
      RESERVED: ["PROVIDER_PENDING", "FAILED_RETRYABLE", "REJECTED_INVALID", "REJECTED_STALE"],
      PROVIDER_PENDING: ["FAILED_RETRYABLE", "REJECTED_INVALID", "REJECTED_STALE"],
      FAILED_RETRYABLE: ["PROVIDER_PENDING"],
      COMMITTED: [],
      REJECTED_INVALID: [],
      REJECTED_STALE: [],
    };
    if (!allowed[input.from].includes(input.to)) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt transition is invalid.");
    const ownerPredicate = input.owner ? " AND lease_owner=$12" : "";
    const values = [input.to, input.leaseExpiresAt ?? null, input.failureCode ?? null, input.committedResult ?? null, input.now, input.attemptId, input.operationKind, input.operationKey, input.payloadHash, input.from, input.attemptGeneration, ...(input.owner ? [input.owner] : [])];
    const updated = await this.query("UPDATE brief_revision_attempts SET status=$1, lease_owner=NULL, lease_expires_at=$2, failure_code=$3, committed_result=$4, updated_at=$5 WHERE id=$6 AND operation_kind=$7 AND operation_key=$8 AND payload_hash=$9 AND status=$10 AND attempt_generation=$11" + ownerPredicate, values);
    if (!updated.rowCount) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt transition was stale.");
    const row = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!row) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The V3 attempt transition was not returned.");
    return row;
  }
  async commitBriefRevision(input: BriefRevisionAtomicCommitInput): Promise<BriefRevisionAtomicCommitResult> {
    const project = value<ProjectRow>(await this.query("SELECT * FROM factory_projects WHERE id=$1 FOR UPDATE", [input.projectId]));
    if (!project) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "Project was not found.");
    const version = value<ProjectVersionRow>(await this.query("SELECT id, project_id AS \"projectId\", version_number AS \"versionNumber\", state, memory_root_path AS \"memoryRootPath\", requirements_checksum AS \"requirementsChecksum\", selected_design_checksum AS \"selectedDesignChecksum\", architecture_checksum AS \"architectureChecksum\", released_at AS \"releasedAt\", immutable, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\" FROM project_versions WHERE project_id=$1 AND version_number=$2 FOR UPDATE", [input.projectId, input.projectVersion]));
    if (!version || version.immutable) throw new PersistenceError(version?.immutable ? "PERSISTENCE_IMMUTABLE" : "PERSISTENCE_NOT_FOUND", version?.immutable ? "Project version is immutable." : "Project version was not found.");
    const currentDocumentRow = value<DocumentRow>(await this.query("SELECT project_id AS \"projectId\", project_version AS \"projectVersion\", document_type AS \"documentType\", schema_version AS \"schemaVersion\", checksum, payload, created_at AS \"createdAt\", updated_at AS \"updatedAt\", row_version AS \"rowVersion\" FROM workflow_documents WHERE project_id=$1 AND project_version=$2 AND document_type=$3 FOR UPDATE", [input.projectId, input.projectVersion, input.expected.documentType]));
    const currentDocument = currentDocumentRow ? normalizeDocumentRow(currentDocumentRow) : null;
    const currentAttempt = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!currentAttempt || currentAttempt.id !== input.attemptId || currentAttempt.payloadHash !== input.payloadHash || currentAttempt.status !== "PROVIDER_PENDING" || currentAttempt.leaseOwner !== input.leaseOwner || currentAttempt.attemptGeneration !== input.leaseGeneration) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt is no longer owned for commit.");
    if (project.current_version !== input.projectVersion || project.workflow_state !== input.expected.workflowState || Number(project.row_version) !== input.expected.projectRowVersion || Number(version.rowVersion) !== input.expected.projectVersionRowVersion) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 project currentness token is stale.");
    if (!currentDocument || currentDocument.rowVersion !== input.expected.documentRowVersion || currentDocument.checksum !== input.expected.documentChecksum || canonicalBriefChecksumForDocument(mapRowToDocument(currentDocument)) !== input.expected.briefChecksum) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 current document token is stale.");
    if (!input.changed) {
      await input.fault?.hit("after-cas");
      await this.markBriefRevisionCommitted(input);
      await input.fault?.hit("after-attempt-committed-write");
      await input.fault?.hit("before-db-commit");
      const attempt = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
      if (!attempt) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The committed V3 no-op attempt was not returned.");
      return { attempt, project, document: null, projection: null };
    }
    const updatedProject = await this.updateProjectState({ id: input.projectId, expectedState: input.expected.workflowState, expectedRowVersion: input.expected.projectRowVersion, state: input.workflow.targetState, updatedAt: input.now });
    await input.fault?.hit("after-cas");
    const saved = input.document ? await this.saveDocumentCAS({ row: input.document, expectedRowVersion: input.expected.documentType === input.document.documentType ? input.expected.documentRowVersion : null, expectedChecksum: input.expected.documentType === input.document.documentType ? input.expected.documentChecksum : null }) : null;
    await input.fault?.hit("after-brief-write");
    await this.updateVersionRequirementsChecksum({ projectId: input.projectId, version: input.projectVersion, expectedRowVersion: input.expected.projectVersionRowVersion, checksum: input.nextBriefChecksum, updatedAt: input.now });
    if (input.history) await this.query("INSERT INTO brief_revision_history (id, attempt_id, project_id, project_version, revision_reference, previous_current_checksum, next_current_checksum, change_set_checksum, entries, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [input.history.id, input.history.attemptId, input.history.projectId, input.history.projectVersion, input.history.revisionReference, input.history.previousCurrentChecksum, input.history.nextCurrentChecksum, input.history.changeSetChecksum, JSON.stringify(input.history.entries), input.history.createdAt]);
    await input.fault?.hit("after-history-write");
    if (input.workflow.event) await this.appendWorkflowEvent(input.workflow.event);
    if (input.decision) await this.appendDecision(input.projectId, input.projectVersion, input.decision.record, input.decision.revisionAttemptId);
    await input.fault?.hit("after-workflow-write");
    await this.markBriefRevisionCommitted(input);
    await input.fault?.hit("after-attempt-committed-write");
    if (input.projection) await this.insertBriefRevisionProjection(input.projection);
    await input.fault?.hit("before-db-commit");
    const attempt = await this.readBriefRevisionAttempt({ operationKind: input.operationKind, operationKey: input.operationKey, forUpdate: true });
    if (!attempt) throw new PersistenceError("PERSISTENCE_PROVIDER_ERROR", "The committed V3 attempt was not returned.");
    return { attempt, project: updatedProject, document: saved, projection: input.projection };
  }
  private async markBriefRevisionCommitted(input: BriefRevisionAtomicCommitInput) {
    const result = await this.query("UPDATE brief_revision_attempts SET status='COMMITTED', lease_owner=NULL, lease_expires_at=NULL, committed_result=$1, failure_code=NULL, updated_at=$2 WHERE id=$3 AND operation_kind=$4 AND operation_key=$5 AND payload_hash=$6 AND status='PROVIDER_PENDING' AND lease_owner=$7 AND attempt_generation=$8", [input.result, input.now, input.attemptId, input.operationKind, input.operationKey, input.payloadHash, input.leaseOwner, input.leaseGeneration]);
    if (!result.rowCount) throw new PersistenceError("PERSISTENCE_CONFLICT", "The V3 attempt could not become committed.");
  }
  private async insertBriefRevisionProjection(row: BriefRevisionProjectionRow) {
    await this.query("INSERT INTO brief_revision_projection_sync (id, attempt_id, project_id, project_version, document_checksum, status, attempt_count, last_failure_code, next_attempt_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)", [row.id, row.attemptId, row.projectId, row.projectVersion, row.documentChecksum, row.status, row.attemptCount, row.lastFailureCode, row.nextAttemptAt, row.createdAt]);
    return row;
  }
  async listBriefRevisionProjectionSync(limit: number) {
    const result = await this.query<Record<string, unknown>>("SELECT id, attempt_id AS \"attemptId\", project_id AS \"projectId\", project_version AS \"projectVersion\", document_checksum AS \"documentChecksum\", status, attempt_count AS \"attemptCount\", last_failure_code AS \"lastFailureCode\", next_attempt_at AS \"nextAttemptAt\", created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM brief_revision_projection_sync WHERE status IN ('PENDING','FAILED_RETRYABLE') AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at, id LIMIT $1", [Math.max(1, Math.min(limit, 100))]);
    return result.rows.map(normalizeBriefRevisionProjection);
  }
  async updateBriefRevisionProjectionSync(input: { id: string; expectedStatus: BriefRevisionProjectionStatus; status: BriefRevisionProjectionStatus; attemptCount?: number; failureCode?: string | null; nextAttemptAt?: string | null; updatedAt: string }) {
    const result = value<Record<string, unknown>>(await this.query("UPDATE brief_revision_projection_sync SET status=$1, attempt_count=COALESCE($2, attempt_count), last_failure_code=$3, next_attempt_at=$4, updated_at=$5 WHERE id=$6 AND status=$7 RETURNING id, attempt_id AS \"attemptId\", project_id AS \"projectId\", project_version AS \"projectVersion\", document_checksum AS \"documentChecksum\", status, attempt_count AS \"attemptCount\", last_failure_code AS \"lastFailureCode\", next_attempt_at AS \"nextAttemptAt\", created_at AS \"createdAt\", updated_at AS \"updatedAt\"", [input.status, input.attemptCount ?? null, input.failureCode ?? null, input.nextAttemptAt ?? null, input.updatedAt, input.id, input.expectedStatus]));
    if (!result) throw new PersistenceError("PERSISTENCE_CONFLICT", "The projection sync status is stale.");
    return normalizeBriefRevisionProjection(result);
  }
}
