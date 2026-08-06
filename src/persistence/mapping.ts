import { z } from "zod";
import { DomainError } from "../domain/shared/errors";
import { DocumentBaseSchema } from "../domain/shared/schemas";
import { AssetManifestSchema } from "../domain/assets/schema";
import { TechnicalArchitectureSchema } from "../domain/architecture/schema";
import { ContentPlanSchema } from "../domain/content/schema";
import { DesignDirectionSetSchema, SelectedDesignSchema } from "../domain/design/schema";
import { FactoryProjectSchema } from "../domain/project/schema";
import { QualityReportSchema } from "../domain/quality/schema";
import { RequirementSpecificationSchema } from "../domain/requirements/schema";
import { ClarificationSessionSchema } from "../domain/requirements/schema";
import { ReleaseReportSchema } from "../domain/release/schema";
import { TaskGraphSchema } from "../domain/tasks/schema";
import { checksumPersistedDocument } from "./serialization";
import { PersistenceError } from "./errors";

export const PersistedDocumentSchema = z.union([ClarificationSessionSchema, RequirementSpecificationSchema, DesignDirectionSetSchema, SelectedDesignSchema, TechnicalArchitectureSchema, ContentPlanSchema, AssetManifestSchema, TaskGraphSchema, QualityReportSchema, ReleaseReportSchema]);
export type PersistedDocument = z.infer<typeof PersistedDocumentSchema>;

export type DocumentRow = { projectId: string; projectVersion: number; documentType: string; schemaVersion: number; checksum: string; payload: unknown; createdAt: string; updatedAt: string; rowVersion: number };

export function mapProjectToRow(project: z.infer<typeof FactoryProjectSchema>) {
  return { id: project.id, slug: project.slug, title: project.title ?? null, original_prompt: project.originalPrompt, current_version: project.currentVersion, workflow_state: project.workflowState, created_at: project.createdAt, updated_at: project.updatedAt, implementation_started_at: project.implementationStartedAt ?? null, completed_at: project.completedAt ?? null, row_version: 1 };
}

export function mapRowToProject(row: Record<string, unknown>) {
  const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value;
  try {
    return FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: row.id, projectVersion: row.current_version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), id: row.id, slug: row.slug, ...(row.title ? { title: row.title } : {}), originalPrompt: row.original_prompt, currentVersion: row.current_version, workflowState: row.workflow_state, ...(row.implementation_started_at ? { implementationStartedAt: iso(row.implementation_started_at) } : {}), ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}) });
  } catch (error) { throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Stored project data is invalid.", undefined, error); }
}

export function mapDocumentToRow(document: unknown): DocumentRow {
  const parsed = PersistedDocumentSchema.safeParse(document);
  if (!parsed.success) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Document does not match a supported domain contract.", undefined, parsed.error);
  const value = parsed.data;
  return { projectId: value.projectId, projectVersion: value.projectVersion, documentType: value.documentType, schemaVersion: value.schemaVersion, checksum: checksumPersistedDocument(value), payload: value, createdAt: value.createdAt, updatedAt: value.updatedAt, rowVersion: 1 };
}

export function mapRowToDocument(row: DocumentRow): PersistedDocument {
  const parsed = PersistedDocumentSchema.safeParse(row.payload);
  if (!parsed.success) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Stored document payload is invalid.", undefined, parsed.error);
  if (row.schemaVersion !== parsed.data.schemaVersion || row.documentType !== parsed.data.documentType || row.checksum !== checksumPersistedDocument(parsed.data)) throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "Stored document checksum or metadata does not match.");
  return parsed.data;
}

export function assertDocumentBase(document: unknown) { const parsed = DocumentBaseSchema.safeParse(document); if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Persisted value is not a Project Memory document."); return parsed.data; }
