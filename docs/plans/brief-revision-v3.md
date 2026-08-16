# Executive decision

**Decision: REBUILD.**

The Brief Revision subsystem should be replaced by a small V3 subsystem whose
only mutation input is a typed `BriefChangeSet`. The current implementation has
good safety guards and useful persistence seams, but its central model is
structurally unstable: the provider authors a complete canonical-looking
candidate and a second operation description, while the host applies additional
text matching, preservation, effective-selection, history, and contradiction
logic to reconcile them. Each local fix reduces one failure mode without
removing the competing authorities that create the failure cluster.

This is not a recommendation to rebuild the Factory or its generic persistence
adapter. It is a controlled replacement of the Brief Revision domain boundary.
Existing V1/V2 Briefs remain readable through deterministic adapters. New
revisions write one V3 current representation and append provenance separately.

The protected real pilot was read only. No Request changes, approval, downstream
agent, provider call, asset mutation, database mutation, or pilot change was
performed during this audit.

# Current architecture

## Actual production pipeline

The current path is:

```text
Workbench UI
  -> POST /api/workbench
  -> WorkbenchRequestSchema
  -> WorkbenchApplication.handle("request-brief-changes")
  -> TrialEntryService.requestBriefChanges
  -> OperationRepository.reserve
  -> current project/document/checksum/row-version checks
  -> LeadAgentService.requestBriefRevision
  -> OpenAiLeadProvider.reviseBrief (or deterministic test provider)
  -> OpenAiStructuredClient.request / strict response format
  -> normalizeBriefDraft / host metadata binding
  -> LeadAgentService.mergeRevisionRequirements
  -> applyBriefRevisionSemanticsWithOptions
       -> extractBriefRevisionIntent
       -> resolveBriefRevisionOperations
       -> validateProviderRevisionOperations
       -> removeTarget
       -> addMissingPreserved
       -> getEffectiveBriefRequirements
       -> historyFor
  -> validateBriefRevisionSemantics
  -> briefApprovalBlockers / validateBriefContradictions
  -> DocumentRepository.save
  -> Lead memory snapshot
  -> WorkflowPersistenceService.transition (when required)
  -> DecisionRepository.append and memory decision
  -> OperationRepository.complete
  -> Workbench projection reload
```

The concrete ownership and trust boundary at each stage is:

| Stage | Input authority | Output authority | Determinism | Mutation/validation responsibility |
| --- | --- | --- | --- | --- |
| Workbench UI and route | Browser supplies the action and currentness values; it is not authoritative | Route emits a validated DTO or safe error envelope | Deterministic | Request shape, byte bound, safe projection; no Brief or SQL mutation |
| `WorkbenchApplication.handle` | Parsed Workbench request | Delegation result | Deterministic | Selects the application action; does not own revision semantics |
| `TrialEntryService.requestBriefChanges` | Submitted instruction plus project/version/checksum/row version | Operation reservation and Lead request | Deterministic except Lead call | Normalizes user text, builds the current attempt identity, reserves/retries operations, performs pre-provider currentness checks, and completes/fails the operation |
| `OperationRepository` and database idempotency table | Operation/key/payload hash | `NEW`, `IN_PROGRESS`, `SUCCEEDED`, or retryable failed reservation | Deterministic and transaction-backed per repository call | Duplicate suppression and payload conflict detection; not the domain commit boundary |
| `LeadAgentService.requestBriefRevision` | Server-reloaded project and current requirements document | Provider input and revised requirements result | Mixed | Rechecks currentness around the provider call, coordinates provider, domain reducer, contradiction checks, document save, workflow, decision, and memory calls |
| `OpenAiLeadProvider.reviseBrief` | Current Brief, current canonical requirements, full revision instruction, and technical context | Full `BriefRevisionDraft` containing `requirements` plus `revisionOperations` | Probabilistic provider; deterministic transport mapping | Provider proposes semantic content and operations. Adapter validates strict transport and binds host metadata after the provider response |
| `OpenAiStructuredClient` | Structured request and Zod response schema | Parsed transport DTO or typed provider error | Deterministic parsing around probabilistic transport | Builds the actual strict OpenAI schema, parses refusal/incomplete/invalid output, and records bounded diagnostics; it does not decide Brief semantics |
| `normalizeBriefDraft` in `src/integrations/openai/adapters.ts` | Provider transport DTO and host context | `ProjectBriefV2`-shaped canonical object plus Lead draft | Deterministic | Removes transport nulls, binds project/version/language/timestamps/approval/checksum, and validates V2. It still maps a provider-authored full candidate into canonical state |
| `revision.ts` | Existing Brief, provider candidate, user instruction, and provider operations | A candidate after operation application, preservation, effective selection, and history derivation | Deterministic but text/heuristic-driven | Resolves free-text targets, rejects unapplied REMOVE/REPLACE, removes exact normalized text, copies missing fields, strips history for effective checks, and creates history |
| `brief-validation.ts` | Resulting effective candidate | Contradiction list and approval blockers | Deterministic heuristics plus typed form checks | Enforces contradictions only after candidate/revision processing; it does not make contradictory current states unrepresentable |
| Repositories and memory | Domain document and workflow transitions | Durable document, event, decision, and filesystem snapshot | Deterministic within each transaction | Validate checksums, row versions, immutable versions, and individual transactions. The revision currently crosses several independent transactions |
| Workbench projection | Current persisted project and documents | Bounded browser projection | Deterministic | Limits/labels content; never becomes current Brief authority |

## Actual domain representations

`RequirementSpecificationSchema` is still the persisted reader and contains the
V1 fields, optional V2 fields, approval, revision instructions, and optional
`requirementHistory`. `ProjectBriefV2Schema` extends it with
`BriefV2FieldsSchema`. This is a compatibility union in practice, not a single
canonical state model: `briefSchemaVersion` is optional on the legacy reader,
while the V2 sections are independently optional on the legacy-compatible
schema.

V2 adds typed sections such as `formBehaviorRequirements`, but prohibition and
free-text policy still also live in `explicitExclusions` and
`prohibitedRequirements`. A form can therefore have `successUx: "SIMULATED"`
and an active natural-language prohibition at the same time; the schema accepts
that state and `validateBriefContradictions` reports it later.

`getEffectiveBriefRequirements` currently makes a useful but narrow guarantee:
it clones the document and deletes `requirementHistory`. It does not calculate
which current entries are superseded or removed because history entries do not
carry a host-enforced link to an active semantic identity. A re-emitted legacy
statement can therefore look current unless another revision guard catches it.

There is also a second revision behavior hidden in
`LeadAgentService.requestBriefRevision`: when the optional provider returns no
draft, the `else` branch copies the existing Brief, appends new unresolved
items from `requirementKeys`, saves it, writes memory, reopens clarification,
and appends a decision. This is not the same mutation as a semantic revision,
but it shares the same Workbench action and persistence path. V3 must make this
an explicit provider result such as `NEEDS_CLARIFICATION`, with a separately
validated transition policy, rather than an implicit no-provider revision
fallback.

## V1 to V2 boundary actually used today

There is no single `migrateV1ToCanonicalV2` function. The effective path is:

1. `RequirementSpecificationSchema` reads a legacy V1 document.
2. The provider is asked for a complete V2 candidate. `BriefRequirementsTransportSchema`
   is already a provider-specific projection, but it is mapped by
   `normalizeBriefDraft` into `ProjectBriefV2Schema`.
3. `mergeRevisionRequirements` calls the V1/V2-aware revision code with the V1
   existing document and V2 candidate.
4. If either input advertises V2, the merged result is parsed as V2.

The V2 upgrade is therefore an incidental consequence of provider mapping and
merge selection. The normal reducer still understands V1 fields, V2 fields,
free-text exclusions, and provider output. That is the legacy boundary V3 must
remove.

`BriefRevisionProviderInput` also exposes both `currentBrief` and
`currentCanonicalRequirements`; `LeadAgentService.requestBriefRevision` passes
the same `existing` document to both fields. They are duplicate authority labels
today and a future drift risk. V3 should expose one `current` canonical state
plus a host-derived target catalog.

## Current persistence boundary

`DocumentRepository.save`, `WorkflowPersistenceService.transition`,
`DecisionRepository.append`, `OperationRepository.complete`, and the Lead memory
adapter each use their own transaction or external write. In
`LeadAgentService.requestBriefRevision`, the requirements document is saved
before workflow transitions and decision/memory writes finish. The workflow
transition can itself run once or twice when the revision reopens clarification.
The operation is completed only afterward. The database adapter guarantees
atomicity inside each repository transaction, not across the complete revision
unit. A failure after the document save can therefore leave a new current
document with a failed or incomplete operation state, a missing event, or a
filesystem snapshot mismatch.

# Failure clusters

## AUTHORITY FAILURE

**Symptoms:** provider operations say REMOVE while the candidate still contains
the semantic prohibition; the candidate contains both simulated success and the
prohibition; preservation can restore values the candidate omitted; the
provider candidate is treated as the base for current state.

**Common cause:** the provider owns two descriptions of the mutation: a full
canonical-looking `requirements` candidate and `revisionOperations`. The host
must infer which one is intended and then repair or reject the disagreement.

**Current patch status:** `validateProviderRevisionOperations` and the
`BRIEF_REVISION_REMOVE_NOT_APPLIED` guard correctly reject the unsafe example
before contradiction validation. This is an important safety boundary, not a
structural resolution.

**Architectural resolution:** the provider returns a `BriefChangeSet` only.
The current Brief is the sole state input, and the host reducer is the sole
mutation authority.

## STATE MODEL FAILURE

**Symptoms:** `successUx`, transmission, persistence, typed decisions,
`explicitExclusions`, and `prohibitedRequirements` can disagree; duplicate
requirements can be accepted and only discovered by a contradiction validator;
different arrays can express the same decision.

**Common cause:** scalar decisions and free-text policies are represented as
independent arrays and booleans rather than a discriminated semantic state.

**Current patch status:** `brief-validation.ts` adds bounded heuristics for
simulation, analytics, assets, route policy, and transmission. It does not make
the invalid state impossible and its text classifiers can disagree with
revision target resolution.

**Architectural resolution:** exclusive decisions become typed discriminated
unions or one-value-per-target maps. General requirements get stable semantic
IDs and explicit polarity. Invariants run on the reducer result, not on a
provider candidate that can contain multiple authorities.

## MODEL/HOST CONTRACT FAILURE

**Symptoms:** complete Brief revisions are large, omissions are interpreted as
changes, strict output is expensive, and the model must both retain unrelated
requirements and perform the requested mutation exactly.

**Common cause:** `BriefRevisionStructuredOutputSchema` extends the complete
Brief draft transport with `revisionOperations`. The prompt explicitly asks for
a complete replacement candidate and operations that are already reflected in
that candidate.

**Current patch status:** strict nullable transport fields, host-owned field
removal, context-capacity guards, and semantic checks reduce risk but preserve
the dual contract.

**Architectural resolution:** send the model the relevant current semantic state,
the full lossless user instruction, the allowed target/value catalog, and
bounded technical context. Return only a small typed ChangeSet or an explicit
clarification result.

## LEGACY COMPATIBILITY FAILURE

**Symptoms:** a V1 document can enter V2 logic through a provider-generated
candidate; preservation has separate legacy and structured field lists; history
and effective selection must understand both shapes; V1 and V2 checksums differ
because an implicit upgrade occurs at revision time.

**Common cause:** the compatibility reader remains inside the normal mutation
algorithm instead of at one migration edge.

**Current patch status:** tests prove that common V1-to-V2 revisions preserve
selected data, but the reducer remains responsible for legacy knowledge.

**Architectural resolution:** parse V1/V2 with read adapters, migrate once to
V3 at the revision boundary, and make the V3 reducer unaware of legacy fields.

## SEMANTIC IDENTITY FAILURE

**Symptoms:** operations target strings such as `FORM_SUCCESS_SIMULATION` or
quoted natural-language statements; `resolveTargetValues` combines exact text
matching with dimension heuristics and scans both existing and candidate
documents; history IDs are synthesized from statement text for legacy values.

**Common cause:** the system has entry IDs in some V2 arrays but no common target
namespace or host-issued target catalog for revision operations.

**Current patch status:** NFKC/lowercase/whitespace normalization and bounded
multilingual classifiers improve matching. They are not stable semantic
identity.

**Architectural resolution:** provider operations name host-issued semantic IDs;
text is evidence and display content, never the mutation key. Legacy text is
classified only by the migration adapter and ambiguous classification remains
explicitly unresolved.

## PRESERVATION AND NORMALIZATION FAILURE

**Symptoms:** `addMissingPreserved` copies selected V1 arrays and a few structured
arrays; nested V2 sections are not uniformly covered; same-dimension changes can
silence unrelated values; `unique` compares JSON shape rather than semantic ID;
deduplication is not a global canonical pass.

**Common cause:** the provider returns a replacement candidate, so the host must
reconstruct omitted state by merging old and new arrays.

**Current patch status:** the existing tests prove exact normalized duplicates can
be avoided in representative preserved arrays, but they also demonstrate that
preservation is an algorithm that must be maintained.

**Architectural resolution:** revisions are patches over current V3 state. An
untouched field remains untouched automatically. A normalization pass operates
on semantic IDs, rejects conflicting duplicates, unions trace references, and
sorts canonical collections deterministically.

## HISTORY / CURRENT-STATE FAILURE

**Symptoms:** historical removal is traceable, but current semantics depend on
the current document not re-emitting the old text; the same document carries
both active fields and history; generic context preparation strips history for
the provider, while revision code consults current and candidate text to rebuild
it.

**Common cause:** history is stored beside current state and its relationship to
active entries is textual rather than identity-based.

**Current patch status:** `getEffectiveBriefRequirements` correctly excludes the
history array itself, and the production trace confirms history is non-effective.
That does not prevent reactivation of a semantically equivalent statement.

**Architectural resolution:** current state plus ChangeSet produces the new
current state. Provenance is derived after reduction and stored separately. It
is never an input to current-state reduction or effective selection.

## VALIDATION ORDER FAILURE

**Symptoms:** a probabilistic candidate can reach multiple semantic stages before
being rejected; contradiction validation is meaningful only after a separate
REMOVE guard; lower-level tests can pass while provider transport or mapping is
wrong.

**Common cause:** the host is validating a generated full state rather than
validating a small typed intent and reducing it deterministically.

**Current patch status:** Lead now invokes semantic REMOVE verification before
`briefApprovalBlockers`. The guard is correct and must remain in V3.

**Architectural resolution:** currentness and provider DTO validation happen
before the provider when possible; ChangeSet validation, reduction,
normalization, and invariants happen before any persistence; contradiction
validation is an invariant, not a repair stage.

## IDEMPOTENCY / CURRENTNESS FAILURE

**Symptoms:** the prior project-scoped/stable revision identity caused a new
legitimate instruction against the same Brief to collide with a previous attempt.
The current head has corrected the top-level identity to
`brief-revision:v3:${projectId}:${fingerprint}`, where the digest includes
operation, project/version, Brief checksum, expected row version, normalized
reason, and sorted requirement keys. This fixes the observed collision class.

**Remaining structural cause:** reservation, provider work, domain persistence,
workflow transitions, and completion are still separate phases. A failed attempt
can be retryable, but an ambiguous failure after one side effect can leave an
operation state that does not describe the durable Brief. Process crashes also
need explicit handling for `IN_PROGRESS` reservations.

**Architectural resolution:** make operation identity a first-class subsystem,
reserve before provider work, validate currentness before provider work and
again at commit, and atomically commit the current Brief, provenance, workflow
event, and terminal operation result. A failed operation never owns a current
mutation.

## PERSISTENCE ATOMICITY FAILURE

**Symptoms:** document, memory, decision, workflow, and operation state can be
committed in different transactions; a revision can save a document and then
fail while reopening clarification or appending a decision.

**Common cause:** generic repository transactions are not composed into a single
revision transaction.

**Architectural resolution:** add one Brief Revision commit service over a single
database transaction. Filesystem memory becomes a post-commit projection with
checksum verification and repairable sync status, never a second canonical
authority.

## PROVIDER TRANSPORT FAILURE

**Symptoms:** strict OpenAI schema construction is sensitive to optional versus
nullable members; transport schemas are derived from Lead draft/domain contracts;
provider payload shape and canonical domain shape evolve together.

**Common cause:** the adapter is separate at runtime but the revision DTO still
embeds the full canonical candidate model.

**Architectural resolution:** define a small strict provider DTO independently of
the V3 domain model. Every object property is required; absent values are
explicitly nullable; unknown keys are rejected; host-owned fields are absent.

# Root architectural causes

1. The provider is permitted to author a full canonical replacement candidate.
2. Operation intent and candidate state are competing sources of truth.
3. The V1/V2 compatibility reader is also a mutation model.
4. Semantic identity is inferred from prose and dimensions instead of stable
   host-issued IDs.
5. Preservation is a copying algorithm because omission has ambiguous meaning.
6. Boolean/array combinations allow invalid state and depend on late validators.
7. History is colocated with current state and has no active-identity index.
8. Revision persistence is orchestrated across independent transaction calls.
9. Idempotency is better than the original implementation but is still attached
   to an orchestration sequence rather than a single commit protocol.

# Target architecture

```text
Workbench action
  -> currentness and attempt reservation
  -> current V3 Brief + allowed semantic target catalog
  -> LLM semantic interpretation
  -> strict BriefChangeSet DTO
  -> host target/value validation
  -> deterministic normalization
  -> deterministic reducer
  -> V3 invariant validation
  -> atomic current Brief + provenance + operation commit
  -> post-commit memory/projection sync
```

The model proposes semantic changes. The host owns the state transition. There
is no provider-authored full canonical candidate in the revision contract.

# Authority model

## Canonical authority

`CanonicalBriefV3.current` is the only current requirements authority. It is a
lossless, checksum-bound, host-validated document with one stable semantic ID for
every active extensible requirement and one typed value for every exclusive
decision.

The following are not current authority:

- browser projections or submitted checksums;
- raw revision text after it has been recorded as the user instruction;
- provider output after ChangeSet parsing;
- provider facts, recommendations, or a regenerated full Brief;
- `revisionOperations`-style duplicate descriptions;
- history/provenance records;
- filesystem memory snapshots;
- Lead in-memory draft caches;
- DB row payloads before checksum and currentness validation.

## LLM responsibility

The provider may:

- interpret the complete user revision instruction;
- select from host-supplied semantic target IDs;
- supply a new user-facing value or requirement text where interpretation is
  necessary;
- return explicit ambiguity, unsupported-target, or clarification requests;
- return only a strict, bounded `BriefChangeSet`.

The provider must not author project identity, project/version, row version,
checksums, approval, currentness, history status, workflow transitions,
idempotency state, persistence metadata, or an entire canonical current Brief.

## Host responsibility

The host owns target catalog construction, legacy migration, currentness,
operation identity, ChangeSet validation, reduction, normalization, semantic
IDs, invariants, provenance, checksums, approval readiness, persistence,
workflow transitions, retries, safe diagnostics, and projections.

# Canonical state model

V3 should use a discriminated model rather than extending the V1 object with
more optional arrays. A conceptual shape is:

```ts
type CanonicalBriefV3 = {
  schemaVersion: 3;
  project: { projectId: string; projectVersion: number };
  summary: string;
  content: Record<SemanticRequirementId, RequirementValue>;
  decisions: {
    form: FormBehaviorState;
    database: DatabaseMode;
    auth: AuthMode;
    analytics: AnalyticsMode;
    routePolicy: RoutePolicy;
  };
  assets: Record<SemanticRequirementId, AssetRequirement>;
  unresolved: UnresolvedRequirement[];
  approval: { status: "DRAFT" | "APPROVED"; ... };
};

type FormBehaviorState =
  | { formPresent: false; successMode: "NONE"; transmissionMode: "NONE"; persistenceMode: "NONE"; providerMode: "NONE" }
  | { formPresent: true; successMode: "SIMULATED"; transmissionMode: "NONE" | "EMAIL" | "API" | "OTHER"; persistenceMode: "NONE" | "DATABASE" | "OTHER"; providerMode: "NONE" | "APPROVED_PROVIDER" }
  | { formPresent: true; successMode: "REAL"; transmissionMode: "EMAIL" | "API" | "OTHER"; persistenceMode: "NONE" | "DATABASE" | "OTHER"; providerMode: "NONE" | "APPROVED_PROVIDER" };
```

The exact TypeScript type may be split into domain modules, but the invariant is
non-negotiable: a current form has one success mode and a real success cannot
have `transmissionMode: "NONE"`. Simulated success with no transmission is
valid. A prohibition of simulated success is represented as a policy/target
state that conflicts with `successMode: "SIMULATED"`, not as an independent
free-text array entry.

Other decisions should follow the same pattern: one database mode, one auth
mode, one analytics mode, one route policy, one replacement policy per asset,
and stable semantic IDs for extensible requirements. User-facing statements,
source references, and evidence remain lossless fields on those entries but do
not determine identity.

# BriefChangeSet

The provider contract should be a separate strict DTO, for example:

```ts
type BriefChangeSet = {
  contractVersion: 1;
  changes: Array<
    | { operation: "SET"; target: "form.successMode"; value: "NONE" | "SIMULATED" | "REAL" }
    | { operation: "SET"; target: "form.transmissionMode"; value: "NONE" | "EMAIL" | "API" | "OTHER" }
    | { operation: "UPSERT"; target: SemanticRequirementId; value: RequirementValue; sourceRefs: SourceRef[] }
    | { operation: "REMOVE"; target: SemanticRequirementId }
  >;
  unresolved: Array<{ target: string; reason: string }>;
};
```

This is illustrative, not a final public contract. The implementation must
derive target-specific value schemas from a host-owned catalog. The minimal
operation vocabulary is:

- `SET` for an exclusive decision or a scalar value;
- `UPSERT` for an extensible semantic requirement with a stable ID;
- `REMOVE` for an existing extensible target.

`ADD`, `UPDATE`, `REPLACE`, and `PRESERVE` should not remain separate canonical
operations. `SET` replaces a decision, `UPSERT` creates or updates a keyed item,
and `REMOVE` removes a keyed item. Preservation is the default behavior of a
patch and needs no operation. A compatibility parser may read old operation
names during migration, but it must immediately convert them to V3 operations
or reject an ambiguous mapping.

If semantic interpretation cannot produce a safe ChangeSet, the provider result
must be a distinct `NEEDS_CLARIFICATION` outcome. That outcome may update the
explicit clarification workflow through its own host-validated transition, but
it must not be represented as a missing provider draft that silently enters a
second mutation algorithm.

The host supplies the provider with the current relevant semantic state and an
allowed target/value catalog. A provider operation targeting an unknown ID,
using an unsupported value, duplicating a target with conflicting values, or
trying to write host metadata is rejected before reduction.

# Reducer

`reduceBrief(current, changeSet)` is a pure deterministic function:

1. Validate the ChangeSet contract and target catalog.
2. Normalize operation order, target IDs, source references, and repeated exact
   operations.
3. Reject conflicting writes to one target. Independent changes are applied in
   canonical target order.
4. Copy the current V3 state structurally.
5. Apply SET, UPSERT, and REMOVE to the named target only.
6. Leave every unmentioned target untouched.
7. Recompute derived decision fields from the resulting typed state.
8. Return a candidate that has not yet been persisted.

No operation reads history. No operation scans prose to find a target. No
preservation function copies old arrays into a provider candidate. A REMOVE
means the target is absent from the resulting active target index; for an
exclusive mode the ChangeSet uses an explicit typed `SET ... NONE` value where
absence would not be a valid state.

The reducer must reject an operation sequence that is ambiguous rather than
silently choosing a last-write-wins interpretation. Exact repeated SET/REMOVE
operations may normalize to one operation. A SET equal to current state is an
explicit no-op: it succeeds without changing the current checksum or creating
duplicate current entries, while its attempt remains replayable.

# Normalization

`normalizeBriefChangeSet` and `normalizeCanonicalBrief` must be deterministic
and idempotent:

```text
normalize(normalize(x)) === normalize(x)
```

The rules are:

- semantic IDs are canonicalized, not statement text;
- repeated exact operations collapse;
- conflicting operations for one target fail;
- source references are deduplicated and sorted;
- active requirement collections are keyed and sorted by semantic ID;
- equivalent values retain one canonical value and merged provenance;
- redundant REMOVE/SET no-ops are represented consistently;
- no provider array order changes current checksums;
- user-facing content is not lowercased or rewritten merely for identity.

The current `normalizeRequirementText` remains useful in a bounded legacy
adapter and display comparison, but it must not be a V3 mutation key.

# History

History should be a separate append-only `BriefRevisionHistory` document or
table. Each entry contains a host revision ID, project/version, prior and next
current checksums, ChangeSet checksum, target IDs, operation outcomes, and the
before/after semantic values needed for traceability. It may retain the old
user-facing statement and source references under the repository's safe
diagnostic/data policy.

The sequence is:

```text
current V3 + validated ChangeSet
  -> reduced current V3
  -> normalized current V3
  -> invariant validation
  -> derive provenance/history from before/after target states
```

History is never passed to the reducer as a current-state input, never included
in the current Brief checksum, and never exposed as an active requirement. A
removed or superseded item remains traceable by its semantic ID and revision
record, but it cannot return merely because a later provider response repeats
its wording.

# Legacy migration

Introduce one deterministic read/migration boundary:

```text
persisted V1 or V2 Brief
  -> readLegacyBrief()
  -> migrateBriefToV3()
  -> CanonicalBriefV3
```

`migrateBriefToV3` must be lossless for all canonical fields and explicit about
uncertainty. It assigns stable legacy IDs from a field namespace plus a
deterministic legacy identity, maps known typed V2 decisions into V3 unions,
and retains unmappable statements as generic unresolved/policy entries rather
than dropping them. Existing V1 prohibition text may be classified for a
migration hint, but the classifier is not allowed to silently change a current
decision when the mapping is ambiguous.

The normal V3 reducer must not import or branch on V1 field names. At the
revision boundary, V1 and V2 are read-compatible inputs only. New revisions
write V3. Existing consumers that still need V1/V2 receive a projection adapter
with an explicit loss/compatibility policy; there is no permanent dual-write
authority.

Read compatibility:

- persisted V1 Briefs;
- persisted V2 Briefs;
- existing `requirementHistory` entries;
- existing operation records and their status/payload hashes;
- old Workbench request fields and currentness values.

Write compatibility:

- new revisions write V3 current state and V3 provenance;
- old V1/V2 current documents are not rewritten by an unrelated read;
- once a V1/V2 document is revised, the new current representation is V3 and
  its migration provenance is recorded;
- old operation records remain replayable/readable, but new attempts use the
  V3 identity/version.

# Provider transport

The provider DTO must not be derived by extending `BriefDraftSchema` or
`ProjectBriefV2Schema`. Define it in the OpenAI adapter boundary with strict
objects and required nullable members where absence is allowed. It contains no
project ID, project version, timestamps, approval, checksum, row version,
history, workflow state, or persistence status.

The production adapter must continue to:

1. build the exact response format used by the client;
2. require every object property in the strict schema;
3. use `null` for absent optional semantic values;
4. reject unknown fields;
5. parse the provider DTO;
6. map it to the typed ChangeSet;
7. let the host bind all canonical metadata.

The provider call should receive the full lossless revision instruction, relevant
current semantic state, allowed target catalog, and bounded technical context.
It should not receive active history as an authority and should not need to
regenerate unrelated Brief sections. This reduces output tokens, omission risk,
schema failure surface, and accidental changes to unrelated SEO, asset, or
legal state.

# Idempotency/currentness

Treat this as a first-class `BriefRevisionAttempt` protocol.

The canonical attempt identity is the SHA-256 digest of a stable serialized
object containing:

```text
operation = REQUEST_BRIEF_CHANGES
contractVersion
projectId
projectVersion
currentBriefChecksum
expectedRowVersion
normalized revision instruction
sorted requirement keys / target hints
```

The persisted/logged key contains only a versioned prefix, project scope, and
digest. Raw revision text never appears in an idempotency key or diagnostic
identity. The current head's `briefRevisionOperationKey` already follows this
shape; V3 should keep the principle while making the attempt state explicit.

Required behavior:

| Situation | Required result |
| --- | --- |
| Exact duplicate while first attempt is running | One reservation owns provider work; the duplicate receives a typed in-progress conflict |
| Exact duplicate after success | Return the stored result without provider work or a second commit |
| Different legitimate revision against the same current Brief | Different digest; reserve and process independently |
| Failed provider/ChangeSet/reducer attempt | Mark FAILED, leave current state unchanged, and allow a later legitimate attempt |
| Exact retry after failure | Reopen the failed attempt or create an explicit retry attempt according to policy; never treat FAILED as success or permanent in-progress |
| Stale checksum, row version, or project version | Reject before provider work and again at commit; do not silently rebase |
| Concurrent different revisions against one Brief | Only the first commit wins currentness; the other fails stale at commit and cannot reach a second mutation |
| Process crash before commit | Transaction rollback leaves no current mutation; reservation recovery/lease makes a safe retry possible |
| Provider timeout/refusal | No current mutation; attempt is retryable under policy |
| Persistence failure or ambiguous commit | Commit protocol resolves the operation by transaction outcome/checksum; it never blindly applies a second mutation |

Currentness identity and attempt identity are related but distinct: currentness
decides whether the submitted Brief is still current; the digest decides whether
the submission is the same attempt as an earlier submission. A new instruction
against the same checksum must not collide merely because project identity is
the same.

# Persistence/atomicity

Add a Brief Revision commit boundary over the existing typed persistence
transaction. The final transaction should:

1. lock/read the current project and Brief;
2. verify project version, expected row version, and current Brief checksum;
3. verify the reserved attempt payload hash/status;
4. validate the already parsed ChangeSet/reduced V3 candidate;
5. write the new current Brief and provenance/history;
6. update the workflow state once, if the revision changes it;
7. append the workflow event and decision record;
8. mark the operation `SUCCEEDED` with the safe result;
9. commit all of the above or commit none of it.

Provider work must not hold a DB transaction open. Reservation occurs before
provider work; final commit uses a lease/owner or an equivalent status check.
`IN_PROGRESS` recovery must be explicit and time-bounded. Filesystem memory
snapshots are written after DB commit from the committed current document and
verified by checksum. They are a projection and may be resynchronized without
changing current semantics.

# Failure model

| Failure point | Current desired state | Attempt behavior |
| --- | --- | --- |
| Before provider request | Current Brief unchanged | Reservation may be FAILED/released; no provider result is persisted |
| Provider refusal/timeout | Current Brief unchanged | Safe provider error; retry policy may reopen the attempt |
| Invalid strict DTO | Current Brief unchanged | FAILED with bounded schema issue; no reducer or commit |
| Parsed ChangeSet with unknown target/value | Current Brief unchanged | FAILED semantic validation; no provider candidate repair |
| Before reducer | Current Brief unchanged | FAILED; no history |
| After reducer, before invariants | Current Brief unchanged | FAILED; reduced object is discarded |
| Contradictory/impossible V3 state | Current Brief unchanged | FAILED invariant result; no approval blocker is persisted as a mutation |
| Before atomic persistence transaction | Current Brief unchanged | Retryable failure; no terminal success |
| During transaction | All DB state rolled back | Retry resolves by operation status/transaction outcome |
| After DB commit before response | New current Brief and SUCCEEDED attempt | Exact retry replays stored result; no second provider call |
| Filesystem snapshot sync failure | DB remains authoritative and committed | Mark projection sync failure and repair post-commit; do not roll back canonical state through an unrelated write |
| Browser double click/stale tab | No unsafe mutation | In-progress conflict or stale currentness error |

# Certification suite

Create `npm run test:brief-revision:certify` only as a later implementation
phase. It must be an executable certification boundary, not a second production
implementation. It must cover:

- V3 schema and semantic target catalog;
- ChangeSet parsing, host-owned field rejection, and unknown target/value rejection;
- SET/UPSERT/REMOVE semantics and compatibility conversion of old operations;
- reducer determinism, locality, no hidden preservation, and no-op behavior;
- normalization idempotence and stable ordering/checksums;
- duplicate semantic IDs and conflicting duplicate rejection;
- impossible form/database/auth/analytics/route states;
- V1/V2 migration losslessness and ambiguous legacy mapping;
- historical removed/superseded requirements remaining traceable but inactive;
- exact, concurrent, different, failed, retried, and stale attempts;
- provider strict transport, nullable values, refusal, timeout, truncation, and
  host-owned field exclusion;
- production-reachable Workbench -> Trial Entry -> Lead -> provider fixture ->
  ChangeSet -> reducer -> commit scenarios;
- transaction rollback, write conflict, crash/ambiguous commit, and projection
  sync failure;
- deterministic fuzz/property tests over state, ChangeSet, operation order,
  legacy input, and currentness.

# Fault injection

The implementation must expose test-only fault points for:

1. provider before response;
2. invalid provider DTO;
3. after ChangeSet parse;
4. before reducer;
5. after reducer;
6. before atomic persistence;
7. during the DB transaction;
8. after DB commit before returning the result;
9. after DB commit before filesystem memory sync.

For each point, assert current Brief checksum, history count, workflow row
version/state, operation status, decision/event count, provider-call count, and
retry result. The fault suite must prove that no failure path can leave a new
current Brief paired with a FAILED operation or missing provenance.

# Golden scenarios

Use synthetic deterministic provider and persistence fixtures at the real
application boundary. The high-value scenarios are:

- normal V3 revision setting simulated success and transmission NONE;
- legacy V1 -> V3 migration -> revision with all untouched fields preserved;
- V2 -> V3 migration -> multi-domain revision;
- REMOVE of the old form-success prohibition plus SET of simulated success;
- provider ChangeSet contradicts its own target/value contract and is rejected;
- exact replay after success;
- failed provider attempt followed by a different legitimate revision;
- exact retry after a failed attempt;
- concurrent identical clicks and concurrent different revisions;
- stale checksum, stale row version, and stale browser tab after Brief mutation;
- no-op SET/REMOVE normalization;
- history containing removed content while current target index excludes it;
- operation order permutations yielding the same canonical result where changes
  are independent;
- persistence failure before and after commit with deterministic recovery.

# Phase 3A: Atomic revision transaction architecture

**Status: normative design only.** This section is the Phase 3A architecture
audit and handoff for the transaction boundary. It does not implement a
transaction, migration, schema change, workflow change, provider change, or
production switch. The protected pilot remains outside the write scope.

## Decision: extend the transaction seam

The V3 revision domain remains a controlled **REBUILD** of the mutation model,
but the persistence decision is **EXTEND**:

- reuse the existing typed `PersistenceDatabase`, Postgres transaction
  wrapper, row versions, checksums, RLS boundary, repositories, and fake;
- add a dedicated V3 attempt/history protocol, current-document CAS, and one
  typed atomic revision commit operation;
- retain generic idempotency storage for unrelated existing operations, but do
  not reuse its current JSON lifecycle as the V3 protocol; and
- do not redesign Factory persistence or add a service/microservice boundary.

This is the smallest owning boundary because the existing database transaction
already provides `BEGIN`/`COMMIT`/`ROLLBACK` and the project row update already
has optimistic row-version behavior. The missing guarantee is the unit of work
that joins those primitives for one Brief revision.

## Audit of the current boundary

The actual current path is Workbench -> Trial Entry -> operation reservation ->
Lead provider -> document save -> memory snapshot -> workflow transition ->
decision/event append -> operation completion. The audit found:

| Boundary | Current behavior | Phase 3A implication |
| --- | --- | --- |
| Operation | `reserve`, `complete`, and `fail` are separate transactions; `FAILED` can be reopened without a typed lease | Add a V3 attempt record with owner, expiry, attempts, and terminal states |
| Provider | Correctly outside the DB transaction, but the host has no durable pending/lease protocol | Reserve before the call; final commit after the call; recover expired leases |
| Currentness | Pre-provider project/checksum/row checks are repeated after provider work, but the document upsert has no expected checksum/row-version CAS | Capture one token and compare it again in the final locked transaction |
| Document | `DocumentRepository.save` can upsert and increment document row version independently | Add V3 current-document CAS inside the revision transaction |
| Workflow | Transition(s) run independently; a clarification reopen can expose two commits | Compute one final revision state and commit it with the document/event/decision |
| History | V3 provenance is derived in memory but has no dedicated append-only persistence row | Add one history row linked to the committed attempt |
| Decision/event | Each can be absent after a document-only success | Write both in the same final DB transaction |
| Project Memory | Filesystem sync is atomic only within its own files and is outside DB commit; no revision-specific durable sync status exists | Treat memory as derived post-commit work with a durable repair signal |
| Checksums | `workflow_documents.checksum` is used by the revision path; `project_versions.requirements_checksum` is a compatibility/denormalized field and is not clearly updated by the current document save | Select one V3 authority and update any compatibility mirror in the same write set |
| Fake DB | Snapshot rollback exists, but realistic transaction isolation, lock races, and fault points do not | Extend the fake only in Phase 3B for the certification boundary |

The present design can therefore save a new current document and then fail
before workflow, decision, memory, or operation completion. A pre-provider
currentness check alone cannot prevent two provider results from both passing
and one document save from occurring before a later workflow CAS fails.

## Canonical tokens and identities

### Revision currentness token

The host binds a `RevisionCurrentnessToken` before reservation:

```text
projectId
projectVersion
projectRowVersion
workflowState
briefChecksum
briefDocumentRowVersion
canonicalSchemaVersion
```

The token is an opaque canonical serialization, not a browser assertion. It is
read from authoritative persistence, checked before provider work, and checked
again in the final transaction. The final transaction also locks the project
and current document and uses explicit CAS predicates. The project row version
catches workflow/head changes; document row version/checksum catches a
document-only writer; project/version prevents a cross-version write.

For V3, `workflow_documents` is the current Brief checksum authority. If
legacy consumers still read `project_versions.requirements_checksum`, it is a
denormalized mirror updated and checked in the same transaction. It must not be
allowed to become an independently writable second authority.

### Operation identity

The operation identity is a stable serialization of:

```text
operation = REQUEST_BRIEF_CHANGES_V3
contractVersion
projectId
projectVersion
RevisionCurrentnessToken
normalized revision instruction
sorted target hints / requirement keys
```

Its SHA-256 digest forms a versioned project-scoped idempotency key. Raw reason
text, prompts, provider responses, secrets, and source paths do not appear in
the key or safe diagnostics. The provider ChangeSet is deliberately absent:
it is an output of this operation, not part of request identity.

This gives the required distinctions:

- exact same instruction against the same current token: one operation and
  exact replay;
- different legitimate instruction against the same current Brief: distinct
  operation and independent reservation; and
- same instruction against a changed Brief/token: a new identity that is still
  rejected as stale if the submitted token no longer matches the current head.

## Attempt state machine

The V3 attempt record is separate from the existing generic operation result
adapter. Its persisted states are:

| State | Meaning | Retry/replay behavior |
| --- | --- | --- |
| `RESERVED` | Reservation exists; provider ownership is not yet active | Claim with a lease |
| `PROVIDER_PENDING` | One owner may perform provider work until expiry | Another live owner gets `IN_PROGRESS_DUPLICATE`; expired owner is recoverable |
| `COMMITTED` | The complete DB write set committed | Return the stored safe result; never call provider again |
| `FAILED_RETRYABLE` | Provider/transport/known DB failure; canonical state unchanged | Reclaim same logical operation with incremented attempt count |
| `REJECTED_INVALID` | Invalid ChangeSet, reduction, or invariant; canonical state unchanged | Replay rejection; changed input is required |
| `REJECTED_STALE` | Pre-provider or final currentness failed; canonical state unchanged | Replay stale result; refresh, never silent rebase |

The row contains operation key, payload hash, project/version, serialized
currentness token, lease owner and expiry, attempt count, timestamps, safe
failure code, committed checksum, history reference, and safe replay result.
The `VALIDATED` phase is in-memory only: parsed ChangeSet and reduced
candidate are not a second durable authority before commit. Terminal states are
immutable. A live duplicate never starts a second provider call.

## Provider-outside-transaction protocol

The implementation sequence is:

1. Read the authoritative current project/document and construct the token and
   operation identity.
2. Reserve the attempt in a short transaction. A live existing attempt returns
   an in-progress conflict; `COMMITTED` returns its safe replay envelope.
3. Claim a bounded provider lease and call the provider with no DB transaction
   held.
4. Parse the strict provider DTO, normalize the ChangeSet, reduce it from the
   captured canonical current Brief, derive history, and run all invariants in
   memory.
5. Open the final short transaction, lock the project/current document, verify
   the attempt owner/status/hash and every token field, and apply the atomic
   write set below.
6. Commit. Only after commit, project the committed document to Project Memory
   and reconcile by checksum.

If the process dies after provider work but before step 5, no canonical Brief
mutation exists. The lease expires and a retry may call the provider again. A
provider idempotency key may reduce duplicate external work, but it is not a
replacement for the host attempt record or final CAS.

## Atomic write set

The final transaction must lock/read and then write all of these relational
records, or none of them:

1. the reserved attempt row, verifying owner, lease, operation key, and payload
   hash;
2. the V3 current requirements document, with expected checksum/document row
   version and project/version predicates;
3. the `project_versions.requirements_checksum` compatibility mirror, while it
   remains in use;
4. one append-only V3 history row with previous/current checksums, ChangeSet
   checksum, revision reference, target entries, and outcomes;
5. the project workflow state and project row version, once, to the final
   revision target state, plus any persisted approval/readiness fields that
   determine that state;
6. workflow event record(s) carrying the operation/revision reference;
7. the typed decision record carrying the operation/revision reference;
8. attempt status `COMMITTED` and a safe replay envelope containing project,
   version, workflow state, current Brief checksum, and history reference; and
9. a durable Project Memory sync job/status row, if introduced in Phase 3B,
   initialized as `PENDING`.

The document checksum is the current-state authority; history is audit and
provenance, not an effective-state calculator. The operation result is a safe
replay projection, not a provider payload. A final CAS failure can persist only
the attempt's `REJECTED_STALE` outcome in a transaction with no canonical
mutation.

The current workflow engine does not expose every clarification reopen as one
direct transition. Phase 3B must add a revision-specific transition planner or
transaction method that validates and writes the final state without an
intermediate externally visible commit. If multiple logical workflow events
are required, they must be appended under the same transaction; the project
head cannot be committed between them.

## Formal idempotency and currentness scenarios

| # | Scenario | Required outcome |
| ---: | --- | --- |
| 1 | Exact duplicate while first attempt runs | One provider owner; duplicate gets `IN_PROGRESS_DUPLICATE`; zero second provider calls |
| 2 | Exact retry after success | `COMMITTED_REPLAY`, stored checksum/result, no provider or mutation |
| 3 | Provider transport failure/timeout | `FAILED_RETRYABLE`, unchanged current state; exact retry may call provider again |
| 4 | Provider refusal | `FAILED_RETRYABLE`; no mutation; exact retry reclaims the same operation and calls the provider again |
| 5 | Invalid strict DTO/unknown target | `REJECTED_INVALID`; no history/current change; replay rejection |
| 6 | Reducer or invariant rejection | `REJECTED_INVALID`; no history/current change; replay rejection |
| 7 | Known DB failure before final commit | Rollback/no mutation; persist `FAILED_RETRYABLE` when the status write is known to commit, otherwise recover the expired lease; exact retry reclaims the same operation and may call the provider again |
| 8 | Different revision against same current Brief | Distinct identity; each may call provider; only one final CAS can win |
| 9 | Failed attempt A followed by different B | B is independent and may succeed; A does not poison B |
| 10 | Stale checksum/row/version before provider | `REJECTED_STALE`; provider is not called |
| 11 | Concurrent different revisions | First final CAS wins; loser is `REJECTED_STALE`; loser cannot write document/history/event |
| 12 | Response lost after commit | Lookup by operation key returns `COMMITTED`; no second provider/mutation |
| 13 | Crash after commit before response | Same as #12; operation row is authoritative |
| 14 | Crash after provider/reduction before final DB transaction | No canonical mutation; lease recovery may repeat provider |
| 15 | Crash during final DB transaction | Database is all committed or all rolled back; retry resolves by attempt row |
| 16 | Ambiguous network/`COMMIT` outcome | Query operation row and committed checksum/history; replay if committed, recover lease if not; never assume rollback or blindly reapply |

Different revisions do not need to be serialized during provider work. They
must be serialized at the final currentness boundary. There is no silent
rebase: a losing result is discarded and the operator refreshes against the
new current Brief.

## Failure taxonomy and retry contract

The safe external categories are:

```text
IN_PROGRESS_DUPLICATE
COMMITTED
COMMITTED_REPLAY
STALE_BEFORE_PROVIDER
STALE_BEFORE_COMMIT
PROVIDER_FAILED
PROVIDER_REFUSED
PROVIDER_INVALID_OUTPUT
CHANGESET_INVALID
REDUCTION_FAILED
INVARIANT_FAILED
PERSISTENCE_FAILED
```

`PROVIDER_FAILED`, `PROVIDER_REFUSED`, and known `PERSISTENCE_FAILED` leave the
current state unchanged and are `FAILED_RETRYABLE`; an exact retry reclaims
the same operation and calls the provider again. If the process cannot record
that status because the status transaction is unavailable, lease expiry is
the recovery path and the next exact retry makes the same decision from the
authoritative attempt row.
Invalid output, reduction, and invariant categories are deterministic
terminal rejection for the exact operation. Stale categories are terminal for
the exact token and require a fresh browser projection. `COMMITTED_REPLAY` is
success, not a provider retry.

## Crash boundaries A-O

| Point | Boundary | Required durable state |
| --- | --- | --- |
| A | Before reservation | No attempt is required; the request can reserve normally |
| B | After reservation, before provider | `RESERVED`/recoverable lease; no canonical mutation |
| C | Provider running | `PROVIDER_PENDING` with owner/expiry; no DB transaction held |
| D | Provider response before parse | Pending or retryable failure; no canonical mutation |
| E | Valid ChangeSet before reduction | In-memory only; retry may call provider again |
| F | Reduced candidate before invariants/final tx | In-memory only; retry may call provider again |
| G | Final transaction begins before CAS | Locks held only briefly; no visible mutation if CAS fails |
| H | After CAS before document write | Rollback leaves prior current Brief and all related rows unchanged |
| I | After document write before history | Rollback removes document write; no partial current state |
| J | After history before workflow | Rollback removes both current document and history |
| K | After workflow/decision/event before attempt terminal state | Rollback removes the entire canonical write set |
| L | All writes complete before `COMMIT` | Database atomically commits all or rolls back all |
| M | DB commit before Project Memory sync | DB/`COMMITTED` attempt is authoritative; sync remains pending |
| N | Project Memory sync before HTTP response | Replayed DB result remains authoritative even if response is lost |
| O | Commit succeeded but network is ambiguous | Query operation row; replay committed result or recover expired pending lease |

Fault injection must assert at each point: current Brief checksum, history
count, project workflow state/row version, attempt state, decision/event count,
provider-call count, memory sync status, and exact retry result.

## Concurrency, CAS, and ambiguous commit

The final transaction uses a project lock plus explicit CAS rather than relying
on an earlier read. The attempt row is checked for matching operation key,
payload hash, active owner, and lease. The current document is checked for
project/version, checksum, schema version, and document row version. The
project head is checked for project row version and workflow state.

For identical concurrent clicks, the first reservation owns provider work and
the second observes the active attempt. For different revisions, provider work
may overlap, but only the transaction whose token still matches may write. The
loser records `REJECTED_STALE` without writing a document, history, workflow,
decision, or memory snapshot.

An uncertain database response is not interpreted locally. The service queries
the attempt by its operation key and, when committed, verifies the stored
current checksum/history reference. `COMMITTED` means replay; an uncommitted
expired lease means recover/retry; an active lease means in progress. No
blind second mutation is allowed.

## Schema suitability and additive Phase 3B shape

The existing schema is suitable to **extend**, not to reuse unchanged and not
to replace wholesale. The planned additive shape is:

- `brief_revision_attempts`: unique operation key, payload hash, project/version,
  currentness token, typed status, lease owner/expiry, attempt count, safe
  result, committed checksum/history reference, failure code, timestamps;
- `brief_revision_history`: append-only revision/attempt reference,
  project/version, previous/current/ChangeSet checksums, typed derived entries,
  timestamp, and uniqueness for one committed attempt;
- a small durable memory projection status/job table keyed by committed
  revision, with `PENDING`/`SYNCED`/`FAILED_RETRYABLE`, checksum, safe failure
  code, and retry metadata; and
- typed transaction-port support for reservation/lease, current document CAS,
  and `commitBriefRevision`, with equivalent fake and Postgres behavior.

The existing generic `idempotency_records` table remains for compatibility and
unrelated operations. Existing `workflow_events` and `decision_records` need
an operation/revision reference or equivalent safe uniqueness link so replay
and audit can prove one event/decision per committed attempt. No migration is
created in Phase 3A.

## Compatibility and migration

Legacy V1/V2 documents are read through deterministic adapters and migrated in
memory to V3 before provider work. A V3 commit writes one canonical V3 current
document and one V3 history row. During the bounded rollout, old readers may
receive a projection adapter, but there is no permanent V2+V3 dual write and
no two competing current checksums.

Phase 3B must prove lossless migration, explicit handling of ambiguous legacy
semantics, and current-document CAS. Phase 4 switches the Workbench -> Trial
Entry -> Lead path in one bounded production migration. After certification,
the V2 mutation/merge/preservation path is deleted; only compatibility readers
remain until their consumers are migrated.

## Explicit invariants

The implementation and certification suite must enforce:

1. The database current V3 document is the only current Brief authority.
2. The provider can propose only a ChangeSet and cannot persist canonical state.
3. A `COMMITTED` attempt has exactly one current document write, one linked
   history row, its workflow event/decision, and a safe terminal result.
4. No `FAILED_RETRYABLE`, `REJECTED_INVALID`, or `REJECTED_STALE` attempt has a
   document/history/workflow/decision mutation from that attempt.
5. Exact replay never calls the provider or creates a second canonical write.
6. Currentness is checked before provider work and again at final commit.
7. Concurrent different revisions cannot both win the same current head.
8. There is no silent stale rebase.
9. History is append-only provenance and never determines effective current
   state.
10. Project Memory is derived, checksum-verified, and repairable after commit.
11. A database failure produces all-or-none canonical persistence.
12. V1/V2 compatibility is read/migration support, not a competing write
   authority.
13. Operation terminal states are safe to query after response loss or
   ambiguous commit.
14. No production code, migration, pilot state, or V2 path changes belong in
   this Phase 3A documentation task.

## Fault injection and certification plan

Phase 3B should use test-only hooks around provider transport, DTO parsing,
ChangeSet normalization, reduction, invariant validation, final transaction
begin/CAS/document/history/workflow/terminal writes, DB commit response, and
Project Memory sync. The fake database must model concurrent final CAS and
rollback; Postgres query/transaction contract tests must cover the same write
set.

Certification must include the sixteen scenarios above, all A-O crash points,
exact replay, failed retry, different concurrent revisions, stale pre-provider
and stale final commit, known rollback, ambiguous commit recovery, no-op
normalization, history/current separation, V1/V2 migration, provider refusal,
invalid output, and projection repair. It must run at the production-reachable
Workbench -> Trial Entry -> Lead boundary with synthetic fixtures and must not
use the protected pilot as a debugging harness.

## Phase 4 production switch and V2 deletion

The production switch is not a shadow or permanent dual-write rollout:

1. Phase 3B implements the dedicated attempt/history rows, commit service,
   leases, CAS, projection status, and fault tests.
2. Phase 3C runs the full certification and independent review, including
   protected-state comparison and ambiguous-commit recovery.
3. Phase 4 switches Workbench -> Trial Entry -> Lead to V3 in one bounded
   mutation path while keeping only deterministic V1/V2 read adapters.
4. Existing projects are read/reconciled under the new authority; no manual
   pilot repair or arbitrary SQL is permitted.
5. After the evidence gate, delete V2 full-candidate merge, preservation
   rehydration, text mutation authority, and permanent dual-write code.

The switch is complete only when the old mutation path is unreachable and the
new path has no second current-state authority.

# Migration phases

1. **Freeze the target contract.** Approve the V3 authority model, semantic ID
   namespace, transaction requirements, and compatibility guarantees. Do not
   change the pilot.
2. **Introduce V3 read types and migration adapters.** Add deterministic V1/V2
   readers and lossless migration fixtures without changing the current write
   path.
3. **Implement ChangeSet, target catalog, normalization, reducer, invariants,
   and history derivation in isolation.** Certify properties before integration.
4. **Implement the strict provider DTO and adapter.** Replace full-candidate
   revision output with ChangeSet output; keep provider transport separate from
   V3 domain types.
5. **Introduce the atomic revision commit service and attempt protocol.** Add
   transaction/fault-injection tests using the fake database and Postgres query
   contract tests where applicable.
6. **Switch the production Workbench -> Trial Entry -> Lead revision path in one
   bounded migration.** Keep V1/V2 as read adapters and do not dual-write
   competing current authorities.
7. **Run certification, production-like golden scenarios, fault injection,
   provider contract checks, synthetic live-provider acceptance if transport is
   involved, and independent adversarial review.**
8. **Remove obsolete V2 revision mutation code.** Delete full-candidate merge,
   preservation rehydration, text mutation target resolution, and history-based
   effective selection only after all new-path evidence is green.
9. **Accept the synthetic pilot gate.** The real pilot can be considered only
   after all acceptance criteria below pass; it remains an acceptance test, not a
   debugging harness.

# Code deletion/replacement map

## KEEP

- `src/app/api/workbench/route.ts` as the bounded HTTP envelope;
- `src/runtime/workbench/application.ts` as action coordination and projection
  delegation;
- `src/runtime/workbench/contracts.ts` currentness/request boundary, with a
  future contract-versioned revision request;
- generic `PersistenceDatabase`, Postgres/fake transaction adapters, checksum
  serialization, safe diagnostics, and protected-state tooling;
- `ProjectRepository` and generic document/repository validation where their
  ownership remains correct;
- lossless canonical-input byte policy;
- deterministic provider fixtures and production-path test harness structure.

## REPLACE

- `src/domain/requirements/schema.ts` revision-facing V1/V2 union behavior with
  a V3 canonical schema plus compatibility readers;
- `src/domain/requirements/revision.ts` with `changeset.ts`, `targets.ts`,
  `normalize.ts`, `reducer.ts`, `invariants.ts`, and `history.ts` (the names are
  a design direction, not a required exact layout);
- `src/domain/requirements/effective.ts` with a direct current-state reader and
  a separate history reader; current state must not be calculated by deleting a
  history array;
- `src/domain/requirements/brief-validation.ts` heuristic contradiction checks
  with V3 invariant validation and typed cross-field rules;
- `LeadAgentService.requestBriefRevision` and `mergeRevisionRequirements` with
  a provider-result -> ChangeSet -> reducer -> atomic commit flow;
- `BriefRevisionProviderInput` and OpenAI revision DTOs with a bounded semantic
  context and strict ChangeSet transport;
- `src/runtime/trial-entry/idempotency.ts` with a versioned attempt protocol
  and explicit lease/commit semantics, retaining the current digest principle;
- independent revision saves/transitions with one Brief Revision commit service.

## DELETE

After compatibility and certification gates pass, delete from the production
mutation path:

- `mergeRevisionRequirements` full-candidate merge semantics;
- `addMissingPreserved` and all preservation rehydration lists;
- `removeTarget` as a text mutation primitive;
- `resolveTargetValues` and dimension-based target inference;
- `requirementDimensionForText` and `isSimulationProhibitionRequirement` as
  mutation authorities;
- `getEffectiveBriefRequirements` as a history-stripping effective merge;
- canonical `PRESERVE`, `ADD`, `UPDATE`, and `REPLACE` operation meanings;
- `BriefRevisionStructuredOutputSchema` as a full candidate plus operation list;
- candidate-state diagnostics that report provider state as a second authority.

## TEMPORARY COMPATIBILITY

- `RequirementSpecificationSchema` V1/V2 parsing;
- deterministic V1/V2 -> V3 migration and V3 -> bounded legacy projections;
- legacy `requirementHistory` read conversion;
- old operation-name parsing into V3 operations when identity is unambiguous;
- existing Workbench `reason`, `briefChecksum`, `projectVersion`, and
  `expectedRowVersion` request fields;
- existing persisted idempotency statuses and safe replay result adapters.

# Risks

- V1/V2 migration can expose previously implicit or contradictory semantics;
  ambiguous mappings must become explicit unresolved requirements, not guessed
  decisions.
- A V3 write boundary changes document schema/checksum behavior and needs a
  controlled reader rollout and protected-state comparison.
- A single atomic commit service may require extending the typed persistence
  transaction interface and Postgres/fake implementations.
- Existing downstream consumers import `RequirementSpecificationSchema`; their
  migration must be staged and checked for accidental V1/V2 authority leakage.
- Removing preservation can reveal provider omissions that were previously
  hidden. That is intended: unmentioned state is preserved by the reducer, while
  an explicit ChangeSet omission is not a hidden mutation.
- Stable semantic IDs need a reviewed namespace and migration collision policy.
- Provider context becomes smaller but target-catalog quality becomes more
  important; unknown or ambiguous targets must fail safely or request
  clarification.

# Acceptance criteria

The V3 replacement is acceptable only when all of the following hold:

1. A provider cannot author or persist a full canonical current Brief.
2. The host has one current-state authority and a deterministic reducer.
3. Untouched canonical state survives automatically without preservation copies.
4. REMOVE/SET operations use stable semantic IDs and never depend on text
   matching for mutation authority.
5. Removed or superseded history is traceable and never effective.
6. Equivalent active requirements are normalized by semantic ID; conflicting
   duplicates fail before persistence.
7. Form success/transmission and other exclusive decisions cannot enter known
   contradictory states through the V3 model.
8. Invalid ChangeSets, contradictions, stale requests, and provider failures
   leave the current Brief unchanged.
9. Exact duplicate success replays, concurrent identical requests are protected,
   different revisions against the same current Brief are independent, failed
   attempts do not poison later attempts, and stale attempts are rejected.
10. Current Brief, history, workflow event, decision, and terminal operation
    state commit atomically.
11. V1/V2 persisted documents remain readable and migrate losslessly at the
    revision boundary.
12. The certification, golden-scenario, fault-injection, provider-contract,
    typecheck, lint, test, build, protected-state, and independent-review gates
    are green, including `npm run codex:affected -- --run`,
    `npm run codex:verify`, and `npm run codex:review-context` for the bounded
    handoff.

# Adversarial review checklist

The independent review must attempt to make the design fail by checking:

- a removed prohibition reappearing under different wording or a different
  legacy field;
- history being passed into target resolution or treated as active state;
- a provider returning both a ChangeSet and an untrusted candidate;
- duplicate semantic IDs with equivalent and conflicting values;
- stale requests reaching provider work;
- different revisions colliding in idempotency storage;
- a failed attempt poisoning a later attempt or an `IN_PROGRESS` lease forever;
- partial DB/filesystem/workflow/decision persistence;
- V1 fields bypassing the migration adapter;
- operation order changing an otherwise independent result;
- no-op and repeated operations changing checksums unexpectedly;
- an unknown target or host-owned field entering the provider DTO;
- currentness being checked only before provider work and not at commit.

The review result must identify blockers with file/symbol evidence and concrete
repair guidance. A passing test command alone is not sufficient evidence.

# Exact recommended next implementation phase

**Phase 3B: implement and certify the atomic V3 revision commit boundary.**
Add the dedicated attempt/history records, lease and terminal-state protocol,
current-document CAS, typed `commitBriefRevision` transaction, durable
post-commit memory sync status, and fake/Postgres fault-injection coverage
described in the Phase 3A section and ADR 0002. Keep the provider call outside
the transaction and keep the protected pilot read-only.

Do not begin with another candidate guard or a partial V2/V3 dual write. The
atomic service must first prove exact replay, failed retry, stale rejection,
concurrent different revisions, rollback, ambiguous commit recovery, complete
write-set atomicity, and projection repair. Only after Phase 3C certification
and independent review may Phase 4 switch the production path and delete the
obsolete V2 mutation code.
