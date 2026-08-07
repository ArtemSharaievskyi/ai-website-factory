# Codebase Memory smoke test

`npm run codebase-memory:smoke` is an opt-in real-process smoke test. Without `ALLOW_REAL_CODEBASE_MEMORY_SMOKE=true`, it prints `REAL_CODEBASE_MEMORY_SMOKE_PENDING` and does not fake success. With opt-in it creates a temporary TypeScript fixture, indexes it with the explicitly configured executable, looks up a known symbol, validates normalized output, and removes the temporary fixture.

The real smoke is not run by the standard test, build, or Factory E2E commands.
