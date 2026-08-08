# Retries and cancellation

Only transient provider availability and rate-limit failures are retried within the configured bound. OpenAI generation has no Factory-owned elapsed-time timeout; transport/provider failures remain subject to the provider and network behavior. Authentication, refusal, schema, cancellation, and policy errors are not retried. Abort signals stop queued and active work; failed or cancelled provider output is never canonicalized or persisted.
