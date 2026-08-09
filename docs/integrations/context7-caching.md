# Context7 caching

The bounded local cache keys library ID, package, version, topic, symbol, and normalization version. TTL and item count are bounded, stale entries miss, and only normalized excerpts are stored. Idempotency keys are checked against a canonical query checksum; reuse with a different query returns `IDEMPOTENCY_CONFLICT`. Unsafe or failed results are never cached as successful results.
