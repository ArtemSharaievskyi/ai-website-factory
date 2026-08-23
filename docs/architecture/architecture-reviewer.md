# Architecture Reviewer

The Architecture Reviewer is the first semantic quality gate. It reviews an approved Brief and accepted PlanningPackage before Design, without generating architecture or changing either artifact.

## Workflow position

`Planning Acceptance -> ARCHITECTURE_REVIEW -> Design`

The reviewer returns a typed `ReviewResult`; it does not persist project state. The host-owned `ArchitectureReviewOrchestrationService` commits the result, history, architecture-review decision, and routing consequence in one transaction after rechecking currentness. `APPROVED` unlocks Design, `CHANGES_REQUIRED` returns structured findings to Planner for at most two correction cycles, and `BLOCKED` stops the flow until canonical evidence is repaired. A corrected PlanningPackage must pass Planning Acceptance and receive a new review; earlier results remain stale historical evidence.

## Inputs and outputs

`ArchitectureReviewInput` contains the project/version, approved Brief and checksum, accepted PlanningPackage and checksum, fixed Factory architecture policy, bounded project constraints, and an idempotency key. The canonical evidence contract exposes every material approved Brief obligation (including content, SEO, localization, roles, acceptance criteria, exclusions, infrastructure decisions, and unresolved-item decisions) plus the accepted PlanningPackage's identity, acceptance, and architecture references. It excludes secrets, arbitrary source, implementation workspaces, and unrestricted Project Memory.

The output is the existing `ReviewResult` contract with architecture-specific finding categories. `ERROR` and `CRITICAL` findings cannot produce `APPROVED`; `INFO` and `WARNING` findings may. Every finding has concrete canonical evidence references, and invented references are rejected.

## Review responsibilities

Deterministic prechecks verify approval, checksums, acceptance, identifier/reference structure, blockers, and fixed-stack policy before any provider call. The commit boundary re-reads the current project/version, workflow row version, approved Brief, accepted PlanningPackage, Architecture, and Phase 7C checksums after provider completion and binds those exact artifacts into the host-owned review record. AI reasoning is limited to semantic architecture: requirement traceability, source of truth, domain identity, data/auth/storage/API boundaries, server/client boundaries, dependencies, security-relevant architecture, implementability, minimal sufficiency, and contradictory decisions.

The reviewer must not invent requirements, judge visual design, demand optional infrastructure, redesign by preference, or modify project state. Its catalog definition is `architecture-reviewer`, capability `review.architecture`, role `review`, OpenAI generation only, and `readOnly: true`. The current approved skill allowlist from the authoritative `src/agents/catalog.ts` is:

- `module-boundaries-fb20497b5c35`
- `review-maintainability-d9faf7cb9775`
- `architecture-tradeoff-review`

The resolver may select zero, one, or multiple relevant procedures from that allowlist; the documentation list does not itself grant eligibility. Prompt ownership remains `src/integrations/openai/prompts.ts`, version `architecture-reviewer.v1`.

## Normal review versus Factory self-review

The normal project-generation review is the typed `ArchitectureReviewInput` path after Planning Acceptance and before Design. It is the only path that can produce a project-specific architecture gate, and its approved Brief, accepted PlanningPackage, project identity, version, and checksums are authoritative. The provider call is outside the short canonical transaction; review result/history, the architecture-review decision, and an APPROVED routing event/state update are all-or-none. Project Memory is a derived decision projection and is reconciled from canonical rows after a projection failure.

The Phase 5/6 Factory self-review is a separate, bounded repository evidence-pack review of the Factory itself. It does not have a project-specific approved Brief or accepted PlanningPackage, so it is documentation-only for architecture and cannot establish project-specific requirement traceability. Self-review evidence must not be treated as a substitute for, or mixed into, a normal generated-project Architecture Review.
