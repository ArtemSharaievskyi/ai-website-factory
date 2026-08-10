# cg-03 Storage Ownership Controls — Revision 2 Result

Status: **COMPLETE**

Revision 1 failed after two implementation cycles because it added server-side ownership checks and signed URLs but did not generate the corresponding bucket/user-scoped `storage.objects` policy boundary. Revision 2 was explicitly replanned from that failure and resolved both assigned findings.

## Root cause and scope

The revised root cause was an incomplete typed end-to-end Storage contract: Planning did not carry executable bucket, owner-path, operation, and policy semantics into Implementation. Confidence was **HIGH**. cg-02 remained complete and supplied the authenticated Supabase `user.id` contract.

The revision-1 server checks were retained: fail-closed authentication, canonical `user.id` ownership, owner-prefixed paths, path safety, signed URL authorization, update/delete checks, and regression coverage. The hardcoded bucket and source-only closure assumption were modified/discarded as design assumptions. Historical revision-1 verification remains preserved in its original files.

## Typed contract and generation

`StoragePlan` now contains the validated private bucket `approved-uploads`, stable policy identity `runtime-owner-scoped-storage`, authenticated-user ownership, `{userId}/{objectName}`, SELECT/INSERT/UPDATE/DELETE, signed URL expiry, direct-client disabled, service-role disabled, and ownership transfer forbidden. The same contract reaches `ImplementationContext` and `BackendPlans`; its checksum is embedded in both generated artifacts.

The existing Implementation provider generates:

- `src/lib/storage/uploads.ts`: server-mediated authenticated operations and signed URL authorization.
- `supabase/migrations/runtime-owner-scoped-storage.sql`: authenticated `storage.objects` policies for the four operations.

SELECT and DELETE use `USING`; INSERT uses `WITH CHECK`; UPDATE uses both. Each predicate scopes the exact bucket and the first path segment to `auth.uid()::text`. No direct client Storage, service-role bypass, public runtime upload, Factory metadata migration, or live customer Supabase mutation was added.

## Verification

The targeted Contract Auditor and Security Reviewer both returned **RESOLVED** with valid current-head evidence. The production resolver selected `acceptance-criteria-80493e317476` and `requirements-evidence-traceability` for Contract Auditor, and `auth-storage-security-review` for Security Reviewer. There were two real GPT calls total.

Targeted tests covered valid owner, anonymous, cross-user, wrong bucket, forged path, ownership rebind, public-policy, checksum, signed URL, and cg-02 regressions. The full suite passed 817 tests. Lint passed with the three pre-existing warnings only; typecheck, build, audit, database checks, Docker Compose config, TaskGraph, and `git diff --check` passed.

## Findings and next group

Both `finding-b227589f057cc3fa00ac` (ERROR) and `finding-eb166a34da7872c62d77` (WARNING) are **RESOLVED** by cg-03 revision 2. Remaining correction-ready findings are 22: 0 CRITICAL, 8 ERROR, 13 WARNING, and 1 INFO. No other group was auto-resolved or modified. The updated DAG has no newly unblocked groups attributable to cg-03; the next recommended group is `cg-04-provider-config-and-lifecycle`. It was not started.

Correction commit: `4ce4771` — `fix: generate storage ownership policies from typed plan`

Machine result: `docs/admin/phase-6/cg-03-storage-ownership-controls-result-rev2-2026-08-10.json`

Reviewer verification: `docs/admin/phase-6/cg-03-storage-ownership-controls-verification-rev2-2026-08-10.json`
