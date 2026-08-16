import { LEGACY_V2_MUTATION_PATHS } from "./source-fingerprint";

export type V2MutationSeam = "provider" | "merge" | "revisionPersistence" | "idempotency";
export type V2TripwireSnapshot = {
  providerMutationCalls: number;
  mergeCalls: number;
  revisionPersistenceCalls: number;
  idempotencyMutationCalls: number;
  loadedLegacyMutationModules: string[];
};

type MutableTripwireState = {
  counts: Record<V2MutationSeam, number>;
  loaded: Set<string>;
};

const registryKey = Symbol.for("ai-website-factory.brief-revision-v3.v2-tripwire");
type GlobalRegistry = typeof globalThis & { [registryKey]?: MutableTripwireState };

function state(): MutableTripwireState {
  const registry = globalThis as GlobalRegistry;
  if (!registry[registryKey]) registry[registryKey] = { counts: { provider: 0, merge: 0, revisionPersistence: 0, idempotency: 0 }, loaded: new Set<string>() };
  return registry[registryKey]!;
}

export function resetV2Tripwires() {
  const current = state();
  current.counts.provider = 0;
  current.counts.merge = 0;
  current.counts.revisionPersistence = 0;
  current.counts.idempotency = 0;
  current.loaded.clear();
}

export function recordV2Mutation(seam: V2MutationSeam) {
  state().counts[seam] += 1;
}

export function recordV2MutationModuleLoaded(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (LEGACY_V2_MUTATION_PATHS.includes(normalized as typeof LEGACY_V2_MUTATION_PATHS[number])) state().loaded.add(normalized);
}

export function readV2TripwireSnapshot(): V2TripwireSnapshot {
  const current = state();
  return {
    providerMutationCalls: current.counts.provider,
    mergeCalls: current.counts.merge,
    revisionPersistenceCalls: current.counts.revisionPersistence,
    idempotencyMutationCalls: current.counts.idempotency,
    loadedLegacyMutationModules: [...current.loaded].sort(),
  };
}

export function assertV2Tripwires(snapshot: V2TripwireSnapshot) {
  if (snapshot.providerMutationCalls !== 0 || snapshot.mergeCalls !== 0 || snapshot.revisionPersistenceCalls !== 0 || snapshot.idempotencyMutationCalls !== 0 || snapshot.loadedLegacyMutationModules.length > 0) throw new Error("V2_MUTATION_PATH_INVOKED");
  return true;
}
