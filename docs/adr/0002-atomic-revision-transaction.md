# ADR 0002: Atomic Brief Revision V3 transaction

- Status: Proposed design for Phase 3A; not an implementation authorization
- Date: 2026-08-16
- Scope: Brief Revision V3 persistence and orchestration boundary
- Protected state: the protected pilot was inspected read-only and is outside
  the change set

## Context

The V3 domain replacement makes the host the sole authority for the current
Brief: the provider returns a typed `BriefChangeSet`, the host reduces it from
the current canonical Brief, derives provenance, and persists the result. The
current production path does not yet have one transaction for that revision
unit.

The relevant path is Workbench -> Trial Entry -> operation reservation -> Lead
provider call -> document save -> memory snapshot -> workflow transition ->
decision/event append -> operation completion. The following boundaries are
currently separate:

- `OperationRepository.reserve`, `DocumentRepository.save`, workflow
  transitions, decisions, and operation completion each open their own
  database transaction;
- provider work occurs outside the database, as it must, but there is no
  durable attempt lease and commit protocol around it;
- the document upsert has no expected document checksum/row-version compare;
- the currentness check before the provider call is not sufficient to protect
  the later document save;
- a clarification reopen can perform two externally visible workflow
  transitions;
- Project Memory is an atomic filesystem projection, but filesystem rename is
  not part of the database transaction and there is currently no durable
  revision-specific projection job/status;
- the generic `idempotency_records` JSON result has no typed V3 lifecycle,
  lease, committed revision reference, or terminal failure semantics; and
- the database has no dedicated V3 append-only revision history row.

Therefore a crash or concurrent writer can produce a saved document without
provenance, an incomplete operation record, a workflow/document mismatch, or a
filesystem snapshot that disagrees with the database.

## Decision

### 1. Extend the persistence boundary; do not redesign the database

The transaction architecture decision is **EXTEND**:

- reuse the existing typed `PersistenceDatabase`, Postgres `BEGIN`/`COMMIT`/
  `ROLLBACK`, row versions, checksums, RLS boundary, and in-memory fake;
- add a typed V3 attempt protocol, append-only history, document CAS, and one
  atomic `commitBriefRevision` transaction operation;
- retain the generic idempotency repository for existing operations, but do
  not reuse its current `IN_PROGRESS`/`SUCCEEDED`/`FAILED` JSON semantics as
  the V3 protocol; and
- do not redesign the Factory persistence layer or introduce a second service.

The V3 domain itself remains the previously selected controlled **REBUILD** of
the revision mutation model. This ADR does not authorize implementation,
migrations, or a production-path switch.

### 2. Provider work is outside the database transaction

The protocol has short database phases and an external provider phase:

```text
read current head and derive identity
  -> reserve/lease attempt in a short transaction
  -> provider call with no DB transaction held
  -> parse ChangeSet, reduce, normalize, validate in memory
  -> final short transaction: lock + CAS + all canonical writes
  -> COMMIT or ROLLBACK
  -> post-commit Project Memory projection/reconciliation
```

The provider never receives authority to write a document, history, workflow,
decision, operation, or memory record. Raw provider output is not persisted as
canonical state. If the process dies after reduction but before the final
transaction, the canonical database remains unchanged and a retry may call
the provider again after the lease is recovered.

### 3. Currentness is one compare-and-swap token

The host creates an opaque, canonical `RevisionCurrentnessToken` containing:

```text
projectId
projectVersion
projectRowVersion
workflowState
briefChecksum
briefDocumentRowVersion
canonicalSchemaVersion
```

The token is captured before reservation, checked before provider work, and
checked again in the final transaction. The final transaction locks the
project/current document and also uses explicit row-version/checksum CAS
predicates. A project row-version catches workflow or other project-head
changes; the document row-version/checksum catches document-only changes; the
project/version pair prevents a revision from crossing versions.

`workflow_documents` is the V3 current checksum authority. The existing
`project_versions.requirements_checksum` is a denormalized compatibility field;
while consumers still require it, it must be updated in the same final
transaction and checked against the document. It must not become a second
independently writable currentness authority.

### 4. Attempt identity and lifecycle are explicit

The stable operation identity is a canonical serialization of:

```text
operation = REQUEST_BRIEF_CHANGES_V3
contractVersion
projectId
projectVersion
RevisionCurrentnessToken
normalized revision instruction
sorted target hints / requirement keys
```

Its SHA-256 digest is used in a versioned, project-scoped key. Raw reason text,
provider output, prompts, and secrets do not appear in the key or safe
diagnostics. The ChangeSet is not part of identity: provider output is a
result, not a way to create a second request identity.

The dedicated V3 attempt record has these states:

| State | Meaning | Exact retry |
| --- | --- | --- |
| `RESERVED` | Reservation exists; no provider owner has started or the owner is being recovered | Claim the lease safely |
| `PROVIDER_PENDING` | One owner may perform provider work until its lease expires | Return in-progress for another live owner; recover only after expiry |
| `COMMITTED` | Current Brief, history, workflow, decision/event, and safe result committed together | Replay the stored result; no provider or mutation |
| `FAILED_RETRYABLE` | No canonical mutation; provider/DB failure may be retried | Reopen/claim the same logical operation with a new attempt count |
| `REJECTED_INVALID` | ChangeSet, reduction, or invariant failed deterministically; no mutation | Replay the rejection; require changed input/provider contract to proceed |
| `REJECTED_STALE` | Currentness failed before provider or at final CAS; no mutation | Replay the stale result; refresh rather than rebase silently |

The record includes the operation key, payload hash, currentness token,
lease owner/expiry, attempt count, timestamps, failure code, committed Brief
checksum, history reference, and a safe replay envelope. It never stores a raw
provider prompt or untrusted full provider candidate. `COMMITTED`,
`REJECTED_INVALID`, and `REJECTED_STALE` are terminal. An active duplicate
does not start a second provider call.

### 5. The final write set is atomic

The typed transaction operation must lock/read and then write, in one database
transaction:

1. the reserved V3 attempt status/lease and its payload hash;
2. the current V3 requirements document, guarded by the currentness token and
   document CAS;
3. the denormalized project-version checksum, if still present for compatible
   readers;
4. one append-only `brief_revision_history` row containing previous/current
   checksums, ChangeSet checksum, revision reference, and derived entries;
5. the project workflow state and project row version, once, to the final
   state, plus any persisted approval/readiness fields that determine that
   state;
6. the corresponding workflow event(s), with the operation/revision reference;
7. the typed decision record, with the operation/revision reference;
8. the attempt state `COMMITTED` and safe replay result; and
9. a durable post-commit Project Memory sync job/status row, if that additive
   status table is introduced by Phase 3B.

All canonical rows above commit or none commit. Filesystem writes, browser
projection updates, in-process caches, and the provider call are not in this
write set. A stale final CAS may commit only the attempt's `REJECTED_STALE`
status; it may not write a new document, history, workflow, or decision.

The current workflow engine does not expose every desired reopen as one direct
transition. Phase 3B must therefore add a revision-specific transition
planner/transaction method that validates the final target state and writes no
intermediate externally visible state. If audit policy requires multiple
logical events, they may be appended inside the same transaction, but the
project head cannot be committed between them.

### 6. Project Memory is derived and repairable

After database commit, the service reads the committed canonical document and
writes Project Memory through the existing atomic filesystem sync port. It
verifies checksums against the database. A sync failure cannot roll back the
committed Brief by issuing an unrelated database write.

Because the current source has no durable revision-specific sync status,
Phase 3B should add a small status/outbox row in the same final transaction
(`PENDING`, `SYNCED`, `FAILED_RETRYABLE`, checksum, safe failure code, retry
metadata). A reconciler processes that row. The filesystem is therefore a
repairable projection, never a second authority and never a reason to hold a
database transaction open.

## Consequences

Positive consequences:

- a successful revision has one database commit boundary;
- exact replay is a database lookup, including after a lost response or
  ambiguous network outcome;
- concurrent different revisions can do provider work independently, but only
  one can win the final currentness CAS;
- invalid output, provider failure, stale state, or rollback cannot leave a
  new current Brief with a failed/incomplete canonical write set; and
- existing Postgres/fake transaction infrastructure remains the implementation
  seam.

Costs and constraints:

- Phase 3B needs additive schema and typed transaction work plus a more
  realistic fake for lock/CAS/fault tests;
- provider work may be repeated after a crash before commit, so provider
  idempotency is useful but cannot replace host currentness;
- memory sync becomes explicitly asynchronous/reconcilable; and
- V1/V2 readers remain temporarily, but there must be no permanent V2/V3
  competing dual-write authority.

## Rejected alternatives

- **REUSE the current repository calls:** rejected because separate document,
  workflow, decision, memory, and operation transactions are the defect.
- **REUSE generic `idempotency_records` unchanged:** rejected because it has no
  typed lease, terminal rejection distinctions, committed revision reference,
  or operation-scoped history link.
- **Hold a database transaction across the provider call:** rejected because
  model latency and failure would hold locks and make the database the provider
  transport coordinator.
- **Make Project Memory the transaction coordinator:** rejected because the
  filesystem is a projection and cannot establish relational currentness or
  RLS-safe CAS.
- **Silently rebase a stale provider result:** rejected because it would mutate
  a different current Brief than the one the operator approved.
- **Permanent V2/V3 dual writes:** rejected because two current representations
  would recreate the authority split V3 is intended to remove.

## Required Phase 3B evidence

Implementation may begin only with a bounded plan for the additive migration,
typed transaction port, current-document CAS, attempt leases, durable memory
sync status, and fault injection at every crash boundary in the linked Phase 3A
design. Before the production switch, certification must prove exact replay,
failed retry, stale rejection, concurrent different revisions, rollback,
ambiguous commit recovery, no partial write set, and protected-state equality.
