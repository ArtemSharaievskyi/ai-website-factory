import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { FLARE_DEFAULT_IMAGE_QUALITY, FLARE_MODEL_FAMILY, FLARE_PRODUCTION_SNAPSHOT } from "./image-config";
import { assertFlareImageGenerationAllowed, OpenAiFlareImageProvider } from "./images";

const projectId = randomUUID();
const request = (overrides: Record<string, unknown> = {}) => ({
  projectId,
  projectVersion: 1,
  target: { category: "IMAGE" as const, operation: "GENERATE" as const, isLogo: false },
  prompt: "A distinctive supporting image for the approved website.",
  promptVersion: "image-art-direction.v1",
  assetPurpose: "hero supporting image",
  size: "64x32",
  background: "opaque" as const,
  outputFormat: "png" as const,
  ...overrides,
});

async function pngBytes(width = 64, height = 32) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 240, g: 120, b: 20 } } }).png().toBuffer());
}

function provider(bytes: Uint8Array, usage?: Record<string, unknown>) {
  const generate = vi.fn(async () => ({ id: "img_req_fixture", data: [{ b64_json: Buffer.from(bytes).toString("base64") }], usage }));
  return { provider: new OpenAiFlareImageProvider({ images: { generate } } as never), generate };
}

describe("GPT-Image-2.5 Flare provider boundary", () => {
  it("resolves the pinned snapshot and explicit xhigh default without a fallback", async () => {
    const fixture = provider(await pngBytes(), { input_tokens: 11, output_tokens: 29, total_tokens: 40, cost: 0.42 });
    const result = await fixture.provider.generate(request());
    expect(fixture.generate).toHaveBeenCalledWith(expect.objectContaining({ model: FLARE_PRODUCTION_SNAPSHOT, quality: FLARE_DEFAULT_IMAGE_QUALITY, output_format: "png", n: 1 }), undefined);
    expect(result.provenance).toMatchObject({ provider: "openai", projectId, projectVersion: 1, assetPurpose: "hero supporting image", modelFamily: FLARE_MODEL_FAMILY, resolvedModel: FLARE_PRODUCTION_SNAPSHOT, requestedQuality: "xhigh", resolvedQuality: "xhigh", actualMimeType: "image/png", actualWidth: 64, actualHeight: 32, retryCount: 0, usage: { inputTokens: 11, outputTokens: 29, totalTokens: 40, cost: 0.42, costStatus: "REPORTED" } });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows max only for an explicitly exceptional asset", async () => {
    const fixture = provider(await pngBytes());
    await expect(fixture.provider.generate(request({ quality: "max" }))).rejects.toMatchObject({ code: "AI_IMAGE_CONFIGURATION_INVALID" });
    expect(fixture.generate).not.toHaveBeenCalled();
    await fixture.provider.generate(request({ quality: "max", exceptionalQualityRequested: true, exceptionalQualitySource: "DESIGN_DIRECTION" }));
    expect(fixture.generate).toHaveBeenCalledWith(expect.objectContaining({ quality: "max" }), undefined);
  });

  it("rejects invalid quality, size, and transparent-format combinations before dispatch", async () => {
    const fixture = provider(await pngBytes());
    await expect(fixture.provider.generate(request({ quality: "high" }))).rejects.toMatchObject({ code: "AI_IMAGE_CONFIGURATION_INVALID" });
    await expect(fixture.provider.generate(request({ size: "64x" }))).rejects.toMatchObject({ code: "AI_IMAGE_CONFIGURATION_INVALID" });
    await expect(fixture.provider.generate(request({ background: "transparent", outputFormat: "jpeg" }))).rejects.toMatchObject({ code: "AI_IMAGE_CONFIGURATION_INVALID" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("passes an explicitly selected aspect ratio to the Image API", async () => {
    const fixture = provider(await pngBytes());
    await fixture.provider.generate(request({ aspectRatio: "16:9" }));
    expect(fixture.generate).toHaveBeenCalledWith(expect.objectContaining({ aspect_ratio: "16:9" }), undefined);
  });

  it.each([
    { target: { category: "IMAGE", operation: "GENERATE", isLogo: true } },
    { target: { category: "LOGO", operation: "REPLACE", isLogo: true, source: "USER_SUPPLIED", assetId: randomUUID() } },
    { target: { category: "LOGO", operation: "EDIT", isLogo: true, source: "USER_SUPPLIED", assetId: randomUUID() } },
  ])("rejects supplied-logo generation policy before provider dispatch: %o", async ({ target }) => {
    const fixture = provider(await pngBytes());
    await expect(fixture.provider.generate(request({ target }))).rejects.toMatchObject({ code: "AI_IMAGE_PROTECTED_ASSET" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("allows non-logo supporting imagery even when the host target is user supplied", async () => {
    const fixture = provider(await pngBytes());
    await fixture.provider.generate(request({ target: { category: "IMAGE", operation: "REPLACE", isLogo: false, source: "USER_SUPPLIED", assetId: randomUUID() } }));
    expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it("requires host-owned metadata for replacement and edit targets before dispatch", async () => {
    const fixture = provider(await pngBytes());
    await expect(fixture.provider.generate(request({ target: { category: "IMAGE", operation: "REPLACE", isLogo: false, assetId: randomUUID() } }))).rejects.toMatchObject({ code: "AI_IMAGE_CONFIGURATION_INVALID" });
    expect(fixture.generate).not.toHaveBeenCalled();
  });

  it("validates response MIME, dimensions, decoding, and empty output", async () => {
    const wrongMime = provider(await pngBytes());
    await expect(wrongMime.provider.generate(request({ outputFormat: "webp" }))).rejects.toMatchObject({ code: "AI_IMAGE_MIME_MISMATCH" });
    const wrongDimensions = provider(await pngBytes(32, 32));
    await expect(wrongDimensions.provider.generate(request())).rejects.toMatchObject({ code: "AI_IMAGE_DIMENSIONS_INVALID" });
    const empty = new OpenAiFlareImageProvider({ images: { generate: vi.fn(async () => ({ id: "img_empty", data: [] })) } } as never);
    await expect(empty.generate(request())).rejects.toMatchObject({ code: "AI_IMAGE_EMPTY_RESPONSE" });
    const malformed = new OpenAiFlareImageProvider({ images: { generate: vi.fn(async () => ({ id: "img_malformed", data: [{ b64_json: Buffer.from("not-an-image").toString("base64") }] })) } } as never);
    await expect(malformed.generate(request())).rejects.toMatchObject({ code: "AI_IMAGE_MALFORMED_RESPONSE" });
    const checksum = provider(await pngBytes());
    await expect(checksum.provider.generate(request({ expectedSha256: "0".repeat(64) }))).rejects.toMatchObject({ code: "AI_IMAGE_CHECKSUM_FAILED" });
  });

  it("preserves provider timeout, rate limit, and content-policy taxonomy", async () => {
    const timeout = new OpenAiFlareImageProvider({ images: { generate: vi.fn(async () => { throw Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" }); }) } } as never);
    await expect(timeout.generate(request())).rejects.toMatchObject({ code: "AI_REQUEST_TIMEOUT", failureDiagnostic: { category: "TIMEOUT", stage: "REQUEST_TRANSPORT" } });
    const rate = new OpenAiFlareImageProvider({ images: { generate: vi.fn(async () => { throw Object.assign(new Error("rate"), { status: 429 }); }) } } as never);
    await expect(rate.generate(request())).rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
    const policy = new OpenAiFlareImageProvider({ images: { generate: vi.fn(async () => { throw Object.assign(new Error("policy"), { status: 400, error: { code: "content_policy_violation" } }); }) } } as never);
    await expect(policy.generate(request())).rejects.toMatchObject({ code: "AI_IMAGE_CONTENT_POLICY_REJECTED" });
  });

  it("keeps configuration validation pure and never includes customer-specific contact data", () => {
    expect(assertFlareImageGenerationAllowed(request()).quality).toBe("xhigh");
    expect(assertFlareImageGenerationAllowed(request({ background: undefined })).background).toBe("opaque");
    expect(assertFlareImageGenerationAllowed(request({ quality: "max", exceptionalQualityRequested: true, exceptionalQualitySource: "ASSET_MANIFEST" })).quality).toBe("max");
    expect(JSON.stringify(assertFlareImageGenerationAllowed(request()))).not.toContain("@gmail.com");
  });
});
