# Context7 security

Configuration is server-only; no `NEXT_PUBLIC_` Context7 values are accepted. Credentials, environment values, prompts, project files, and raw tool responses are never sent or logged. Documentation is treated as untrusted text: suspicious instruction-like content is rejected, scripts are removed, and normalized excerpts cannot grant tools, alter requirements, expand file scopes, approve architecture, or request secrets.

The adapter accepts a narrow injected transport rather than arbitrary URLs. Timeouts, cancellation, retries, concurrency, response shape, excerpt count, and byte limits are enforced. No customer source or Project Memory canonical document is written.
