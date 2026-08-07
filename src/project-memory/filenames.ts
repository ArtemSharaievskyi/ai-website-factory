import { z } from "zod";
import { AssetManifestSchema } from "../domain/assets/schema";
import { TechnicalArchitectureSchema } from "../domain/architecture/schema";
import { ContentPlanSchema } from "../domain/content/schema";
import { DesignDirectionSetSchema, SelectedDesignSchema } from "../domain/design/schema";
import { FactoryProjectSchema } from "../domain/project/schema";
import { QualityReportSchema } from "../domain/quality/schema";
import { RequirementSpecificationSchema, ClarificationSessionSchema } from "../domain/requirements/schema";
import { ReleaseReportSchema } from "../domain/release/schema";
import { TaskGraphSchema } from "../domain/tasks/schema";
import { DocumentBaseSchema, SCHEMA_VERSION } from "../domain/shared/schemas";
import { PlanningPackageSchema } from "../planner/contracts";
import { ImplementationRunsSchema } from "../domain/implementation/schema";
import { FunctionalQaMemorySummarySchema } from "../playwright-functional-qa/contracts";

export const ProjectMemoryDocumentSchema = z.object({ relativePath: z.string(), documentType: z.string(), schemaVersion: z.literal(SCHEMA_VERSION), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteSize: z.number().int().nonnegative(), updatedAt: z.string() }).strict();
export const ProjectMemoryManifestSchema = DocumentBaseSchema.extend({ documentType: z.literal("manifest"), documents: z.array(ProjectMemoryDocumentSchema) }).strict();

export const DOCUMENT_SCHEMAS = {
  "project.json": FactoryProjectSchema,
  "clarification-log.json": ClarificationSessionSchema,
  "requirements.json": RequirementSpecificationSchema,
  "design-directions.json": DesignDirectionSetSchema,
  "selected-design.json": SelectedDesignSchema,
  "architecture.json": TechnicalArchitectureSchema,
  "content-plan.json": ContentPlanSchema,
  "asset-manifest.json": AssetManifestSchema,
  "planning-package.json": PlanningPackageSchema,
  "task-graph.json": TaskGraphSchema,
  "implementation-runs.json": ImplementationRunsSchema,
  "quality-report.json": QualityReportSchema,
  "release-report.json": ReleaseReportSchema,
  "functional-qa.json": FunctionalQaMemorySummarySchema,
  "manifest.json": ProjectMemoryManifestSchema,
} as const;

export const REQUIRED_DOCUMENTS = [...Object.keys(DOCUMENT_SCHEMAS).filter((name) => name !== "manifest.json" && name !== "planning-package.json" && name !== "implementation-runs.json" && name !== "functional-qa.json"), "decisions.jsonl", "original-prompt.md"];
export const CANONICAL_DOCUMENT_NAMES = [...Object.keys(DOCUMENT_SCHEMAS), "decisions.jsonl", "original-prompt.md"] as const;
export type StructuredDocumentName = keyof typeof DOCUMENT_SCHEMAS;
export type ProjectMemoryManifest = z.infer<typeof ProjectMemoryManifestSchema>;
