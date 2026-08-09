# Persistence idempotency

Create/save operations accept explicit idempotency keys. The key is stored with the operation name and SHA-256 hash of the deterministically serialized validated payload. Retrying with the same key and payload returns the original result; reusing the key for a different payload returns `IDEMPOTENCY_CONFLICT`.

The foundation prepares idempotency for project creation, project-version creation, structured document saves (including requirements, design sets, selected designs, and quality/release documents), and the task/document boundary. Decisions remain append-only and are never made idempotent by silently deduplicating records.
