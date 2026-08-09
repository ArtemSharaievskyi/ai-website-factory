import { RuntimeValidationError } from "./errors";
import type { RuntimeCommandType } from "./contracts";

const taskCommands: Record<string, RuntimeCommandType> = {
  "validate-npm-ci": "npm-ci",
  "validate-lint": "lint",
  "validate-typecheck": "typecheck",
  "validate-unit-tests": "tests",
  "validate-build": "build",
};

export function commandForValidationTask(taskType: string): RuntimeCommandType {
  const command = taskCommands[taskType];
  if (!command) throw new RuntimeValidationError("RUNTIME_COMMAND_NOT_ALLOWED", "The task is not an allowlisted runtime validation task.");
  return command;
}

export function repairCategoryForCommand(command: RuntimeCommandType): string {
  return {
    "npm-lockfile": "FOUNDATION_DEPENDENCY_REPAIR",
    "npm-ci": "FOUNDATION_DEPENDENCY_REPAIR",
    lint: "TARGETED_SOURCE_STYLE_REPAIR",
    typecheck: "TARGETED_TYPESCRIPT_API_REPAIR",
    tests: "IMPLEMENTATION_TEST_REPAIR",
    build: "INTEGRATION_RUNTIME_BUILD_REPAIR",
  }[command];
}
