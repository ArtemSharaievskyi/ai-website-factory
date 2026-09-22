import OpenAI from "openai";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type sharp from "sharp";
import type { Metadata } from "sharp";
import { z } from "zod";
import { createProviderFailureDiagnostic } from "./failure-diagnostics";
import { AiProviderError, type AiProviderErrorCode } from "./errors";
import { FLARE_DEFAULT_IMAGE_QUALITY, FLARE_MODEL_FAMILY, FLARE_PRODUCTION_SNAPSHOT } from "./image-config";
import type { ProviderDiagnostic } from "./usage";

export const ImageQualitySchema = z.enum(["xhigh", "max"]);
export const ImageOutputFormatSchema = z.enum(["png", "jpeg", "webp"]);
export const ImageBackgroundSchema = z.enum(["transparent", "opaque", "auto"]);
export const ExceptionalImageQualitySourceSchema = z.enum(["DESIGN_DIRECTION", "ASSET_MANIFEST"]);
export const ImageGenerationTargetSchema = z.object({
  category: z.enum(["IMAGE", "LOGO"]),
  operation: z.enum(["GENERATE", "REPLACE", "EDIT"]),
  isLogo: z.boolean(),
  source: z.enum(["USER_SUPPLIED", "AI_GENERATED"]).optional(),
  assetId: z.string().uuid().optional(),
}).strict();
export const FlareImageGenerationRequestSchema = z.object({
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  target: ImageGenerationTargetSchema,
  prompt: z.string().min(1).max(32_000),
  promptVersion: z.string().min(1).max(120),
  assetPurpose: z.string().min(1).max(160),
  size: z.string().regex(/^(auto|[1-9][0-9]{1,3}x[1-9][0-9]{1,3})$/),
  aspectRatio: z.string().regex(/^[1-9][0-9]*:[1-9][0-9]*$/).optional(),
  background: ImageBackgroundSchema.default("opaque"),
  outputFormat: ImageOutputFormatSchema,
  quality: ImageQualitySchema.default(FLARE_DEFAULT_IMAGE_QUALITY),
  exceptionalQualityRequested: z.boolean().default(false),
  exceptionalQualitySource: ExceptionalImageQualitySourceSchema.optional(),
  compression: z.number().int().min(0).max(100).optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.target.isLogo || value.target.category !== "IMAGE") context.addIssue({ code: "custom", path: ["target"], message: "Supplied logo assets cannot be generated, replaced, or edited." });
  if (value.target.operation !== "GENERATE" && (!value.target.assetId || !value.target.source)) context.addIssue({ code: "custom", path: ["target"], message: "Replacement and edit operations require host-validated asset metadata." });
  if (value.quality === "max" && (!value.exceptionalQualityRequested || !value.exceptionalQualitySource)) context.addIssue({ code: "custom", path: ["quality"], message: "Maximum image quality requires an explicit Design direction or Asset Manifest request." });
  if (value.background === "transparent" && !["png", "webp"].includes(value.outputFormat)) context.addIssue({ code: "custom", path: ["outputFormat"], message: "Transparent output requires PNG or WebP." });
});

export type FlareImageGenerationRequest = z.input<typeof FlareImageGenerationRequestSchema>;
export type NormalizedFlareImageGenerationRequest = z.output<typeof FlareImageGenerationRequestSchema>;
export type GeneratedImageUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number; costStatus: "REPORTED" | "UNAVAILABLE" };
export type GeneratedImageProvenance = {
  provider: "openai";
  projectId: string;
  projectVersion: number;
  assetPurpose: string;
  modelFamily: typeof FLARE_MODEL_FAMILY;
  resolvedModel: typeof FLARE_PRODUCTION_SNAPSHOT;
  requestId: string;
  promptVersion: string;
  requestedQuality: z.infer<typeof ImageQualitySchema>;
  resolvedQuality: z.infer<typeof ImageQualitySchema>;
  requestedMimeType: `image/${"png" | "jpeg" | "webp"}`;
  actualMimeType: `image/${"png" | "jpeg" | "webp"}`;
  requestedWidth?: number;
  requestedHeight?: number;
  actualWidth: number;
  actualHeight: number;
  byteSize: number;
  sha256: string;
  providerStatus: "completed";
  retryCount: 0;
  usage: GeneratedImageUsage;
};
export type GeneratedImage = { bytes: Uint8Array; mediaType: GeneratedImageProvenance["actualMimeType"]; width: number; height: number; sha256: string; provenance: GeneratedImageProvenance };

type ImageResponse = {
  id?: string;
  data?: Array<{ b64_json?: string | null }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost?: number } | null;
};

type SharpFactory = typeof sharp;
const requireSharp = createRequire(import.meta.url);
// Native resolution prevents Turbopack from rewriting this package to a hashed external alias.
const sharpPackageName = ["sh", "arp"].join("");
let sharpModule: Promise<SharpFactory> | undefined;

async function loadSharp(requestId?: string): Promise<SharpFactory> {
  sharpModule ??= Promise.resolve().then(() => requireSharp(sharpPackageName) as SharpFactory);
  try {
    return await sharpModule;
  } catch (error) {
    throw imageError("AI_IMAGE_RUNTIME_UNAVAILABLE", "The supported image decoder runtime is unavailable.", error, true, requestId);
  }
}

const mediaTypeForFormat = (format: string): GeneratedImageProvenance["actualMimeType"] | undefined => format === "png" ? "image/png" : format === "jpeg" || format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : undefined;
const requestedDimensions = (size: string) => {
  if (size === "auto") return {};
  const [width, height] = size.split("x").map(Number);
  return { requestedWidth: width, requestedHeight: height };
};
const safeRequestId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:/-]{1,160}$/.test(value) ? value : "unidentified-image-request";

function imageProviderError(code: AiProviderErrorCode, message: string, diagnostic: ProviderDiagnostic, cause?: unknown): AiProviderError {
  return new AiProviderError(code, message, cause, diagnostic, createProviderFailureDiagnostic({ errorCode: code, model: FLARE_PRODUCTION_SNAPSHOT, schemaName: "flare-image-generation", requestAttempted: diagnostic.requestAttempted, diagnostic, error: cause }));
}

function imageError(code: "AI_IMAGE_CONFIGURATION_INVALID" | "AI_IMAGE_PROTECTED_ASSET" | "AI_IMAGE_MODEL_UNAVAILABLE" | "AI_IMAGE_CONTENT_POLICY_REJECTED" | "AI_IMAGE_RUNTIME_UNAVAILABLE" | "AI_IMAGE_MALFORMED_RESPONSE" | "AI_IMAGE_EMPTY_RESPONSE" | "AI_IMAGE_MIME_MISMATCH" | "AI_IMAGE_DECODE_FAILED" | "AI_IMAGE_DIMENSIONS_INVALID" | "AI_IMAGE_CHECKSUM_FAILED", message: string, cause?: unknown, requestAttempted = false, requestId?: string): AiProviderError {
  const diagnostic = { stage: requestAttempted ? "api_response" as const : "request_construction" as const, requestAttempted, apiResponseReceived: requestAttempted, responseReceived: requestAttempted, outputComplete: false, ...(requestId ? { requestId } : {}), endpointClass: "OPENAI_IMAGE_API", issueCode: code };
  return imageProviderError(code, message, diagnostic, cause);
}

export function assertFlareImageGenerationAllowed(input: FlareImageGenerationRequest): NormalizedFlareImageGenerationRequest {
  const target = input && typeof input === "object" ? (input as { target?: { category?: string; isLogo?: boolean; source?: string } }).target : undefined;
  if (target?.isLogo || target?.category === "LOGO") throw imageError("AI_IMAGE_PROTECTED_ASSET", "A user-supplied logo cannot be generated, replaced, or edited.");
  try {
    return FlareImageGenerationRequestSchema.parse(input);
  } catch (error) {
    throw imageError("AI_IMAGE_CONFIGURATION_INVALID", "The Flare image-generation configuration is invalid.", error);
  }
}

function providerError(error: unknown): AiProviderError {
  const value = error as { status?: unknown; code?: unknown; error?: { code?: unknown; type?: unknown } };
  const status = typeof value?.status === "number" ? value.status : undefined;
  const providerCode = typeof value?.error?.code === "string" ? value.error.code : typeof value?.code === "string" ? value.code : "";
  if (providerCode === "ETIMEDOUT" || (error instanceof Error && /timeout/i.test(error.name))) return imageProviderError("AI_REQUEST_TIMEOUT", "The image provider request timed out safely.", { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, outputComplete: false, endpointClass: "OPENAI_IMAGE_API", openaiErrorCode: providerCode || undefined }, error);
  if (status === 401 || status === 403) return imageProviderError("AI_AUTHENTICATION_FAILED", "Image provider authentication failed.", { stage: "api_request", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, httpStatus: status, openaiErrorCode: providerCode || undefined, endpointClass: "OPENAI_IMAGE_API" }, error);
  if (status === 404) return imageProviderError("AI_IMAGE_MODEL_UNAVAILABLE", "The configured Flare image model is unavailable.", { stage: "api_request", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, httpStatus: status, openaiErrorCode: providerCode || undefined, endpointClass: "OPENAI_IMAGE_API" }, error);
  if (status === 429) return imageProviderError("AI_RATE_LIMITED", "The image provider rate limit was reached.", { stage: "api_request", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, httpStatus: status, openaiErrorCode: providerCode || undefined, endpointClass: "OPENAI_IMAGE_API" }, error);
  if (status !== undefined && status >= 500) return imageProviderError("AI_PROVIDER_UNAVAILABLE", "The image provider is unavailable.", { stage: "api_request", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, httpStatus: status, endpointClass: "OPENAI_IMAGE_API" }, error);
  if (/content[_ -]?policy|safety/i.test(providerCode)) return imageProviderError("AI_IMAGE_CONTENT_POLICY_REJECTED", "The image provider rejected the request under its content policy.", { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, httpStatus: status, openaiErrorCode: providerCode || undefined, endpointClass: "OPENAI_IMAGE_API" }, error);
  return imageProviderError("AI_NETWORK_ERROR", "The image provider request failed safely.", { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, outputComplete: false, endpointClass: "OPENAI_IMAGE_API" }, error);
}

export class OpenAiFlareImageProvider {
  constructor(private readonly client: OpenAI) {}

  async generate(input: FlareImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    const request = assertFlareImageGenerationAllowed(input);
    const dimensions = requestedDimensions(request.size);
    let response: ImageResponse;
    try {
      response = await this.client.images.generate({
        model: FLARE_PRODUCTION_SNAPSHOT,
        prompt: request.prompt,
        size: request.size,
        background: request.background,
        output_format: request.outputFormat,
        ...(request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio }),
        ...(request.compression === undefined ? {} : { output_compression: request.compression }),
        quality: request.quality,
        n: 1,
      } as never, signal ? { signal } : undefined) as unknown as ImageResponse;
    } catch (error) {
      const mapped = providerError(error);
      throw mapped;
    }
    const requestId = safeRequestId(response.id);
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw imageError("AI_IMAGE_EMPTY_RESPONSE", "The image provider returned no image bytes.", undefined, true, requestId);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      if (!bytes.byteLength) throw new Error("empty image bytes");
    } catch (error) {
      throw imageError("AI_IMAGE_DECODE_FAILED", "The image provider response could not be decoded.", error, true, requestId);
    }
    let metadata: Metadata;
    try {
      const sharp = await loadSharp(requestId);
      metadata = await sharp(bytes).metadata();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw imageError("AI_IMAGE_MALFORMED_RESPONSE", "The image provider returned undecodable image bytes.", error, true, requestId);
    }
    const actualMimeType = mediaTypeForFormat(metadata.format ?? "");
    if (!actualMimeType) throw imageError("AI_IMAGE_MIME_MISMATCH", "The returned image format is not supported by the asset contract.", undefined, true, requestId);
    if (actualMimeType !== `image/${request.outputFormat}`) throw imageError("AI_IMAGE_MIME_MISMATCH", "The returned image MIME type does not match the requested output format.", undefined, true, requestId);
    if (!metadata.width || !metadata.height || dimensions.requestedWidth !== undefined && (metadata.width !== dimensions.requestedWidth || metadata.height !== dimensions.requestedHeight)) throw imageError("AI_IMAGE_DIMENSIONS_INVALID", "The returned image dimensions do not match the requested dimensions.", undefined, true, requestId);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (request.expectedSha256 && request.expectedSha256 !== sha256) throw imageError("AI_IMAGE_CHECKSUM_FAILED", "The returned image checksum did not match the expected checksum.", undefined, true, requestId);
    const usage = response.usage;
    const imageUsage: GeneratedImageUsage = { ...(usage?.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }), ...(usage?.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }), ...(usage?.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }), ...(usage?.cost === undefined ? { costStatus: "UNAVAILABLE" as const } : { cost: usage.cost, costStatus: "REPORTED" as const }) };
    const provenance: GeneratedImageProvenance = { provider: "openai", projectId: request.projectId, projectVersion: request.projectVersion, assetPurpose: request.assetPurpose, modelFamily: FLARE_MODEL_FAMILY, resolvedModel: FLARE_PRODUCTION_SNAPSHOT, requestId, promptVersion: request.promptVersion, requestedQuality: request.quality, resolvedQuality: request.quality, requestedMimeType: `image/${request.outputFormat}`, actualMimeType, ...dimensions, actualWidth: metadata.width, actualHeight: metadata.height, byteSize: bytes.byteLength, sha256, providerStatus: "completed", retryCount: 0, usage: imageUsage };
    return { bytes, mediaType: actualMimeType, width: metadata.width, height: metadata.height, sha256, provenance };
  }
}
