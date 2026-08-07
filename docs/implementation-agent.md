# Implementation Agent

Production provider calls use the bounded `implementation.v1` adapter and preserve this agent's existing context, proposal, validation, and apply boundaries.

The Implementation Agent executes exactly one authorized `ready` implementation task inside a reserved staging workspace. It validates the current `IMPLEMENTING` workflow, TaskGraph checksum, dependencies, approved document checksums, role, tools, skills, workspace reservation, and attempt limit before creating a bounded context.

This foundation supports deterministic execution for workspace preparation, project foundation, design system, shared layout/navigation/components, pages, approved content, SEO, and unit-test tasks. Unsupported backend and integration tasks fail safely. No command, npm, network, model, MCP, Git, Preview, or deployment capability is connected.
# Implementation may receive only relevant, bounded Context7 excerpts when the task includes Context7-read. Existing scope and proposal validators remain authoritative.

Relevant implementation tasks may also receive normalized read-only shadcn Registry references when `shadcn-registry-read` is explicitly granted. The Registry cannot install, write, execute commands, or expand file scopes.
