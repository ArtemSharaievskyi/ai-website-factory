# AI smoke test

Run `npm run ai:smoke` manually only after setting `OPENAI_API_KEY`, a provider-supported `OPENAI_MODEL`, and `ALLOW_REAL_AI_SMOKE=true`. It sends one synthetic structured request, emits safe metadata, performs no workspace mutation, and is never run automatically. Without opt-in it reports `REAL_AI_SMOKE_PENDING`.

The full real Factory chain has a separate opt-in: `npm run factory:e2e-smoke`.
