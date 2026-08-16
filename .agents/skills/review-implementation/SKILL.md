---
name: review-implementation
description: Perform an independent read-only review of a completed Factory implementation after verification; use from a fresh context or /review before commit handoff.
---

# Review implementation

1. Read the task, changed-file list, affected checks, verification report, architecture result, and protected-state comparison. Use codex:review-context for bounded structural context.
2. Inspect the diff and relevant contracts independently. Check behavior, traceability, persistence authority, provider boundaries, security implications, and test sufficiency without editing files or running arbitrary commands.
3. Separate actionable blockers from observations. A passing command is evidence, not a substitute for semantic review; a baseline failure is not a waiver for touched code.
4. Report findings with severity, file or symbol, evidence, and a concrete repair recommendation. State explicitly when no blocker is found.
5. If repair is needed, return the implementation to the author, then require a fresh codex:verify and another read-only review.
