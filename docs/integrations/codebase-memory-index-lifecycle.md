# Codebase Memory index lifecycle

Indexes are bound to project ID, version, workspace identity, source-manifest checksum, policy version, and adapter version. States are `NOT_INDEXED`, `INDEXING`, `READY`, `STALE`, and `FAILED`.

The manifest hashes relevant application source in deterministic path order. A changed manifest marks a ready index stale. Structural queries require a current ready index; refresh is explicit and serialized per project/version. Timeouts, cancellation, bounded concurrency, and safe lifecycle events prevent an orphaned or silently stale index from being used.

The adapter persists one strict, project/version/workspace-bound state record under the Factory-managed generated-project root (`.codebase-memory/<identity>/codebase-memory.json`). The record carries the current index metadata, bounded normalized query cache, and query-idempotency hashes. It is written through a same-directory temporary file, file-synced, atomically replaced, and followed by containing-directory sync where the platform supports directory handles; Windows uses the supported file-sync plus atomic-replacement guarantee because Node does not provide a reliable directory-handle sync boundary there. A malformed or mismatched record is rejected on reload. This is a durable Codebase Memory projection/cache, not canonical Project Memory workflow state.
