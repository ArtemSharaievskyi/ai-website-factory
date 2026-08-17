import { z } from "zod";

const SafeDiagnosticTokenSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

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
  errorCode: SafeDiagnosticTokenSchema.optional(),
  schemaName: SafeDiagnosticTokenSchema.optional(),
}).strict();

export type ProviderFailureDiagnostic = z.infer<typeof ProviderFailureDiagnosticSchema>;
