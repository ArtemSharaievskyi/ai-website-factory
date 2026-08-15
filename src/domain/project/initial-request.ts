import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  IsoDateTimeSchema,
  LocaleSchema,
  UuidSchema,
} from "../shared/schemas";
import { MAX_CANONICAL_USER_INPUT_BYTES, normalizeCanonicalUserInputText } from "./canonical-input";

export const INITIAL_PROJECT_REQUEST_VERSION = 1 as const;
export const MAX_INITIAL_PROJECT_REQUEST_BYTES = MAX_CANONICAL_USER_INPUT_BYTES;

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
  try {
    return normalizeCanonicalUserInputText(value, "INITIAL_REQUEST_TOO_LARGE");
  } catch (error) {
    if (error instanceof Error && error.message === "CANONICAL_INPUT_TYPE_INVALID") throw new Error("INITIAL_REQUEST_TYPE_INVALID");
    if (error instanceof Error && error.message === "CANONICAL_INPUT_EMPTY") throw new Error("INITIAL_REQUEST_EMPTY");
    if (error instanceof Error && error.message === "CANONICAL_INPUT_ENCODING_INVALID") throw new Error("INITIAL_REQUEST_ENCODING_INVALID");
    throw error;
  }
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
