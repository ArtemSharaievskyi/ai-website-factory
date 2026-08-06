# Security model

OpenAI credentials remain server-only, provider telemetry is redacted metadata, and prompts are limited to role-specific bounded context.

The local single-user process is the primary trust boundary. External AI providers, MCP servers, imported skills, registries, dependencies, generated code, and GitHub are separate trust boundaries. Secrets are never sent unnecessarily, and generated code must never receive or access Factory secrets.

Future orchestration requires reviewed skills and scripts, approved MCP installations, command allowlists, process timeouts, output-size limits, dependency review, secret scanning, and path-traversal protection. Server Actions and Route Handlers must validate input. Supabase projects require least-privilege access and RLS policies. Arbitrary registry URLs and arbitrary agent-installed MCPs are prohibited.

The local Approved Skills Registry adds an isolated staging boundary, strict file/path/size limits, deterministic static review, manual checksum-bound approval, immutable approved copies, bounded task-scoped loading, and append-only audit records. Imported scripts are never executed by the registry.

Factory Docker runs without privileged mode, Docker socket mounts, or host filesystem access outside the repository. It must not execute customer projects in containers. Local writes will later use validated Windows paths, staging, and atomic promotion.
