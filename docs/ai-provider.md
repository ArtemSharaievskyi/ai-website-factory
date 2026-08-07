# AI provider

Production AI is an OpenAI-only, server-side provider configured by `OPENAI_MODEL` (the intended display label is GPT-5.6 Luna). Lead, planner, design, implementation, and optional orchestration integrations use existing narrow ports. Deterministic implementations remain the default when services are constructed without an injected provider.

`src/ai-provider/client.ts` owns timeout, cancellation, bounded FIFO concurrency, idempotent in-flight requests, safe error mapping, strict structured output, and usage/event sinks. No provider proxy or browser credential exists.
# Production composition

The production Factory runtime creates one shared `OpenAiStructuredClient` and injects its validated role adapters into Lead, Planner, Design, and Implementation. Deterministic providers remain test-only.
