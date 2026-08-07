import type { FactoryRuntimeMode } from "./production-factory-runtime";
export type DeterministicFactoryRuntime = { mode: "DETERMINISTIC_TEST"; identity: { mode: "deterministic"; leadProviderMode: "deterministic"; plannerProviderMode: "deterministic"; designProviderMode: "deterministic"; implementationProviderMode: "deterministic"; processRunnerMode: "fake"; browserRunnerMode: "fake"; fullExecutorMode: "deterministic" } };
export function createDeterministicFactoryRuntime(): DeterministicFactoryRuntime { return { mode: "DETERMINISTIC_TEST", identity: { mode: "deterministic", leadProviderMode: "deterministic", plannerProviderMode: "deterministic", designProviderMode: "deterministic", implementationProviderMode: "deterministic", processRunnerMode: "fake", browserRunnerMode: "fake", fullExecutorMode: "deterministic" } }; }
export function assertRuntimeMode(mode: FactoryRuntimeMode, expected: FactoryRuntimeMode) { if (mode !== expected) throw new Error("FACTORY_RUNTIME_MODE_MISMATCH"); }

