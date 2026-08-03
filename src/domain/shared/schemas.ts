import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const UuidSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)),
  "Expected an ISO 8601 UTC date-time",
);
export const NonEmptyStringSchema = z.string().trim().min(1);
export const ProjectSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase and filesystem-safe").max(80);
export const RelativePathSchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."),
  "Expected a safe relative path",
);
export const ProjectVersionSchema = z.number().int().positive();
export const LocaleSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export const UrlSchema = z.string().url();
export const UserValueSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("provided"), value: NonEmptyStringSchema }).strict(),
  z.object({ status: z.literal("missing") }).strict(),
  z.object({ status: z.literal("deferred"), reason: NonEmptyStringSchema }).strict(),
]);

export const DocumentBaseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  documentType: NonEmptyStringSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export type Uuid = z.infer<typeof UuidSchema>;
export type DocumentBase = z.infer<typeof DocumentBaseSchema>;
export type UserValue = z.infer<typeof UserValueSchema>;
