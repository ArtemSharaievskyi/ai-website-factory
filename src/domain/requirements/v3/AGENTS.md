# Brief Revision V3 domain laws

- Semantic IDs, never prose, are mutation authority.
- Every target has explicit exhaustive value and reducer semantics; no generic fallback exists.
- Provider, persistence, UI, and legacy revision implementations do not belong in this core.
- The reducer is pure, deterministic, local, and history-free.
- History is derived after reduction and never feeds current state.
- Normalization stabilizes structure but never resolves semantic conflicts.
- Adding a target requires target-map, reducer, invariant, serialization, migration, and certification updates.
