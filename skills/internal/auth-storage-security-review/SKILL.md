---
name: auth-storage-security-review
description: Review authentication, authorization, secrets, storage, and upload trust boundaries without offensive execution.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: security-reviewer
capabilities: review.security
coverage-keys: auth-security, storage-upload-security
context-range: 5–8 KB
---

# Authentication and Storage Security Review

## Purpose

Use this read-only procedure after Code / Integration evidence is current to
review trust boundaries that are not limited to row-level policy methodology.
Focus on identity, authorization, secrets, files, and sensitive error paths.

## Inputs and evidence

- current implementation source and deterministic security evidence;
- auth/session contracts, ownership rules, Storage policies, and upload
  constraints;
- sanitized source context and existing `supabase-rls` findings where present.

## Steps

1. Identify principals, assets, trust boundaries, and the intended owner of each
   operation, record, object, and sensitive response.
2. Trace authentication versus authorization, session identity use, admin
   boundaries, privileged operations, and ownership checks.
3. Inspect server/client secret exposure, server-side validation, upload type,
   size and path assumptions, public/private Storage, and signed URLs.
4. Check sensitive metadata, error messages, object ownership, and external
   input handling for leakage or confused-deputy behavior.
5. Return contextual findings with evidence, severity rationale, and owner.
   Keep RLS-specific policy methodology with the approved RLS procedure.

## Decision rules

- Authentication proves identity; authorization proves permission for the
  requested resource and action.
- Client checks never replace server-side authorization or validation.
- A service credential, secret, or private object must not cross a client trust
  boundary.
- Findings must be semantic and contextual, not speculative exploitation.

## Quality checks

- Every finding identifies principal, asset, boundary, evidence, and owner.
- Upload and signed-URL conclusions include the relevant storage policy.
- No offensive execution, scanner result, or network probe is required.
- Existing RLS review is referenced rather than duplicated.

## Non-goals and authority

This procedure does not pentest, generate exploits, scan, run browsers, use a
browser, shell or network, access secrets, mutate source, execute databases, or approve
security. It grants no approval authority and is read-only and subordinate to
Factory policy and contracts.
