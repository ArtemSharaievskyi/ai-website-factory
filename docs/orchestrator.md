# Orchestrator

The Orchestrator begins only after an approved Brief, accepted planning package, explicit design selection, current checksums, and `READY_FOR_IMPLEMENTATION`. It creates and validates a controlled dependency graph. It does not generate customer source, call a model, execute tasks, install packages, import skills, use MCP, initialize Git, preview, or deploy.

Graph creation is deterministic and conditional. Marketing sites receive foundation, selected design, layout, navigation, page, content/asset, test, validation, and release-readiness tasks. Approved forms add form/backend work; persisted data adds database and RLS tasks; authentication, runtime uploads, email, SEO, and selected motion are added only when present in approved inputs.

The five roles remain `lead`, `planner-architect`, `design`, `implementation`, and `qa-release`. Production work is assigned to implementation and quality work to qa-release. No fictional specialist agents are created.

`startImplementation` is a separate explicit operation. It verifies graph readiness and the workspace, persists `.factory/task-graph.json`, records a DecisionRecord, transitions `READY_FOR_IMPLEMENTATION` to `IMPLEMENTING`, and marks only dependency-free tasks ready. It never runs a task.
