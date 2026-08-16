# OpenAI integration rules

- Read `docs/codex/KNOWN_FAILURES.md` before changing this adapter.
- Keep transport, provider response construction, and canonical domain mapping
  visibly separate. Tests must exercise the actual production response format.
- The provider must not own project identity, version, checksum, approval,
  currentness, history, or workflow transitions. The host maps those fields.
- Structured outputs stay strict: no free-form fallback, unknown keys, or
  provider-side optionality that the strict response API cannot represent.
  Nullable required fields are the normal representation for absent values.
- Build the same response schema passed to the production provider before the
  call, then validate the transport result and map it through the typed port.
