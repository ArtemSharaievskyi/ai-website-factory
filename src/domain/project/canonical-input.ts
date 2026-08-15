import { z } from "zod";

/** Canonical user requirements are lossless, but still have an explicit UTF-8 bound. */
export const MAX_CANONICAL_USER_INPUT_BYTES = 128 * 1024;

export const utf8ByteLength = (value: string) => Buffer.byteLength(value, "utf8");

export function normalizeCanonicalUserInputText(value: string, tooLargeCode: string) {
  if (typeof value !== "string") throw new Error("CANONICAL_INPUT_TYPE_INVALID");
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) throw new Error("CANONICAL_INPUT_EMPTY");
  if (normalized.includes("\0")) throw new Error("CANONICAL_INPUT_ENCODING_INVALID");
  if (utf8ByteLength(normalized) > MAX_CANONICAL_USER_INPUT_BYTES) throw new Error(tooLargeCode);
  return normalized;
}

/**
 * Zod uses JavaScript string length for `.max()`. Canonical text is bounded by
 * UTF-8 bytes instead, so Unicode has the same capacity policy as ASCII.
 */
export const canonicalUserInstructionSchema = (issueCode = "VALUE_TOO_LARGE") =>
  z.string().min(1).superRefine((value, context) => {
    if (!value.trim()) {
      context.addIssue({ code: "custom", message: "Canonical instruction cannot be blank.", params: { issueCode: "EMPTY_CANONICAL_INPUT" } });
    } else if (utf8ByteLength(value) > MAX_CANONICAL_USER_INPUT_BYTES) {
      context.addIssue({ code: "custom", message: "Canonical instruction exceeds the UTF-8 byte bound.", params: { issueCode } });
    }
  });
