# Implementation Agent

Production provider calls use the bounded `implementation.v1` adapter and preserve this agent's existing context, proposal, validation, and apply boundaries.

The Implementation Agent executes exactly one authorized `ready` implementation task inside a reserved staging workspace. It validates the current `IMPLEMENTING` workflow, TaskGraph checksum, dependencies, approved document checksums, role, tools, skills, workspace reservation, and attempt limit before creating a bounded context.

This foundation supports deterministic execution for workspace preparation, project foundation, design system, shared layout/navigation/components, pages, approved content, SEO, and unit-test tasks. Unsupported backend and integration tasks fail safely. No command, npm, network, model, MCP, Git, Preview, or deployment capability is connected.

Functional QA is a separate `validate-functional-flow` task and uses only the controlled Playwright-functional boundary after runtime validation.

Full execution invokes this agent through its existing single-task contract and does not duplicate proposal, scope, skill, or atomic-apply logic.
# Implementation may receive only relevant, bounded Context7 excerpts when the task includes Context7-read. Existing scope and proposal validators remain authoritative.

Relevant implementation tasks may also receive normalized read-only shadcn Registry references when `shadcn-registry-read` is explicitly granted. The Registry cannot install, write, execute commands, or expand file scopes.

Backend handlers support plan-bound forms, Server Actions, Route Handlers, logical migrations, RLS, Auth, Storage, and email validation. They generate proposals only; customer migrations, npm, builds, tests, and network calls remain outside this stage.
# Runtime validation handoff

When implementation is complete, use the generated runtime validator for the fixed npm quality sequence. See `generated-runtime-validation.md`.
# Production TaskGraph adapter

FullTaskGraph implementation dispatch calls the existing `ImplementationAgentService`; the adapter constructs its validated input from canonical project documents and never calls the GPT provider directly.
# Codebase Memory

Implementation tasks can use `codebase-memory-read` for narrow structural lookup after a current version index is verified. The provider receives advisory normalized references only.
