# Known regression classes

These are concise regression memories, not customer incident records. Each
entry names the invariant and the regression boundary that must be exercised.

## PROVIDER_STRICT_OPTIONALITY

- Symptom: strict structured-output construction rejects an optional nested
  property or the provider omits a field the schema requires.
- Rule: represent absent values with required nullable fields where the
  provider contract requires it; keep the object strict.
- Regression: construct the real production response schema and parse a valid
  fixture through the OpenAI adapter.

## HOST_OWNED_PROVIDER_FIELDS

- Symptom: provider output attempts to set project identity, version, checksum,
  approval, currentness, history, or trace metadata.
- Rule: the host assigns and persists those fields after typed mapping.
- Regression: assert the provider DTO excludes them and the canonical result
  receives host values.

## CANONICAL_REQUIREMENT_TRUNCATION

- Symptom: a context budget or reducer drops, summarizes, or ranks away user
  requirements, clarification answers, or approved decisions.
- Rule: canonical requirement context is lossless; only supporting technical
  context may be bounded.
- Regression: run `src/runtime/context/lossless-context.test.ts` and inspect
  checksums/provenance.

## FAILED_IDEMPOTENCY_POISONING

- Symptom: a failed operation remains successful/in progress forever, or a
  legitimate retry is rejected by stale reservation state.
- Rule: reserve, complete, and fail through `OperationRepository`; failure must
  not commit the operation's intended domain mutation.
- Regression: exercise the service failure path, retry, payload-hash conflict,
  and successful replay.

## SEQUENTIAL_CLARIFICATION_IDEMPOTENCY

- Symptom: a new clarification round is treated as a replay of an earlier
  answer set, or an old question ID is accepted as current.
- Rule: identity includes the legitimate current round and answers; resolved
  questions and stale rounds are rejected.
- Regression: run `src/runtime/trial-entry/sequential-clarification-idempotency.test.ts`.

## CLIENT_ASSET_AUTHORITY

- Symptom: browser metadata changes Lead context or becomes the source of
  truth for an uploaded asset.
- Rule: `ProjectAssetService` and persistence provide current ready references;
  the server rebuilds Lead input.
- Regression: run asset upload and Lead asset-context tests with altered client
  metadata.

## ASSET_PERSISTENCE_NULLABILITY

- Symptom: a valid nullable database value fails strict parsing or is converted
  to an incorrect empty value.
- Rule: normalize row values at the persistence mapping edge and preserve the
  domain's nullable contract.
- Regression: cover Postgres mapping, fake persistence, and asset service tests.

## LEGACY_REQUIREMENT_REACTIVATION

- Symptom: removed or superseded historical requirements reappear in current
  effective Brief requirements.
- Rule: `getEffectiveBriefRequirements` excludes history; legacy V1/V2 documents
  are read and migrated to V3 without resurrecting historical entries.
- Regression: run the V3 certification, legacy migration, and production-shaped
  revision tests.

## SINGLE_BRIEF_MUTATION_AUTHORITY

- Symptom: legacy compatibility code becomes a second Brief mutation authority,
  often through a provider-generated full candidate, fallback branch, or direct
  persistence write.
- Rule: legacy V1/V2 support is read/migrate only. Every new Brief mutation must
  enter `BriefV3TransactionService`; providers emit bounded intent and cannot
  own currentness, persistence identity, workflow state, idempotency, or commit.
  A new agent or provider must not create another canonical mutation authority.
- Regression: run the architecture boundary guard, Workbench production trace,
  V1/V2 migration certification, provider-failure fail-closed test, replay tests,
  and the full pre-existing Brief regression gates before acceptance.

## BRIEF_APPROVAL_ELIGIBILITY_IS_OWNED_BY_CANONICAL_READINESS

- Symptom: a current CanonicalBriefV3 reports `readyForApproval` with no
  blockers, but a stale workflow label independently rejects explicit approval.
- Rule: `evaluateBriefReadiness` is the only semantic approval-eligibility
  authority. A host-owned approval command must reload the current V3 Brief,
  validate readiness and exact currentness/CAS, persist lifecycle approval
  atomically, and perform one valid lifecycle transition. Readiness never
  auto-approves; workflow state remains a lifecycle guard rather than a second
  readiness definition. Approval metadata is outside the semantic Brief
  checksum, does not create revision history, and does not change publication
  readiness or publication-only placeholders.
- Regression: run the production-shaped ready-`CLARIFYING` approval,
  not-ready/clarification/contradiction rejection, stale-token, CAS rollback,
  semantic-checksum, projection, exact-one-transition, and replay tests.

## PERSISTENCE_SQL_BINDINGS_MUST_BE_REAL_DB_CERTIFIED

- Symptom: a critical raw-SQL write declares a different number or order of
  columns/placeholders and parameters, or a database-native value is returned
  in a shape that does not match the typed persistence contract.
- Rule: audit the complete column/placeholder/parameter mapping, preserve
  nullable and required semantics, normalize database-native values at the
  persistence edge, and verify every persisted field through a real Postgres
  round-trip. Count-only checks are insufficient.
- Regression: exercise the actual write against Postgres with representative
  non-null and nullable neighboring values, then re-read the row and run the
  atomic success, rollback, stale-currentness, and repeat-operation tests.

## STRUCTURED_OUTPUT_SCHEMA_CONSTRUCTION

- Symptom: a domain-only Zod test passes while the provider call fails because
  the actual response format cannot be constructed or parsed.
- Rule: the exact schema used by the production client is the contract under
  test; test transport wrapper, strictness, and adapter mapping together.
- Regression: run the OpenAI provider contract tests and, only when necessary,
  a synthetic live transport check.

## PLANNER_DEPENDENCY_REFERENCE_NORMALIZATION

- Symptom: a valid Planner dependency such as `package@version` is sent to
  package authority as one package name, or an architecture reference silently
  diverges from the project DependencyPlan.
- Rule: parse package identity and requested version at the host boundary,
  validate both against the catalog, preserve scoped-name handling, and require
  architecture references to match the current project plan.
- Regression: run `src/dependencies/authority.test.ts` and the Planner
  admission assertions in `src/agents/planner/planner.test.ts`.

## PLANNER_ADMISSION_BEFORE_PERSISTENCE

- Symptom: an invalid provider planning package is persisted as a draft before
  deterministic dependency, structure, traceability, or fixed-stack validation.
- Rule: deterministic admission must pass before initial planning, persisted
  reconciliation, or architecture-review correction saves a package. Expected
  user-resolution/publication blockers remain draft blockers and are evaluated
  by Planning Acceptance.
- Regression: `src/agents/planner/admission.test.ts` proves an invalid
  dependency package is rejected with no planning-package row persisted.

## PLANNING_ACCEPTANCE_MUST_NOT_CONFLATE_PUBLICATION

- Symptom: a Planning Package that has no technical or concrete asset defect is
  rejected because it still records final legal facts or future photography
  rights that are required only for later publication-safe completion.
- Rule: `evaluatePlanningAcceptanceReadiness` is the single host-owned
  acceptance authority. It keeps real technical blockers blocking, preserves
  deferred lifecycle obligations visibly, and never treats deferred work as
  publication authorization. Downstream guards must consume its result rather
  than inspect `planning-package.blockers` directly.
- Regression: `src/agents/planner/acceptance.test.ts` covers deferred legal and
  photography work, genuine technical blockers, placeholder-policy changes,
  and concrete rejected assets; inspect the real package read-only at the
  Planning Acceptance boundary before any pilot mutation.

## PLANNING_ACCEPTANCE_IS_ONE_CANONICAL_TRANSACTION

- Symptom: accepted planning documents, the acceptance decision, and the
  workflow transition are written by separate transactions, so a failure can
  leave acceptance ahead of workflow or audit state.
- Rule: `PlannerArchitectService.acceptPlanningPackage` is the single host-owned
  acceptance authority. It must re-read currentness and readiness inside one
  database transaction and commit all canonical acceptance consequences or none.
  Workbench and E2E callers delegate to this service; they must not compose the
  writes themselves.
- Regression: `src/agents/planner/acceptance-transaction.test.ts` covers real
  Postgres success, post-write rollback, decision/workflow failure rollback,
  CAS, repeat acceptance, semantic immutability, and entrypoint convergence.

## DERIVED_PROJECTIONS_MUST_NOT_SHARE_CANONICAL_COMMIT_AUTHORITY

- Symptom: a filesystem or Project Memory failure is treated as a reason to
  compensate or partially undo a committed database acceptance, or is silently
  reported as synchronized.
- Rule: database acceptance commits first. Project Memory/filesystem is a
  recoverable derived projection; failures surface a projection error and
  reconciliation rebuilds it from canonical rows.
- Regression: the Planning Acceptance transaction certification injects a
  projection failure, verifies canonical state remains internally consistent,
  then restores the projection from a fresh service.
