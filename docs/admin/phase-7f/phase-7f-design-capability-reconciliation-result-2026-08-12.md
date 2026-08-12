# Phase 7F design capability reconciliation

Status: COMPLETE

The Phase 7F candidate is frozen at `27bc0833f500e68fdb9d05cf2acbda2f31d6d8ff`. The prior baseline remains `269d29fab409a37cb67186db261e5471ed2a31f2`; the earlier blocked report is preserved unchanged at `docs/admin/phase-7f/phase-7f-capability-evidence-2026-08-12.json` and `.md`.

## Reconciled capability

- The paid/commercial design generator path is explicitly excluded by user policy. It is not required, active, credential-gated, or present as a runtime/API/MCP path.
- Fontpair is a bounded HTTPS read-only integration at `https://fontpair.co/`: 300,000-byte response cap, 15-second timeout, one retry, manual/rejected redirects, HTML-only parsing, idempotency caching, normalization, and deduplication. The live check returned 24 pairings; the sample was `Young Serif + Geist`.
- Each of the three directions uses all four permitted component sources with write authority `NONE`: 21st.dev, React Bits, the free/open Magic UI registry, and the existing shadcn/ui integration. Live candidate counts were 4, 2, 6, and 1 respectively, with 12 bounded cross-source candidates after deduplication.
- The approved design skill set has seven newly reconciled public skills with checksum-bound registry approvals and seven-capability coverage: Impeccable, Emil Design Engineering, four Emil animation skills, and transitions.dev. Skills remain procedural context only and grant no tools or workflow authority.

## Direction set and selection

The exact three directions are Editorial, Precision, and Dynamic. All three have 15 deterministic evidence passes and live four-source evidence.

| Direction | Typography | Motion | Direction ID |
| --- | --- | --- | --- |
| Editorial | Young Serif + Geist | NONE | `e2cb84c1-58f2-49b6-b271-cf706c51eb87` |
| Precision | Young Serif + DM Sans | CSS_NATIVE | `286f90e8-011b-41de-987d-92cf58c4df21` |
| Dynamic | Young Serif + Space Mono | MOTION | `4820892f-f70b-4fc3-90ef-689f16f6bbfa` |

The user-selected direction is Precision. The optional Dynamic motion amendment is explicitly approved for `motion@12.43.0` through Dependency Authority; motion remains optional and is not a hidden dependency.

## Review and validation

Architecture, Contract, Code / Integration, Security, and Test / Quality reviewer evidence is bound to the same candidate/evidence checksum, is read-only, and has zero findings. These are bounded contract reviews with zero provider calls; no AI provider was enabled.

Passed gates include the full test suite (82 files / 1,018 tests), reviewer tests (7 files / 77 tests), typecheck, lint with zero errors, Next.js 16.2.12 production build, high-severity audit with zero vulnerabilities, database validation/integrity/status/verification/smoke, TaskGraph smoke, generated runtime smoke, backend smoke, shadcn smoke, Context7 smoke, and live source/skill checks.

AI-provider smoke was not run because explicit provider opt-in was not authorized. Codebase-memory smoke was not run because no executable was configured. Customer Playwright smoke and deployment remain out of scope for Phase 7F.

The machine-readable checksums, source evidence, reviewer bindings, and validation matrix are in [the JSON result](./phase-7f-design-capability-reconciliation-result-2026-08-12.json).
