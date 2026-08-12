import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  IsoDateTimeSchema,
  LocaleSchema,
  UuidSchema,
} from "../shared/schemas";

export const INITIAL_PROJECT_REQUEST_VERSION = 1 as const;
export const MAX_INITIAL_PROJECT_REQUEST_BYTES = 128 * 1024;

export const InitialProjectRequestSchema = z
  .object({
    requestId: UuidSchema,
    projectId: UuidSchema,
    requestText: z.string().min(1),
    submittedAt: IsoDateTimeSchema,
    languageHint: LocaleSchema.optional(),
    source: z.literal("USER"),
    version: z.literal(INITIAL_PROJECT_REQUEST_VERSION),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type InitialProjectRequest = z.infer<typeof InitialProjectRequestSchema>;

export function normalizeInitialProjectRequestText(value: string) {
  if (typeof value !== "string") throw new Error("INITIAL_REQUEST_TYPE_INVALID");
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) throw new Error("INITIAL_REQUEST_EMPTY");
  if (normalized.includes("\0")) throw new Error("INITIAL_REQUEST_ENCODING_INVALID");
  if (Buffer.byteLength(normalized, "utf8") > MAX_INITIAL_PROJECT_REQUEST_BYTES)
    throw new Error("INITIAL_REQUEST_TOO_LARGE");
  return normalized;
}

export function createInitialProjectRequest(input: {
  requestText: string;
  projectId?: string;
  requestId?: string;
  submittedAt?: string;
  languageHint?: string;
}) {
  const requestText = normalizeInitialProjectRequestText(input.requestText);
  return InitialProjectRequestSchema.parse({
    requestId: input.requestId ?? randomUUID(),
    projectId: input.projectId ?? randomUUID(),
    requestText,
    submittedAt: input.submittedAt ?? new Date().toISOString(),
    ...(input.languageHint ? { languageHint: input.languageHint } : {}),
    source: "USER",
    version: INITIAL_PROJECT_REQUEST_VERSION,
    checksum: checksumPersistedDocument(requestText),
  });
}
