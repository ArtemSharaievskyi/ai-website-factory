# Real E2E preflight

Before the opt-in run, execute `npm ci`, lint, typecheck, tests, build, migration validation/status/verification/integrity, compose configuration, and the repository diff check. The real smoke is blocked if any deterministic check fails.

Mandatory prerequisites are server-only OpenAI configuration, npm, the Playwright package and installed Chromium, and a clean repository. Missing configuration is reported by stable blocker code; secrets are never printed and are not requested in chat.

Composition validation also checks production adapter identity before external requests. Missing mandatory composition is a blocker, not permission to substitute a deterministic adapter.
