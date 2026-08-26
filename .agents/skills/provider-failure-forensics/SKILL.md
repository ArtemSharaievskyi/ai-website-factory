---
name: provider-failure-forensics
description: Classify a provider-path failure at the first failing production boundary without weakening valid host guards.
---

# Provider failure forensics

## When it applies

Use for a failed or unexpectedly rejected provider-backed operation before
changing prompts, contracts, guards, or persistence.

## Forensic sequence

Trace the production path in order:

`eligibility -> request assembly -> provider transport -> parse -> host
normalization -> enrichment -> semantic validation -> currentness/CAS ->
persistence -> projection`

Inspect safe structural diagnostics and typed results only. Never expose raw
prompts, answers, provider payloads, secrets, SQL, stack traces, or storage
paths.

## Classification and authority

Classify the first failure as one of `SOURCE_DEFECT`,
`PROVIDER_SEMANTIC_FAILURE`, `CURRENTNESS_FAILURE`, `CAPABILITY_FAILURE`,
`ENVIRONMENTAL_FAILURE`, or `OBSERVABILITY_GAP`. The host remains the authority
for metadata, guards, currentness, persistence, and workflow consequences.

## Stop and certification

Stop on a deterministic source defect, semantic provider failure without an
authorized correction, unsafe currentness, or missing observability needed to
classify the boundary. Certify the first failing boundary, zero partial
canonical artifacts, preserved failure atomicity, and a regression at that
boundary. Never weaken a valid host guard to make provider output pass.
