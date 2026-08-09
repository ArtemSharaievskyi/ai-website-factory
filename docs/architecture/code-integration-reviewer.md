# Code / Integration Reviewer

The Code / Integration Reviewer is a read-only semantic reviewer for bounded implementation output. It runs only after structural validation, lint, and typecheck pass, comparing bounded source slices with the approved Brief, PlanningPackage, selected Design, TaskGraph, Contract Audit, and implementation ownership.

It does not compile, lint, test, execute, patch, or redesign the project. Deterministic validation owns missing files, invalid imports, TypeScript errors, lint failures, source checksum mismatches, and invalid scopes. This reviewer handles semantic defects such as a form invoking the wrong server operation, a UI/backend result mismatch, an incomplete route flow, an unplanned dependency, or an implementation that fulfills a filename but not its approved responsibility.

Inputs are strict and bounded: canonical checksums, implementation task summaries, a source manifest, bounded source slices, and static-validation evidence. Absolute paths, secrets, `.env`, full source dumps, and arbitrary repository access are excluded. Codebase Memory is not enabled by default.

Results reuse `ReviewResult` and `ReviewFinding`. Findings carry compact integration categories, relative source evidence, implementation ownership when known, and correction targets. The reviewer never creates a ChangeProposal or invokes Implementation. Results are immutable historical records bound to upstream checksums, TaskGraph checksum, source checksum, agent/prompt/policy versions, verdict, findings, and result checksum.

`CODE_INTEGRATION_REVIEW` is the workflow gate after implementation/static readiness and before Security Review and downstream validation progression. This reviewer is distinct from Architecture Reviewer (architecture quality), Contract Auditor (pre-implementation cross-artifact integrity), and Security Reviewer (contextual security properties). Test/Quality Reviewer remains a future capability. `allowedSkillIds` is currently empty.
