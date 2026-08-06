# Version lifecycle

1. A Factory project exists in Supabase and receives a filesystem project root.
2. Supabase reserves the next version using a transaction and idempotency key.
3. The Workspace Manager creates `.staging/vN-operation`, initializes `.factory`, and verifies its manifest.
4. The staging directory is atomically promoted to `vN` under the same project root.
5. Root `project.json`, the version record, and Project Memory remain available for reconciliation.
6. A released version is marked immutable in Supabase, `.factory/project.json`, and root version metadata.
7. A revision copies an immutable version into a new reserved version and records its origin.

Ambiguous states are reported rather than silently repaired: missing directories, missing database versions, stale root metadata, interrupted staging, and checksum mismatches require controlled reconciliation.
