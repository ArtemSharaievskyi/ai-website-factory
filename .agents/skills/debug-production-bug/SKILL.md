---
name: debug-production-bug
description: Trace and repair a reported production-path defect in the Factory without changing unrelated behavior; use for workflow, Brief, persistence, provider, or route bugs.
---

# Debug production bug

1. Start or safely reset codex:start with the protected project before editing. Read the relevant production trace, domain contract, persistence boundary, and existing regression tests.
2. Reconcile the envelope agent policy before parallel work. Bounded read-only audit lanes may inspect independent scopes, but the Lead is the single integration authority and parallel canonical writes are forbidden.
3. Reproduce the defect with a deterministic test at the real application path. Keep customer data, prompts, answers, asset paths, and credentials out of logs and fixtures.
4. Make the smallest typed change that fixes the cause. Do not treat a provider error or an environment failure as proof of a product fix.
5. Run codex:affected, codex:verify, and the focused production-path tests. Classify unchanged registered failures as BASELINE_FAILURE; new, changed, or touched failures remain blocking.
6. Hand off only after the independent read-only implementation review and any repair cycle are complete.
