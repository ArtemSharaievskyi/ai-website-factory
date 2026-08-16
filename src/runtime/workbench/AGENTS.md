# Workbench runtime rules

- Treat the browser and `src/app/api/workbench/route.ts` as bounded transport
  and projection layers. Canonical state comes from server services.
- Keep DTOs minimal and safe. Do not expose raw prompts or answers, provider
  payloads, secrets, SQL, stack traces, storage paths, or internal diagnostics.
- Route handlers validate requests and return stable typed error envelopes;
  `WorkbenchApplication` coordinates actions and delegates domain ownership.
- Use `TrialEntryService`, repositories, and the configured workflow scope for
  mutations. Do not duplicate Lead, Brief, persistence, or orchestration logic
  in the UI.
- Preserve action guards, row-version expectations, checksums, idempotency, and
  currentness when adding a Workbench action or projection field.
