import { describe, expect, it, vi } from "vitest";

const request = {
  projectId: "11111111-1111-4111-8111-111111111111",
  projectVersion: 1,
  target: { category: "IMAGE" as const, operation: "GENERATE" as const, isLogo: false },
  prompt: "A synthetic supporting image.",
  promptVersion: "image-art-direction.v1",
  assetPurpose: "synthetic test image",
  size: "64x32",
  background: "opaque" as const,
  outputFormat: "png" as const,
};

describe("Sharp production runtime boundary", () => {
  it("maps a missing image runtime to a typed bounded error", async () => {
    vi.resetModules();
    vi.doMock("node:module", () => ({
      createRequire: () => () => {
        throw Object.assign(new Error("synthetic missing image runtime"), { code: "MODULE_NOT_FOUND" });
      },
    }));

    try {
      const { OpenAiFlareImageProvider } = await import("./images");
      const provider = new OpenAiFlareImageProvider({
        images: { generate: vi.fn(async () => ({ id: "synthetic-runtime-missing", data: [{ b64_json: Buffer.from("synthetic-image-bytes").toString("base64") }] })) },
      } as never);
      await expect(provider.generate(request)).rejects.toMatchObject({
        code: "AI_IMAGE_RUNTIME_UNAVAILABLE",
        diagnostic: { stage: "api_response", requestAttempted: true, issueCode: "AI_IMAGE_RUNTIME_UNAVAILABLE" },
      });
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
    }
  });
});
