# Implementation task execution

Execution transitions one READY task to RUNNING, increments its attempt, assembles context, obtains a deterministic proposal, validates and atomically applies it, runs task-specific deterministic checks, persists a safe execution run, transitions the task to PASSED or FAILED/CANCELLED, and marks only fully unblocked dependents READY. Dependents are never executed automatically.

Execution history contains bounded checksums, changed-file lists, validation summaries, safe failure codes, timestamps, and provider usage metadata. It does not contain prompts, source dumps, secrets, stack traces, or chain-of-thought.

Backend tasks use the same one-READY-task execution path. Static backend validation runs before a proposal can pass; dependents are not automatically executed.
