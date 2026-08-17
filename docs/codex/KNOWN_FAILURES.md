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

## STRUCTURED_OUTPUT_SCHEMA_CONSTRUCTION

- Symptom: a domain-only Zod test passes while the provider call fails because
  the actual response format cannot be constructed or parsed.
- Rule: the exact schema used by the production client is the contract under
  test; test transport wrapper, strictness, and adapter mapping together.
- Regression: run the OpenAI provider contract tests and, only when necessary,
  a synthetic live transport check.
