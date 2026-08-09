# Registry caching

The bounded cache keys registry, component, registry reference, normalization policy, and security policy. TTL and item count are bounded. Stale entries refetch. Idempotency keys are checked against canonical plans; a changed query returns `IDEMPOTENCY_CONFLICT`. Failed or unsafe results are not stored as approved references.
