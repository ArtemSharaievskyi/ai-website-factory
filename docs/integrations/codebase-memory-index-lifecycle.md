# Codebase Memory index lifecycle

Indexes are bound to project ID, version, workspace identity, source-manifest checksum, policy version, and adapter version. States are `NOT_INDEXED`, `INDEXING`, `READY`, `STALE`, and `FAILED`.

The manifest hashes relevant application source in deterministic path order. A changed manifest marks a ready index stale. Structural queries require a current ready index; refresh is explicit and serialized per project/version. Timeouts, cancellation, bounded concurrency, and safe lifecycle events prevent an orphaned or silently stale index from being used.
