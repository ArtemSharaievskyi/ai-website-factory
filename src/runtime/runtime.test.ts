import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDeterministicFactoryRuntime, assertRuntimeMode } from "./deterministic-factory-runtime";
import { createProductionFactoryIdentity } from "./production-factory-runtime";

describe("Factory composition modes", () => {
  it("keeps deterministic tests on explicit fake adapters", () => {
    const runtime = createDeterministicFactoryRuntime();
    expect(runtime.mode).toBe("DETERMINISTIC_TEST");
    expect(runtime.identity.processRunnerMode).toBe("fake");
    expect(runtime.identity.browserRunnerMode).toBe("fake");
    expect(() => assertRuntimeMode(runtime.mode, "REAL_E2E")).toThrow("FACTORY_RUNTIME_MODE_MISMATCH");
  });
  it("describes a production composition without constructing external clients", () => {
    const identity = createProductionFactoryIdentity({ context7: "not-needed", shadcn: "not-needed" });
    expect(identity).toMatchObject({ mode: "production", leadProviderMode: "production", plannerProviderMode: "production", designProviderMode: "production", implementationProviderMode: "production", processRunnerMode: "real", browserRunnerMode: "real", executionStateMode: "production", taskExecutorMode: "production", repairerMode: "production", fullExecutorMode: "production" });
  });
  it("does not treat optional documentation integrations as mandatory", () => {
    expect(createProductionFactoryIdentity().context7).toBe("not-needed");
    expect(createProductionFactoryIdentity().shadcn).toBe("not-needed");
    expect(createProductionFactoryIdentity().codebaseMemory).toBe("not-needed");
  });
});
