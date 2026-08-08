import { describe, expect, it } from "vitest";
import { PRODUCTION_EXECUTION_CAPABILITIES, taskExecutionCapability, validateExecutionCapabilities } from "./capabilities";

describe("canonical validation execution capabilities", () => {
  it("registers lint", () => expect(taskExecutionCapability("validate-lint")).toBe("runtime-lint"));
  it("registers typecheck", () => expect(taskExecutionCapability("validate-typecheck")).toBe("runtime-typecheck"));
  it("registers unit tests", () => expect(taskExecutionCapability("validate-unit-tests")).toBe("runtime-tests"));
  it("registers build", () => expect(taskExecutionCapability("validate-build")).toBe("runtime-build"));
  it("registers functional QA separately", () => expect(taskExecutionCapability("validate-functional-flow")).toBe("functional-qa"));
  it("registers security as its own bounded capability", () => expect(taskExecutionCapability("validate-security")).toBe("static-security"));
  it("does not classify unknown validation tasks", () => expect(taskExecutionCapability("validate-performance")).toBeUndefined());
  it("keeps implementation ownership separate", () => expect(taskExecutionCapability("implement-page")).toBe("implementation"));
  it("keeps unit-test authoring separate from unit-test validation", () => expect(taskExecutionCapability("write-unit-tests")).toBe("implementation"));
  it("does not route arbitrary tasks to runtime validation", () => expect(taskExecutionCapability("prepare-release")).toBeUndefined());
  it("includes the unit-test capability in production registration", () => expect(PRODUCTION_EXECUTION_CAPABILITIES).toContain("runtime-tests"));
  it("accepts the generated runtime validation set", () => expect(validateExecutionCapabilities(["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build"])).toEqual([]));
  it("accepts functional QA when registered", () => expect(validateExecutionCapabilities(["validate-functional-flow"])).toEqual([]));
  it("rejects an unregistered runtime executor", () => expect(validateExecutionCapabilities(["validate-unit-tests"], ["runtime-lint"])).toEqual(["validate-unit-tests:runtime-tests"]));
  it("rejects an unknown validation capability", () => expect(validateExecutionCapabilities(["validate-performance"])).toEqual(["validate-performance:unknown"]));
  it("reports every missing capability once", () => expect(validateExecutionCapabilities(["validate-performance", "validate-performance", "validate-unit-tests"], [])).toEqual(["validate-performance:unknown", "validate-unit-tests:runtime-tests"]));
  it("keeps future capability registration bounded", () => expect(validateExecutionCapabilities(["validate-accessibility"], ["functional-qa"])).toEqual(["validate-accessibility:unknown"]));
  it("does not require a concrete future agent name", () => expect(PRODUCTION_EXECUTION_CAPABILITIES.every((capability) => capability.includes("-") || capability === "implementation")).toBe(true));
});
