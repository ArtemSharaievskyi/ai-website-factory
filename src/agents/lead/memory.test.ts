import { describe, expect, it, vi } from "vitest";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { LeadMemoryAdapter } from "./memory";

describe("Lead production memory adapter", () => {
  it("does not persist a DecisionRecord a second time", async () => {
    const duplicatePersistence = { append: vi.fn(async () => undefined) };
    const adapter = new LeadMemoryAdapter(new FakeProjectMemorySyncPort(), duplicatePersistence);
    await adapter.appendDecision("project", 1, {} as never);
    expect(duplicatePersistence.append).not.toHaveBeenCalled();
  });
});
