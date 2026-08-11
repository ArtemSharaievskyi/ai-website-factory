# Phase 6Q / cg-18 Skill Portfolio Source of Truth — COMPLETE

Baseline: `a935dda`
Correction commit: `c02ee31` — `docs: align skill portfolio authority`
Source plan: `docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json`
Plan identity: `819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00`

## Finding and correction

| Field | Result |
|---|---|
| Group | `cg-18-skill-portfolio-source-of-truth` — Align reviewer skill portfolio documentation and catalog |
| Finding | `finding-3ee5bcff808135a21217` |
| Reviewer/category/severity | Architecture Reviewer / `CONTRADICTORY_DECISION` / WARNING |
| Root cause | Make the documented portfolio and authoritative catalog agree without changing skills or assignments. |
| Confidence | HIGH |
| Dependency | `cg-13-reviewer-execution-evidence` — COMPLETE |
| Classification | Documentation-level `AGENT_ALLOWLIST_DIVERGENCE`; no runtime assignment divergence was found. |

The exact contradictory fact was the current Architecture Reviewer assignment. `src/agents/catalog.ts` already had three assigned skills, while the Architecture Reviewer documentation did not state that allowlist and retained the historical no-skills interpretation. Repository rules described the complete nine-agent portfolio, so the documentation set could be read as contradictory.

The correction makes `src/agents/catalog.ts` the sole current assignment authority, states the exact Architecture Reviewer allowlist in its documentation, explicitly labels architecture/admin portfolio text as derived, and adds deterministic equality regressions. No skill, assignment, registry, resolver, prompt, schema, migration, or runtime behavior changed.

## Authority map

| Question / fact | Canonical authority | Derived consumers | Must not be authority |
|---|---|---|---|
| Is a skill approved? | Approved Skills Registry records | Resolver and audit/tests | Admin snapshot, curation report, staging, `skills.sh` |
| What is approved content/checksum? | Registry record plus immutable local approved copy | Runtime prompt preparation and citations | Source repository, staging, admin report |
| May agent X use skill Y? | `AgentDefinition.allowedSkillIds` in `src/agents/catalog.ts`, combined with registry approval | Resolver and active snapshot validation | Documentation or caller-provided portfolio |
| Which skills are relevant now? | `src/skills/runtime/resolver.ts` | Reviewer/provider prompt context | Static portfolio snapshot or fixed top-K list |
| What portfolio did an admin report show? | The dated admin snapshot/report | Historical evidence | Production runtime |

Before cg18, the runtime already followed the intended catalog → registry → resolver flow, but the documentation projection was ambiguous. After cg18, the flow is unchanged and the projection is explicit:

`AgentDefinition catalog -> approved registry -> resolver applicability/coverage/conflict/budget selection -> selected checksums -> bounded prompt context`

The resolver still supports zero, one, or multiple selected skills, with minimum-sufficient deterministic selection and no fixed quota. Selected checksums remain invocation identity inputs; unselected registry growth does not over-invalidate an invocation.

## Source classification

| Source | Classification | Runtime authority? | Mutable? | Purpose/currentness role |
|---|---|---:|---:|---|
| `src/agents/catalog.ts` | AUTHORITATIVE | Yes | Source-controlled | Current agent assignment and capability authority |
| `skills/registry/*.json` | AUTHORITATIVE | Yes | Registry lifecycle | Approval, applicability, checksum, audit and revocation state |
| `skills/approved/**` | AUTHORITATIVE CONTENT | Yes, through registry | Immutable promoted copy | Runtime SKILL.md/reference content |
| `src/skills/runtime/resolver.ts` | AUTHORITATIVE DERIVATION | Yes | Source-controlled | Invocation-specific selected subset and checksum identity |
| `docs/admin/skill-curation/active-agent-skill-portfolio-2026-08-09.json` | HISTORICAL / DERIVED | No | Historical snapshot | Portfolio evidence; now regression-checked against catalog |
| `src/skills/curation/portfolio.ts` | CURATION / REPORT MODEL | No | Source-controlled | Coverage discovery model, not active runtime assignment |
| `skills/staging/**` | STAGING | No | Lifecycle workspace | Candidate review before approval |
| `src/integrations/skills-sh/**` | DISCOVERY / SOURCE ADAPTER | No | Adapter | Bounded public discovery/staging only |
| `docs/admin/**` and curation plans | REPORT_ONLY / HISTORICAL | No | Historical | Evidence and history, never runtime eligibility |
| `.context7-cache/` | CACHE | No | Transient | Unrelated cache, excluded from portfolio identity |

## Agent portfolio integrity

The authoritative catalog remains unchanged and has nine agents with explicit allowlists:

| Agent | Allowed approved skills | Canonical assignment source | Integrity |
|---|---|---|---|
| Lead | `lead-requirements-completeness` | `src/agents/catalog.ts` | PASS |
| Planner | `project-data-model-planning`, `technical-risk-planning` | `src/agents/catalog.ts` | PASS |
| Design | `responsive-form-ux-design` | `src/agents/catalog.ts` | PASS |
| Implementation | `nextjs-server-client-implementation`, `typed-form-implementation`, `supabase-application-integration`, `maintainable-performance-implementation` | `src/agents/catalog.ts` | PASS |
| Architecture Reviewer | `module-boundaries-fb20497b5c35`, `review-maintainability-d9faf7cb9775`, `architecture-tradeoff-review` | `src/agents/catalog.ts` | PASS |
| Contract Auditor | `acceptance-criteria-80493e317476`, `requirements-evidence-traceability` | `src/agents/catalog.ts` | PASS |
| Code / Integration Reviewer | `react-nextjs-integration-review` | `src/agents/catalog.ts` | PASS |
| Security Reviewer | `supabase-rls-1e36b217c969`, `auth-storage-security-review` | `src/agents/catalog.ts` | PASS |
| Test / Quality Reviewer | `requirements-evidence-traceability`, `behavioral-test-quality-review` | `src/agents/catalog.ts` | PASS |

The active snapshot equality regression now compares every `approvedAllowedSkillIds` row to the catalog. The shared `requirements-evidence-traceability` skill remains one artifact with two assignment references; 17 unique approved artifacts and 18 assignment references are intentionally not equal.

Portfolio invariants remain: 4 approved external, 13 approved internal, 17 unique approved artifacts, 18 assignment references, 9 agents, and 0 deferred runtime usage. All active `SKILL.md` files are byte-for-byte unchanged; no new skill was approved, no skill was revoked, and assignments did not change.

## Source-of-truth scenarios

| Scenario | Expected behavior | Before | After | Proof |
|---|---|---|---|---|
| Architecture Reviewer documentation versus catalog | Documentation must state the exact catalog allowlist | Ambiguous/no-skills interpretation remained possible | Exact three IDs and catalog authority are documented | New `src/agents/catalog.test.ts` regression |
| Active snapshot versus catalog | Snapshot is derived and must equal catalog rows | Snapshot was tested only for agent IDs/shared skill facts | All nine allowlists are compared exactly | New `src/skills/curation/active-portfolio.test.ts` assertion |
| Approved and assigned skill | Resolver may select it when relevant and within policy | Existing behavior | Unchanged | Active portfolio/resolver tests |
| Assigned but unapproved/deferred skill | Exclude with `NOT_APPROVED`; no runtime context | Existing behavior | Unchanged | Active portfolio deferred-candidate tests and resolver path |
| Revoked skill | Registry denies with `SKILL_REVOKED` | Existing behavior | Unchanged | Registry tests |
| Historical snapshot differs | Must not alter runtime eligibility | Not explicitly documented at the affected boundary | Explicitly non-authoritative and catalog-bound by regression | Documentation correction plus snapshot equality test |
| Shared skill | One artifact may have multiple assignments | Existing behavior | Unchanged | Active portfolio shared-traceability test |
| Zero-skill selection | Empty relevant subset is valid | Existing behavior | Unchanged | Resolver security-surface test |
| Multi-skill selection | Complementary skills selected in deterministic order | Existing behavior | Unchanged | Resolver complementary-selection test |
| Selected-skill checksum changes | Registry checksum gate rejects stale/changed approved content | Existing behavior | Unchanged | Registry checksum tests and resolver identity evidence |

No caller can add a skill through documentation or a snapshot. The resolver iterates the supplied AgentDefinition allowlist, while registry loading checks approval, role, task, tool, and allowlist constraints. No whole-registry hash was added to invocation identity.

## Files and scope

| File | Change | Why required |
|---|---|---|
| `AGENTS.md` | States catalog allowlists are sole assignment authority; rules/admin snapshots are derived | Removes repository-rule ambiguity |
| `docs/architecture/agent-architecture.md` | States catalog authority and derived-document role | Aligns architecture policy with runtime ownership |
| `docs/architecture/architecture-reviewer.md` | Adds exact three-skill allowlist and non-authoritative documentation note | Resolves the assigned Architecture Reviewer contradiction |
| `src/agents/catalog.test.ts` | Compares documented Architecture Reviewer list to catalog | Prevents documentation drift |
| `src/skills/curation/active-portfolio.test.ts` | Compares all nine snapshot allowlists to catalog | Proves snapshot is derived, not a second authority |
| `scripts/phase-6c-cg02-verification.ts` | Adds cg18 evidence slices/question/dispatcher | Required cg13-compatible reviewer evidence |

Production source files changed: none. `src/agents/catalog.ts` was inspected as the authority but its assignment values were not modified. No active SKILL.md, registry content, schema, database migration, resolver implementation, prompt wiring, agent, orchestrator, MCP, or dependency authority changed.

## Reviewer verification

Required recheck: `architecture-reviewer`.

The verifier made one fresh real GPT call. It selected the approved resolver subset `architecture-tradeoff-review`, `module-boundaries-fb20497b5c35`, and `review-maintainability-d9faf7cb977`, with current approved checksums recorded in the machine artifact. The result was structured-output valid, evidence-valid, and `RESOLVED` / `APPROVED` with no remaining findings.

Machine verification: [cg-18 verification JSON](cg-18-skill-portfolio-source-of-truth-verification-2026-08-11.json) and [cg-18 verification report](cg-18-skill-portfolio-source-of-truth-verification-2026-08-11.md).

## Validation

| Check | Result |
|---|---|
| Targeted catalog/portfolio/resolver tests | PASS — 4 files / 30 tests |
| Full Vitest | PASS — 70 files / 846 tests |
| Reviewer suite | PASS — 7 files / 76 tests |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 3 known pre-existing warnings |
| Production build | PASS |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| Database validation | PASS — 2 migrations |
| Database status | PASS — both migrations applied with expected checksums |
| Database verification | PASS — 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| Database integrity fixture | PASS |
| Docker Compose config | PASS |
| TaskGraph smoke | PASS — `releaseEligible=true`, 6 tasks, 0 repairs |
| `git diff --check` | PASS |
| Customer website-generation E2E | Not intentionally run |
| Deployment/customer DB changes | None |

QA foundation directories were 16 before targeted checks, 16 after targeted checks, and 16 after the full suite. Historical QA directories were not cleaned. `.context7-cache/` remains untracked and unstaged, and is excluded from portfolio identity.

## Phase state

Counts before cg18 were `4 total / 0 CRITICAL / 0 ERROR / 4 WARNING / 0 INFO`. After resolving the one assigned WARNING they are `3 total / 0 CRITICAL / 0 ERROR / 3 WARNING / 0 INFO`; arithmetic is valid: `3 = 0 + 0 + 3 + 0`.

The DAG remains acyclic and unchanged. `cg-19-architecture-document-state` became newly unblocked because its dependency `cg-18-skill-portfolio-source-of-truth` is now complete. No other correction group was modified or auto-resolved. Dependency Authority remains deferred until Phase 6 is complete.

Closure artifacts:

- [cg-18 result JSON](cg-18-skill-portfolio-source-of-truth-result-2026-08-11.json)
- [cg-18 result report](cg-18-skill-portfolio-source-of-truth-result-2026-08-11.md)
- [cg-18 verifier JSON](cg-18-skill-portfolio-source-of-truth-verification-2026-08-11.json)
- [cg-18 verifier report](cg-18-skill-portfolio-source-of-truth-verification-2026-08-11.md)
- Successor state: `docs/admin/phase-6/phase-6-execution-state-2026-08-11-cg18-result.json`

PHASE 6Q / cg-18: COMPLETE
NEXT: cg-19-architecture-document-state
