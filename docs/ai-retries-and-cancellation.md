# Retries and cancellation

Only transient provider availability, rate-limit, and timeout failures are retried within the configured bound. Authentication, refusal, schema, cancellation, and policy errors are not retried. Abort signals stop queued and active work; failed or cancelled provider output is never canonicalized or persisted.
