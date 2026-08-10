# cg-03 Storage Ownership Controls — Revision 2 Replan

Status: **BLOCKED_REPLAN_COMPLETE**
Baseline: `840fecb`
Original plan identity: `819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00`
Findings: `finding-b227589f057cc3fa00ac` (ERROR), `finding-eb166a34da7872c62d77` (WARNING)

## Why cg-03 failed

Both correction attempts added a server-side authenticated owner check and signed URL flow, but the generated project had no `storage.objects` policy artifact. The generated server client uses the authenticated Supabase session with the anon key, so application checks alone do not establish the Storage authorization boundary. The Security Reviewer therefore correctly kept both findings active.

The original plan named bucket, object ownership, access, and signed URLs, but did not require a typed contract connecting Planning to policy generation, did not specify the four Storage operations, and did not require a generated bucket/path-scoped policy artifact.

## Original plan failure table

| Layer | Original plan assumption | What attempt implemented | What Security verification proved missing |
| --- | --- | --- | --- |
| Planning | Storage purpose, private access, bucket, path strategy, and policy intent were enough. | Consumed a hardcoded source helper instead of the accepted StoragePlan as a typed policy contract. | Executable bucket/path/operation semantics were not carried into policy generation. |
| Implementation | Server-side owner checks would establish the storage boundary. | Added `user.id`, path checks, signed URLs, update, and delete checks. | The authenticated server client still relies on Storage authorization policies. |
| Generated artifact | Storage source helper represented the required security behavior. | Emitted only `src/lib/storage/uploads.ts`. | No `storage.objects` policy artifact was generated. |
| Deterministic validation | Source regexes could prove the storage contract. | Added source guards and regressions. | Static source evidence could not prove bucket-level/user-scoped policy enforcement. |

## Attempt history

| Attempt | What changed | Deterministic result | Security result |
| --- | --- | --- | --- |
| 1 | Added server auth, fixed bucket, owner-prefixed paths, signed URLs, update/delete checks, validator, tests, and shared verifier configuration. | PASS | STILL_ACTIVE: signed upload URL skipped the existing type/size gate. |
| 2 | Enforced `validateUpload` before signed upload URL creation and strengthened tests. | PASS | STILL_ACTIVE: no bucket-level/user-scoped Supabase Storage policy. |

No third implementation cycle was executed.

## Revised root cause

`INCOMPLETE_TRUST_BOUNDARY_MODEL`, `INCOMPLETE_STORAGE_POLICY_CONTRACT`, `PLANNING_TO_IMPLEMENTATION_INFORMATION_GAP`, `STORAGE_POLICY_GENERATION_MISSING`, and `DETERMINISTIC_SECURITY_EVIDENCE_INCOMPLETE`.

The revised root cause is: the Factory generated a server access helper without generating the corresponding `storage.objects` authorization artifact from a canonical bucket/path/owner/operation contract.

## Actual storage architecture

| Access mode | Actor | Credential | Authorization boundary | Storage policy required? |
| --- | --- | --- | --- | --- |
| Server-mediated authenticated | Authenticated generated-project user | Supabase SSR server client with anon key and user session | Server `user.id` check plus Storage policy | Yes |
| Signed URL mediated | Authenticated generated-project user | URL issued after server authorization | Owner check before URL plus Storage policy | Yes |
| Direct client Storage SDK | Not evidenced | None | Unsupported in current architecture | N/A |
| Privileged service role | Not evidenced | None; service role is prohibited for ordinary requests | Unsupported | N/A |
| Public runtime Storage | Not evidenced | N/A | Runtime Storage is planned private; static assets are separate | N/A |

The canonical actor and owner are the cg-02 authenticated `user.id`. The current Planner emits conditional private storage with bucket `approved-uploads`, a user-owned path strategy, and an intent for RLS/object ownership policies. It does not yet emit an executable path template or operation matrix.

## Required end-to-end contract

The revised typed contract must carry:

- validated bucket IDs and stable policy identity;
- authenticated `user.id` as the owner source;
- a deterministic object-path template;
- explicit SELECT, INSERT, UPDATE, and DELETE permissions;
- private owner-scoped access;
- signed URL operations and expiration policy;
- direct-client access disabled by default;
- service-role access disabled by default;
- ownership transfer forbidden.

Generated policies must scope the exact `bucket_id`, require the authenticated role, and use the same canonical owner/path relation as the server helper. SELECT and DELETE require `USING`; INSERT requires `WITH CHECK`; UPDATE requires both existing-row authorization and new-row `WITH CHECK` protection.

No public runtime asset behavior is changed. No raw SQL is placed in Planning; SQL is generated later by the existing Implementation/backend ChangeProposal path from the typed contract.

## Revised security contract table

| Boundary | Revised required invariant | Enforcement layer | Deterministic proof | Reviewer verification |
| --- | --- | --- | --- | --- |
| Authentication | Only a verified generated-project user acts on runtime Storage. | Existing cg-02 server auth plus Storage policy role. | `getAuthenticatedUser()` fail-closed tests. | Security Reviewer checks actor/session boundary. |
| Ownership | Storage owner is authenticated `user.id`; no client owner metadata. | Typed StoragePlan, server helper, policy predicate. | Forged owner/cross-user denial tests. | Security Reviewer checks semantic owner relation. |
| Bucket | Only the exact planned private bucket is addressable. | Plan-bound source and `bucket_id` policy condition. | Wrong-bucket and safe-identifier tests. | Security Reviewer checks bucket scoping. |
| Object path | Deterministic plan path binds owner without trusting a client path. | Shared contract, source helper, policy predicate. | Traversal/prefix/owner-spoof fixture tests. | Security Reviewer checks path meaning. |
| SELECT | Authenticated owner can read only own objects. | `storage.objects` `USING`. | Valid-owner/cross-user policy fixture. | Security Reviewer checks read isolation. |
| INSERT | Authenticated owner can create only own objects in planned bucket. | `WITH CHECK`. | Anonymous/wrong-bucket/forged-owner fixture. | Security Reviewer checks write boundary. |
| UPDATE | Existing owner is authorized and new object metadata cannot rebind ownership. | `USING` plus `WITH CHECK`. | Rebind/update denial fixture. | Security Reviewer checks transfer resistance. |
| DELETE | Only authenticated owner can delete own objects. | `USING`. | Cross-user/delete denial fixture. | Security Reviewer checks destructive operation. |
| Signed URL | URL is issued only after server owner authorization. | Server helper plus Storage policy. | Unauthorized URL request test. | Security Reviewer checks no URL bypass. |
| Privileged server | No ordinary service-role Storage path exists. | Credential/tool policy. | Secret/service-role scan. | Security Reviewer checks privileged-flow absence. |

## Current dirty change decisions

| Current changed file/control | Decision | Reason | Revised-plan role |
| --- | --- | --- | --- |
| `src/agents/implementation/provider.ts` | KEEP_BUT_MODIFY | Server checks are valid, but bucket is hardcoded and no policy output exists. | Generate source and policy artifact from the typed contract. |
| `src/agents/implementation/backend.ts` | KEEP_BUT_MODIFY | Correct validator location, but current storage plan shape is mismatched and source-only. | Validate contract, policy operations, identifiers, and source/policy equivalence. |
| `src/runtime/validation/security.ts` | KEEP_BUT_MODIFY | Current checks are useful supplements, not proof of Storage enforcement. | Validate generated policy fixtures and contract identity. |
| `src/agents/implementation/backend.test.ts` | KEEP_BUT_MODIFY | Server ownership regressions remain valuable. | Add policy, wrong-bucket, cross-user, operation, and signed URL behavior tests. |
| `scripts/phase-6c-cg02-verification.ts` | ADMIN_VERIFICATION_INFRA_ONLY | Shared runner works; filename is stale but unrelated to production scope. | Reuse; optional neutral admin rename later. |
| Existing cg-03 verification JSON/MD | ADMIN_VERIFICATION_INFRA_ONLY | Validated historical STILL_ACTIVE evidence. | Preserve as failed-attempt history. |

The current candidate controls retained are server authentication, `user.id`, path safety, signed URL authorization, update/delete checks, safe errors, server regressions, and shared verifier infrastructure. The hardcoded bucket and assumption that server checks alone close Storage security are discarded as design assumptions, not blindly retained.

## Revised file scope

| File/module | Scope | Required? | Planned responsibility |
| --- | --- | --- | --- |
| `src/agents/planner/contracts.ts` | Typed Storage policy contract | Yes | Add ownership/path/operation/direct-client/signed-URL semantics without raw SQL. |
| `src/agents/planner/deterministic.ts` | Canonical plan output | Yes | Emit stable conditional private Storage contract. |
| `src/agents/implementation/contracts.ts` | Context contract | Yes | Carry the accepted Storage contract and checksum. |
| `src/agents/implementation/service.ts` | Context assembly | Yes | Pass bounded Storage context to the existing backend capability. |
| `src/agents/implementation/provider.ts` | Generated artifacts | Yes | Generate server helper plus bounded Storage policy migration output. |
| `src/agents/implementation/backend.ts` | Deterministic guard | Yes | Validate plan shape, policy identifiers, operations, and source/policy binding. |
| `src/runtime/validation/security.ts` | Security validator | Yes | Supplement structural policy/source checks. |
| `src/agents/implementation/backend.test.ts` | Regression tests | Yes | Prove server and generated policy behavior. |
| `src/agents/planner/planner.test.ts` | Plan tests | Yes | Prove conditional storage and typed contract traceability. |
| `supabase/migrations/<generated-project-policy>.sql` | Generated customer artifact | Possible output | Store bucket-scoped Storage policies through the normal proposal. |
| `scripts/phase-6c-cg02-verification.ts` | Admin verifier | Possible, not required | Reuse current shared runner; no new verifier system. |

No Factory metadata migration is required. The `supabase/migrations/` entry is generated customer-project output, not a mutation of the Factory database.

## Revised validation and review

Deterministic checks must cover the typed plan, implementation context checksum, generated policy artifact, safe identifiers, bucket scoping, authenticated owner predicates, correct `USING`/`WITH CHECK`, anonymous/cross-user/wrong-bucket/path-spoof denial, valid-owner behavior, update non-rebinding, delete, signed URLs, service-role absence, cg-02 regressions, and existing cg-03 server regressions.

Required reviewer rechecks:

| Reviewer | Why | Expected evidence | Active skill scope |
| --- | --- | --- | --- |
| Security Reviewer | Owns the validated Storage trust-boundary findings. | Actor, owner, bucket, path, SELECT/INSERT/UPDATE/DELETE policies, signed URLs, cross-user denial, no secrets. | `auth-storage-security-review`; resolver may additionally select `supabase-rls`. |
| Contract Auditor | Revision 2 adds a typed Planning → Implementation → policy trace. | No dropped bucket, ownership, operation, or access semantics. | `acceptance-criteria` and `requirements-evidence-traceability` through resolver. |

No GPT clarification call was made during replan; the validated reviewer result was sufficient.

## Revised execution table

| Step | Scope | Files/modules | Check before continuing |
| --- | --- | --- | --- |
| 1 | Typed Storage contract | Planner contracts/deterministic planner | Conditional storage and stable contract tests pass. |
| 2 | Bounded context handoff | Implementation contracts/service/backend adapter | Accepted StoragePlan and checksum reach the implementation task. |
| 3 | Policy generation | Existing Implementation provider/backend and generated migration output | Source and policy use the same contract; identifiers are safe and deterministic. |
| 4 | Security guards | Runtime security validator and backend tests | All policy operations and negative ownership fixtures pass. |
| 5 | Targeted review | Security Reviewer and Contract Auditor | Evidence is current, bounded, and both reviewers resolve assigned scope. |
| 6 | Full closure | Existing repository validation gates | Lint, typecheck, tests, build/audit and DB/Docker/taskgraph checks pass. |
| 7 | State transition | Phase 6 successor state only | No finding is resolved before reviewer closure. |

## Future correction sequence

1. Add the minimal typed Storage contract and deterministic Planner output.
2. Pass that contract and checksum into Implementation and align the BackendPlans adapter.
3. Generate bounded server source and bucket/path/operation policy migration output through the existing ChangeProposal.
4. Validate safe identifiers, project/version scope, idempotency, migration safety, and source/policy equivalence.
5. Add behavioral policy fixtures while retaining cg-02 and server-side cg-03 regressions.
6. Run targeted checks, then the exact Security Reviewer and Contract Auditor rechecks.
7. Run full validation only after reviewer closure.

## Execution state

cg-01 remains COMPLETE. cg-02 remains COMPLETE. cg-03 revision 1 is BLOCKED after two correction cycles. cg-03 revision 2 is REPLAN COMPLETE and IMPLEMENTATION PENDING. No findings were resolved or counts changed. cg-04 and all later groups remain unstarted.

Machine replan: `docs/admin/phase-6/cg-03-storage-ownership-controls-replan-2026-08-10.json`
