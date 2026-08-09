# Architecture Reviewer

The Architecture Reviewer is the first semantic quality gate. It reviews an approved Brief and accepted PlanningPackage before Design, without generating architecture or changing either artifact.

## Workflow position

`Planning Acceptance -> ARCHITECTURE_REVIEW -> Design`

The reviewer returns a typed `ReviewResult`. Orchestration interprets the result: `APPROVED` unlocks Design, `CHANGES_REQUIRED` returns structured findings to Planner for at most two correction cycles, and `BLOCKED` stops the flow until canonical evidence is repaired. A corrected PlanningPackage must pass Planning Acceptance and receive a new review; earlier results remain stale historical evidence.

## Inputs and outputs

`ArchitectureReviewInput` contains the project/version, approved Brief and checksum, accepted PlanningPackage and checksum, fixed Factory architecture policy, bounded project constraints, and an idempotency key. It excludes secrets, arbitrary source, implementation workspaces, and unrestricted Project Memory.

The output is the existing `ReviewResult` contract with architecture-specific finding categories. `ERROR` and `CRITICAL` findings cannot produce `APPROVED`; `INFO` and `WARNING` findings may. Every finding has concrete canonical evidence references, and invented references are rejected.

## Review responsibilities

Deterministic prechecks verify approval, checksums, acceptance, identifier/reference structure, blockers, and fixed-stack policy before any provider call. AI reasoning is limited to semantic architecture: requirement traceability, source of truth, domain identity, data/auth/storage/API boundaries, server/client boundaries, dependencies, security-relevant architecture, implementability, minimal sufficiency, and contradictory decisions.

The reviewer must not invent requirements, judge visual design, demand optional infrastructure, redesign by preference, or modify project state. Its catalog definition is `architecture-reviewer`, capability `review.architecture`, role `review`, OpenAI generation only, no skills, and `readOnly: true`. Prompt ownership remains `src/integrations/openai/prompts.ts`, version `architecture-reviewer.v1`; future professional skills are intentionally deferred.
