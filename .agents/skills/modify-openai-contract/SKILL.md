---
name: modify-openai-contract
description: Safely modify a registered OpenAI structured-output contract, adapter, or prompt boundary; use when provider schemas, nullable fields, host-owned fields, or transport mapping change.
---

# Modify OpenAI contract

1. Inspect the canonical domain contract, production builder, adapter mapping, registry entry, and provider-contract tests before editing.
2. Keep provider output strict, reject unknown fields, represent absent values with required nullable fields where required, and exclude host-owned identity, approval, checksum, currentness, history, and trace fields.
3. Test the exact production response-format builder and adapter path. Do not use a domain-only schema test as contract evidence and do not require a network call for a local contract check.
4. Run codex:provider-contracts, the affected OpenAI/agent tests, check:architecture, typecheck, lint, and codex:verify.
5. Treat any new or changed provider failure as blocking. An unchanged failure is non-blocking only when the saved baseline fingerprint matches and the task did not touch its registered trigger paths.
