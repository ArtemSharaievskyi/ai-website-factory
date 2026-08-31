import { z } from "zod";

const SafeDiagnosticTokenSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const SafeDiagnosticPathSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9_$.[\]/:-]+$/);
const SafeDiagnosticChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeDiagnosticMessageSchema = z.string().min(1).max(500);
const SafeZodIssueSchema = z.object({
  path: SafeDiagnosticPathSchema,
  code: SafeDiagnosticTokenSchema,
  expected: SafeDiagnosticTokenSchema.optional(),
  received: SafeDiagnosticTokenSchema.optional(),
  message: z.string().min(1).max(240),
}).strict();

export const ProviderFailureDiagnosticSchema = z.object({
  version: z.literal(1),
  category: z.enum([
    "AUTHENTICATION",
    "MODEL_ACCESS",
    "RATE_LIMIT",
    "PROVIDER_UNAVAILABLE",
    "NETWORK",
    "TIMEOUT",
    "CANCELLED",
    "REQUEST_REJECTED",
    "REQUEST_CONSTRUCTION",
    "STRUCTURED_OUTPUT",
    "UNKNOWN",
  ]),
  stage: z.enum(["REQUEST_CONSTRUCTION", "REQUEST_TRANSPORT", "PROVIDER_RESPONSE", "STRUCTURED_OUTPUT", "PROVIDER_MAPPING", "UNKNOWN"]),
  requestAttempted: z.boolean(),
  responseReceived: z.boolean().optional(),
  structuredParsingReached: z.boolean().optional(),
  retryabilityHint: z.boolean().optional(),
  provider: SafeDiagnosticTokenSchema,
  model: SafeDiagnosticTokenSchema.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  requestId: SafeDiagnosticTokenSchema.optional(),
  sdkErrorClass: SafeDiagnosticTokenSchema.optional(),
  providerErrorCode: SafeDiagnosticTokenSchema.optional(),
  providerErrorType: SafeDiagnosticTokenSchema.optional(),
  providerErrorParam: SafeDiagnosticTokenSchema.optional(),
  safeProviderMessage: SafeDiagnosticMessageSchema.optional(),
  errorCode: SafeDiagnosticTokenSchema.optional(),
  schemaName: SafeDiagnosticTokenSchema.optional(),
  choicesCount: z.number().int().nonnegative().optional(),
  finishReason: SafeDiagnosticTokenSchema.nullable().optional(),
  refusalPresent: z.boolean().optional(),
  contentPresent: z.boolean().optional(),
  outputComplete: z.boolean().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  maxCompletionTokens: z.number().int().positive().optional(),
  rawContentBytes: z.number().int().nonnegative().optional(),
  rawContentChecksum: SafeDiagnosticChecksumSchema.optional(),
  jsonParseSucceeded: z.boolean().optional(),
  zodIssueCount: z.number().int().nonnegative().optional(),
  zodIssuesTruncated: z.boolean().optional(),
  completeZodIssuesChecksum: SafeDiagnosticChecksumSchema.optional(),
  zodIssuesBounded: z.array(SafeZodIssueSchema).max(20).optional(),
}).strict();

export type ProviderFailureDiagnostic = z.infer<typeof ProviderFailureDiagnosticSchema>;
