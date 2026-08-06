import { z } from "zod";
import { IsoDateTimeSchema, NonEmptyStringSchema, ProjectVersionSchema, UuidSchema } from "../domain/shared/schemas";

const RESERVED_WINDOWS_NAMES = new Set(["con", "prn", "aux", "nul", ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)]);
export const WorkspaceRootSchema = z.string().min(1).refine((value) => /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value) || value.startsWith("/"), "Workspace root must be absolute");
export const WorkspaceSlugSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Workspace slug must be lowercase ASCII and filesystem-safe").refine((value) => !RESERVED_WINDOWS_NAMES.has(value.toLowerCase()), "Workspace slug is a reserved Windows device name").refine((value) => !/%2e|%2f|%5c/i.test(value), "Encoded path separators are not allowed");
export const OperationIdSchema = NonEmptyStringSchema.regex(/^[A-Za-z0-9_-]{8,80}$/, "Operation ID must be filesystem-safe");
export const WorkspaceVersionSummarySchema = z.object({ version: ProjectVersionSchema, directory: z.string().regex(/^v[1-9]\d*$/), immutable: z.boolean(), state: z.string().min(1), createdAt: IsoDateTimeSchema }).strict();
export const WorkspaceProjectMetadataSchema = z.object({ schemaVersion: z.literal(1), documentType: z.literal("workspace-project"), projectId: UuidSchema, slug: WorkspaceSlugSchema, title: NonEmptyStringSchema.optional(), latestVersion: z.number().int().nonnegative(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, versions: z.array(WorkspaceVersionSummarySchema) }).strict();
export type WorkspaceProjectMetadata = z.infer<typeof WorkspaceProjectMetadataSchema>;
export type WorkspaceVersionSummary = z.infer<typeof WorkspaceVersionSummarySchema>;

export function normalizeWorkspaceRoot(value: string) { const parsed = WorkspaceRootSchema.parse(value); if (/^[A-Za-z]:[\\/]$/.test(parsed)) return `${parsed[0]}:${parsed[1]}`; return parsed.replace(/[\\/]$/, ""); }
export function versionDirectoryName(version: number) { return `v${ProjectVersionSchema.parse(version)}`; }
