# AI provider

Production AI is an OpenAI-only, server-side provider configured by the exact `OPENAI_MODEL=gpt-5.6-luna` identifier (the display label is GPT-5.6 Luna). The website-generation roles below use the exact Luna Responses API reasoning object:

| Role/stage | Website generation | Model | Reasoning | Decision |
| --- | --- | --- | --- | --- |
| Lead, including Brief revision | Yes | `gpt-5.6-luna` | `xhigh` | Included |
| Planner, including staged/correction/recovery routes | Yes | `gpt-5.6-luna` | `xhigh` | Included |
| Design directions and corrections | Yes | `gpt-5.6-luna` | `xhigh` | Included |
| Orchestrator / TaskGraph planning | Yes | `gpt-5.6-luna` | `xhigh` | Included |
| Implementation and targeted repair | Yes | `gpt-5.6-luna` | `xhigh` | Included |
| Architecture, contract, code-integration, security, and test reviewers | No | Existing configured model | Provider default | Excluded from the customer-generation profile |
| Context7, Codebase Memory, deterministic validators, health checks, and synthetic tests | No | No Luna routing | N/A | Unchanged |

`xhigh` is a typed provider field, never prompt text and never the label `extra high`. An explicit incompatible model/effort combination is rejected before transport. The client uses the Responses API for these structured requests and keeps the existing Chat Completions boundary for unrelated routes.

Design directions use the explicit `OPENAI_DESIGN_MAX_COMPLETION_TOKENS` budget, defaulting to 64,000 and capped at 64,000 by the repository configuration. The general `OPENAI_MAX_COMPLETION_TOKENS` default remains 24,000 for other roles. An incomplete Responses result is still rejected; the larger Design ceiling only gives the strict three-direction contract enough bounded output capacity to complete.

Luna `xhigh` and Flare `xhigh` can increase provider latency and reported usage cost; the Factory records provider usage when available and records cost as unavailable when the provider omits it. This capability change does not add an unbounded retry budget or silently change operation-ledger limits.

Supporting website imagery uses the existing OpenAI abstraction and official Image API with family alias `gpt-image-2.5-flare` and pinned production snapshot `gpt-image-2.5-flare-2026-09-08`. Image quality defaults explicitly to `xhigh`; `max` requires an exceptional-asset request sourced from a Design direction or Asset Manifest. Background defaults to explicit `opaque`; `auto` is available only when selected in typed input. There is no older-model, other-provider, placeholder, or logo fallback. Returned bytes are decoded and checked for MIME, dimensions, size, checksum, and supported format before the existing project-asset storage pipeline accepts them.

User-supplied assets remain distinct from `AI_GENERATED` assets. Generation targets are restricted to non-logo supporting imagery; user-supplied logos cannot be generated, replaced, or edited at the provider boundary.

`src/integrations/openai/client.ts` owns explicit cancellation, bounded FIFO concurrency, idempotent in-flight requests, safe error mapping, strict structured output, and usage/event sinks. OpenAI generation requests have no Factory-imposed time limit. They run until the provider responds, an external transport/provider error occurs, or the operation is explicitly cancelled. This does not guarantee infinite availability. No provider proxy or browser credential exists.
# Production composition

The production Factory runtime creates one shared `OpenAiStructuredClient` and injects its validated role adapters into Lead, Planner, Design, and Implementation. Deterministic providers remain test-only.
