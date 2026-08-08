# AI provider security

`OPENAI_API_KEY` is server-only and must never use a `NEXT_PUBLIC_` name. Prompts are bounded role context, never full repositories, secrets, or hidden reasoning. Safe events contain provider/model/role/prompt-version/request-id/status and timing metadata only; raw prompts, responses, credentials, and chain of thought are excluded. OpenAI generation has no Factory-imposed time limit, while explicit cancellation remains mandatory for user, run, and shutdown cancellation paths.
