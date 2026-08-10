import { describe, expect, it, vi } from "vitest";
import { withRuntimeLifecycle } from "./lifecycle";

describe("production E2E runtime lifecycle", () => {
  it("closes the owned runtime after a successful stage run", async () => {
    const close = vi.fn(async () => undefined);

    await expect(withRuntimeLifecycle({ close }, async () => "passed")).resolves.toBe("passed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the owned runtime when a post-creation stage fails", async () => {
    const close = vi.fn(async () => undefined);
    const failure = new Error("E2E_STAGE_FAILED");

    await expect(withRuntimeLifecycle({ close }, async () => { throw failure; })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });
});
