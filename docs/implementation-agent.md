# Implementation Agent

The Implementation Agent executes exactly one authorized `ready` implementation task inside a reserved staging workspace. It validates the current `IMPLEMENTING` workflow, TaskGraph checksum, dependencies, approved document checksums, role, tools, skills, workspace reservation, and attempt limit before creating a bounded context.

This foundation supports deterministic execution for workspace preparation, project foundation, design system, shared layout/navigation/components, pages, approved content, SEO, and unit-test tasks. Unsupported backend and integration tasks fail safely. No command, npm, network, model, MCP, Git, Preview, or deployment capability is connected.
