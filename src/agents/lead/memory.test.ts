import { describe, expect, it, vi } from "vitest";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { LeadMemoryAdapter } from "./memory";

describe("Lead production memory adapter", () => {
  it("delegates decision projection to the scoped sync port", async () => {
    const sync = new FakeProjectMemorySyncPort();
    const projection = vi.spyOn(sync, "appendDecision");
    const adapter = new LeadMemoryAdapter(sync);
    await adapter.appendDecision("project", 1, {} as never);
    expect(projection).toHaveBeenCalledOnce();
  });
});
