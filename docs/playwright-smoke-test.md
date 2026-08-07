# Playwright Smoke Test

The real local smoke is explicitly opt-in:

`ALLOW_PLAYWRIGHT_SMOKE=true npm run playwright:smoke`

It uses a temporary local fixture, synthetic form data, no credentials, no external network, and safe metadata output. Without opt-in it reports `REAL_PLAYWRIGHT_SMOKE_PENDING`. Normal Factory tests use the deterministic fake browser and require no browser or network.
