# Phase 6A — Factory finding currentness and correction plan

## Executive summary

- Current HEAD: d9262d922b8408c0754da5b050b4c14be5a4f3e5
- Original review target: 96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4
- Original validated findings: 31
- Current active unchanged: 29
- Current active rebased: 2
- Partially resolved: 0
- Already resolved: 0
- No longer applicable: 0
- Targeted reviewer applicability calls: 0
- Correction-ready findings: 31
- Correction groups: 19
- Root-cause confidence: HIGH 18, MEDIUM 1, LOW 0
- Active severity: CRITICAL 2, ERROR 13, WARNING 15, INFO 1
- Recommended first group: cg-01-cross-artifact-identity

No correction was applied in Phase 6A. The plan is read-only and excludes rejected Phase 5 findings.

## Currentness table

| Finding ID | Reviewer | Original severity | Current state | Current evidence | Group |
|---|---|---|---|---|---|
| finding-0590fb313e72090696f0 | security-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:25-25, src/agents/implementation/backend.ts:31-31 | cg-02-authentication-authorization-rls |
| finding-0e21399a0a91b82a05dc | contract-auditor | ERROR | ACTIVE_UNCHANGED | src/agents/reviewers/architecture/deterministic.ts:12-24, src/agents/reviewers/architecture/service.ts:225-260 | cg-12-architecture-review-context |
| finding-0ec8a840d7bf928fec42 | test-quality-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/implementation/applier.ts:15-33, src/agents/implementation/backend.test.ts:8-21 | cg-16-implementation-error-recovery-evidence |
| finding-1540c99220f633245955 | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/design/service.ts:34-50, src/agents/design/service.ts:200-260 | cg-05-design-durable-state-authority |
| finding-191200ccc58b25e3fd0c | test-quality-reviewer | WARNING | ACTIVE_UNCHANGED | scripts/ai-smoke.ts:1-14, scripts/context7-smoke.ts:1-17, scripts/codebase-memory-smoke.ts:1-18, scripts/generated-runtime-smoke.ts:1-31 | cg-14-runtime-release-evidence |
| finding-20662816cdabed08871f | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | src/integrations/context7/policy.ts:3-13, src/integrations/context7/service.ts:9-18, src/integrations/context7/contracts.ts:17-20 | cg-08-context7-authority |
| finding-233d7f1502c96cf535e1 | security-reviewer | CRITICAL | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:22-22, src/agents/implementation/backend.ts:29-29, src/agents/implementation/backend.test.ts:17-17 | cg-02-authentication-authorization-rls |
| finding-2484a19307c1536e12e7 | architecture-reviewer | INFO | ACTIVE_UNCHANGED | docs/architecture/architecture-reviewer.md:8-12, AGENTS.md:1-29 | cg-12-architecture-review-context |
| finding-24cb4b563e9b341a84fd | architecture-reviewer | ERROR | ACTIVE_REBASED | src/integrations/openai/config.ts:4-12, src/integrations/openai/production.ts:1-7, src/integrations/openai/client.ts:23-29 | cg-04-provider-config-and-lifecycle |
| finding-3ea29b90bbf550eecdb3 | architecture-reviewer | WARNING | ACTIVE_REBASED | src/integrations/codebase-memory/service.ts:38-41, src/integrations/context7/service.ts:30-39, src/integrations/openai/client.ts:23-39 | cg-04-provider-config-and-lifecycle |
| finding-3ee5bcff808135a21217 | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | AGENTS.md:20-20, docs/architecture/agent-architecture.md:35-35, docs/architecture/architecture-reviewer.md:20-22 | cg-18-skill-portfolio-source-of-truth |
| finding-4970556ab704416b2bf8 | test-quality-reviewer | ERROR | ACTIVE_UNCHANGED | package.json:1-64, scripts/factory-e2e-smoke.ts:1-36 | cg-14-runtime-release-evidence |
| finding-4bba2d52b86f240393fc | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/design/deterministic.ts:6-8 | cg-10-design-request-isolation |
| finding-517e635c9c23995687d8 | code-integration-reviewer | WARNING | ACTIVE_UNCHANGED | scripts/factory-e2e-smoke.ts:15-35 | cg-07-runtime-cleanup-lifecycle |
| finding-51d38dcb2b668ff33332 | test-quality-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/catalog.test.ts:5-74, src/agents/catalog.ts:82-129, src/agents/design/service.ts:132-260 | cg-13-reviewer-execution-evidence |
| finding-5f4cd4a958172b921dfd | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | docs/architecture/product-specification.md:3-16, docs/architecture/implementation-roadmap.md:7-23, docs/architecture/repository-structure.md:51-53, docs/architecture/agent-architecture.md:1-12 | cg-19-architecture-document-state |
| finding-601d85f09cdb45d46400 | test-quality-reviewer | WARNING | ACTIVE_UNCHANGED | scripts/backend-smoke.ts:1-23 | cg-14-runtime-release-evidence |
| finding-7586dd5bd4661d954bf4 | security-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:22-22, src/agents/implementation/backend.ts:29-29 | cg-02-authentication-authorization-rls |
| finding-865697184809f419d1b7 | security-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/implementation/backend.ts:1-40, src/agents/implementation/provider.ts:1-32 | cg-02-authentication-authorization-rls |
| finding-9106112c9ba65e4be7ed | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | src/integrations/codebase-memory/service.ts:35-41, src/integrations/codebase-memory/contracts.ts:7-26, src/integrations/codebase-memory/policy.ts:25-28 | cg-11-codebase-index-identity |
| finding-b227589f057cc3fa00ac | security-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:1-32, src/agents/implementation/backend.ts:1-40 | cg-03-storage-ownership-controls |
| finding-b385146a5a20fb3e4f1b | contract-auditor | CRITICAL | ACTIVE_UNCHANGED | src/agents/reviewers/contracts/contracts.ts:11-16, src/agents/reviewers/contracts/deterministic.ts:24-28, src/agents/reviewers/code-integration/contracts.ts:12-16, src/agents/reviewers/code-integration/deterministic.ts:5-16, src/agents/reviewers/code-integration/service.ts:65-83 | cg-01-cross-artifact-identity |
| finding-bf13a0c6f16bf4702e9e | test-quality-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/design/contracts.ts:1-24, src/agents/design/service.ts:68-130, src/agents/design/design.test.ts:24-42 | cg-17-design-gate-evidence |
| finding-c200a7f61e715bc94be1 | security-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:1-32, src/agents/implementation/backend.ts:1-40 | cg-02-authentication-authorization-rls |
| finding-c94e4c6dd19f957eeb40 | code-integration-reviewer | ERROR | ACTIVE_UNCHANGED | scripts/db-common.mjs:18-26, scripts/db-migrate.mjs:8-9, scripts/db-status.mjs:2-2, scripts/db-verify.mjs:3-3, scripts/db-smoke.ts:18-18 | cg-06-database-error-propagation |
| finding-cec06a12d17a2b103135 | test-quality-reviewer | ERROR | ACTIVE_UNCHANGED | scripts/db-smoke.ts:1-41, scripts/db-verify.mjs:1-22, scripts/db-migrate.mjs:1-26 | cg-15-persistence-migration-evidence |
| finding-e055bfdcbad92c9b36eb | security-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/implementation/backend.ts:1-40, src/agents/implementation/provider.ts:1-32 | cg-02-authentication-authorization-rls |
| finding-eb166a34da7872c62d77 | security-reviewer | WARNING | ACTIVE_UNCHANGED | src/agents/implementation/provider.ts:28-28, src/agents/implementation/backend.ts:34-34 | cg-03-storage-ownership-controls |
| finding-efa4502938176a741e32 | architecture-reviewer | ERROR | ACTIVE_UNCHANGED | src/agents/design/memory.ts:7-12, src/agents/design/server.ts:7-7, src/agents/design/service.ts:4-9 | cg-05-design-durable-state-authority |
| finding-f13df5392f71f7cf58df | architecture-reviewer | WARNING | ACTIVE_UNCHANGED | src/integrations/codebase-memory/service.ts:13-41, src/integrations/codebase-memory/metadata.ts:1-5 | cg-09-project-memory-durability |
| finding-f27b5098995ae5bb44c9 | test-quality-reviewer | ERROR | ACTIVE_UNCHANGED | package.json:1-64 | cg-13-reviewer-execution-evidence |

## Findings already resolved before Phase 6 correction

None. No later Phase 5 infrastructure change demonstrably eliminated a validated semantic finding.

## Correction groups

| Order | Group | Findings | Highest severity | Root cause | Capability | Reviewer recheck | Dependencies |
|---:|---|---|---|---|---|---|---|
| 1 | cg-01-cross-artifact-identity — Restore cross-artifact project identity binding | finding-b385146a5a20fb3e4f1b | CRITICAL | Bind every downstream canonical artifact to the same projectId and projectVersion before review proceeds. | implementation | contract-auditor, code-integration-reviewer | none |
| 2 | cg-02-authentication-authorization-rls — Establish authenticated identity and ownership authorization | finding-0590fb313e72090696f0, finding-233d7f1502c96cf535e1, finding-7586dd5bd4661d954bf4, finding-865697184809f419d1b7, finding-c200a7f61e715bc94be1, finding-e055bfdcbad92c9b36eb | CRITICAL | Make authenticated identity and user-scoped authorization mandatory before protected database behavior is considered valid. | implementation | security-reviewer, contract-auditor | cg-01-cross-artifact-identity |
| 3 | cg-03-storage-ownership-controls — Bind storage operations to ownership and access policy | finding-b227589f057cc3fa00ac, finding-eb166a34da7872c62d77 | ERROR | Replace type/size-only validation with an explicit bucket, object ownership, access, and signed-URL contract where storage is required. | implementation | security-reviewer | cg-02-authentication-authorization-rls |
| 4 | cg-04-provider-config-and-lifecycle — Make provider configuration and external work lifecycle explicit | finding-24cb4b563e9b341a84fd, finding-3ea29b90bbf550eecdb3 | ERROR | Reject empty provider model configuration and ensure configured limits remain truthful when external work is cancelled or times out. | implementation | architecture-reviewer, code-integration-reviewer | cg-01-cross-artifact-identity |
| 5 | cg-05-design-durable-state-authority — Unify Design state ownership and persistence | finding-1540c99220f633245955, finding-efa4502938176a741e32 | ERROR | Make durable repositories and Project Memory the authoritative state path instead of process-local Maps and split filesystem/database state. | implementation | architecture-reviewer, code-integration-reviewer | cg-01-cross-artifact-identity |
| 6 | cg-06-database-error-propagation — Preserve safe database configuration error propagation | finding-c94e4c6dd19f957eeb40 | ERROR | Ensure database configuration failures travel through the established safe error path without bypasses. | implementation | code-integration-reviewer | cg-01-cross-artifact-identity |
| 7 | cg-07-runtime-cleanup-lifecycle — Close generated runtime resources on E2E failure | finding-517e635c9c23995687d8 | WARNING | Guarantee runtime cleanup on every post-creation failure path. | implementation | code-integration-reviewer, test-quality-reviewer | cg-06-database-error-propagation |
| 8 | cg-08-context7-authority — Make Context7 eligibility single-source | finding-20662816cdabed08871f | WARNING | Use one authoritative eligibility decision path for Context7 dependency access. | implementation | architecture-reviewer, code-integration-reviewer | cg-04-provider-config-and-lifecycle |
| 9 | cg-09-project-memory-durability — Persist Project Memory indexes and idempotency state | finding-f13df5392f71f7cf58df | WARNING | Align Project Memory runtime state with its declared durable metadata and authority boundary. | implementation | architecture-reviewer, code-integration-reviewer | cg-05-design-durable-state-authority |
| 10 | cg-10-design-request-isolation — Remove module-global Design request state | finding-4bba2d52b86f240393fc | WARNING | Make generation salt and timestamps request-local and deterministic without shared mutable module state. | implementation | architecture-reviewer, test-quality-reviewer | cg-05-design-durable-state-authority |
| 11 | cg-11-codebase-index-identity — Disambiguate Project Memory workspace index selection | finding-9106112c9ba65e4be7ed | WARNING | Make index selection deterministic when multiple workspace paths exist for a project version. | implementation | architecture-reviewer, code-integration-reviewer | cg-09-project-memory-durability |
| 12 | cg-12-architecture-review-context — Complete architecture review context and evidence contract | finding-0e21399a0a91b82a05dc, finding-2484a19307c1536e12e7 | ERROR | Ensure architecture review receives and preserves the material approved Brief and PlanningPackage obligations required for traceability. | implementation | architecture-reviewer, contract-auditor | cg-01-cross-artifact-identity |
| 13 | cg-13-reviewer-execution-evidence — Provide meaningful reviewer execution and output-contract evidence | finding-51d38dcb2b668ff33332, finding-f27b5098995ae5bb44c9 | ERROR | Test reviewer execution, strict output contracts, and preserve trustworthy executed evidence for the reviewer portfolio. | test-quality | test-quality-reviewer | cg-12-architecture-review-context |
| 14 | cg-14-runtime-release-evidence — Execute and record release-critical runtime evidence | finding-4970556ab704416b2bf8, finding-191200ccc58b25e3fd0c, finding-601d85f09cdb45d46400 | ERROR | Record meaningful runtime behavior evidence rather than only proposal acceptance or unexecuted opt-in scripts. | functional-qa | test-quality-reviewer, code-integration-reviewer | cg-07-runtime-cleanup-lifecycle, cg-13-reviewer-execution-evidence |
| 15 | cg-15-persistence-migration-evidence — Record executed persistence and migration evidence | finding-cec06a12d17a2b103135 | ERROR | Make migration and persistence checks demonstrably executed and bound to the current source state. | runtime-tests | test-quality-reviewer | cg-06-database-error-propagation |
| 16 | cg-16-implementation-error-recovery-evidence — Test atomic implementation failure and recovery | finding-0ec8a840d7bf928fec42 | WARNING | Exercise and record failure/recovery behavior for atomic file application, not only proposal validation. | runtime-tests | test-quality-reviewer | cg-13-reviewer-execution-evidence |
| 17 | cg-17-design-gate-evidence — Cover Design gate and contract failure paths | finding-bf13a0c6f16bf4702e9e | WARNING | Add direct meaningful quality evidence for the implemented Design gate and contract failure paths. | runtime-tests | test-quality-reviewer, contract-auditor | cg-05-design-durable-state-authority |
| 18 | cg-18-skill-portfolio-source-of-truth — Align reviewer skill portfolio documentation and catalog | finding-3ee5bcff808135a21217 | WARNING | Make the documented portfolio and the authoritative catalog agree without changing skills or assignments in this plan. | implementation | architecture-reviewer | cg-13-reviewer-execution-evidence |
| 19 | cg-19-architecture-document-state — Mark current and planned architecture documentation | finding-5f4cd4a958172b921dfd | WARNING | Add explicit current/planned/supersession markers so implemented capability is distinguishable from roadmap intent. | implementation | architecture-reviewer | cg-18-skill-portfolio-source-of-truth |

## Critical findings still active

| Finding | Current evidence | Root cause group |
|---|---|---|
| finding-233d7f1502c96cf535e1 | src/agents/implementation/provider.ts:22-22, src/agents/implementation/backend.ts:29-29, src/agents/implementation/backend.test.ts:17-17 | cg-02-authentication-authorization-rls |
| finding-b385146a5a20fb3e4f1b | src/agents/reviewers/contracts/contracts.ts:11-16, src/agents/reviewers/contracts/deterministic.ts:24-28, src/agents/reviewers/code-integration/contracts.ts:12-16, src/agents/reviewers/code-integration/deterministic.ts:5-16, src/agents/reviewers/code-integration/service.ts:65-83 | cg-01-cross-artifact-identity |

Both CRITICAL findings remain active: cross-artifact identity mismatch and broad generated RLS authorization.

## Dependency order

1. cg-01-cross-artifact-identity
2. cg-02-authentication-authorization-rls after cg-01-cross-artifact-identity
3. cg-03-storage-ownership-controls after cg-02-authentication-authorization-rls
4. cg-04-provider-config-and-lifecycle after cg-01-cross-artifact-identity
5. cg-05-design-durable-state-authority after cg-01-cross-artifact-identity
6. cg-06-database-error-propagation after cg-01-cross-artifact-identity
7. cg-07-runtime-cleanup-lifecycle after cg-06-database-error-propagation
8. cg-08-context7-authority after cg-04-provider-config-and-lifecycle
9. cg-09-project-memory-durability after cg-05-design-durable-state-authority
10. cg-10-design-request-isolation after cg-05-design-durable-state-authority
11. cg-11-codebase-index-identity after cg-09-project-memory-durability
12. cg-12-architecture-review-context after cg-01-cross-artifact-identity
13. cg-13-reviewer-execution-evidence after cg-12-architecture-review-context
14. cg-14-runtime-release-evidence after cg-07-runtime-cleanup-lifecycle, cg-13-reviewer-execution-evidence
15. cg-15-persistence-migration-evidence after cg-06-database-error-propagation
16. cg-16-implementation-error-recovery-evidence after cg-13-reviewer-execution-evidence
17. cg-17-design-gate-evidence after cg-05-design-durable-state-authority
18. cg-18-skill-portfolio-source-of-truth after cg-13-reviewer-execution-evidence
19. cg-19-architecture-document-state after cg-18-skill-portfolio-source-of-truth

The dependency graph is acyclic. Corrections should proceed in this order, with each bounded batch checked and re-reviewed before its dependents.

## NEXT PHASE 6B CORRECTION GROUP

### cg-01-cross-artifact-identity — Restore cross-artifact project identity binding

- Finding IDs: finding-b385146a5a20fb3e4f1b
- Root cause: Bind every downstream canonical artifact to the same projectId and projectVersion before review proceeds.
- Evidence: src/agents/reviewers/contracts/contracts.ts:11-16 (7c3ac24991be9a37fdae8f7b62c624c6a806dab8f3351dfd4112c4994bac365a), src/agents/reviewers/contracts/deterministic.ts:24-28 (9023ac9d8da298317ce2eaa926b53f283c02786ccc915c23ba4b048bc61b4547), src/agents/reviewers/code-integration/contracts.ts:12-16 (76b6ed179becf5329ea49769cb9b22659a39aadf8125b2675447a5373f1299a1), src/agents/reviewers/code-integration/deterministic.ts:5-16 (64813f96125498eb43f9c3fb0faaa0095122b43bd951653bd82b8ad8134d387c), src/agents/reviewers/code-integration/service.ts:65-83 (29adf4c78e24daff5672172469db10ce10778f7bff668b89068d51004653f7a3)
- Correction goal: Bind every downstream canonical artifact to the same projectId and projectVersion before review proceeds.
- Likely files: src/agents/reviewers/contracts/contracts.ts, src/agents/reviewers/contracts/deterministic.ts, src/agents/reviewers/code-integration/contracts.ts, src/agents/reviewers/code-integration/deterministic.ts, src/agents/reviewers/code-integration/service.ts
- Allowed capability: implementation
- Likely executor: Implementation Agent / trusted implementation executor
- Deterministic checks: targeted Contract Auditor tests, targeted Code / Integration Reviewer tests, npm run typecheck, npm run lint
- Reviewer checks: contract-auditor, code-integration-reviewer
- Non-goals: No new artifact type; No reviewer write authority; No stack or workflow redesign
- Rollback criteria: any targeted check fails; any supplied artifact with mismatched project identity is accepted; reviewer read-only or ChangeProposal boundaries are weakened; or the correction requires files outside the bounded group without a new plan.

## Known maintenance items

- KNOWN_MAINTENANCE_ITEM: 12 preserved .qa-foundation-* directories. This is outside the authoritative 31 findings and is not a correction group.

## Rebase and safety notes

- Only findings citing changed evidence files were deterministically rebased: finding-24cb4b563e9b341a84fd, finding-3ea29b90bbf550eecdb3.
- The OpenAI client changes are Phase 5 provider infrastructure, not automatic finding fixes. Current inspection shows both affected findings remain semantically applicable.
- No broad self-review, MCP, new agent, skill, assignment, ChangeProposal, correction TaskGraph task, or website-generation E2E was used.
- Approved skills remain external 4, internal 13, assignment refs 18, deferred skill usage 0; agent catalog remains 9.

## Validation

Phase 6A validation is recorded after artifact generation: lint, typecheck, tests, build, audit, database checks, Docker Compose config, TaskGraph smoke, and diff check.

PHASE 6A: CURRENTNESS_AND_GROUPING_COMPLETE
NEXT: PHASE 6B — FIRST CONTROLLED CORRECTION GROUP
