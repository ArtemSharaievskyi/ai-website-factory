---
name: finish-task
description: Finish a Factory task only after bounded validation, protected-state checks, independent review, and exact Git handoff; use when preparing a commit or completion report.
---

# Finish task

1. Confirm the scope and current protected snapshot. Do not repair unrelated baseline defects or alter production data to make a gate pass.
2. Run codex:affected, focused tests, check:architecture, provider-contract checks when relevant, typecheck, lint, codex:verify, and git diff --check.
3. Obtain the independent read-only implementation review from a fresh context or /review; repair findings and repeat verification and review as needed.
4. Inspect the final diff and status. Stage only intended files with explicit paths, preserve pre-existing docs/admin/**, and commit one logical change.
5. Report the commit, gates, review result, baseline failures, protected-state result, and any remaining non-blocking debt. Never claim completion while codex:verify or review has an unaddressed blocker.
