# Domain contracts

The current foundation now contains independently testable TypeScript/Zod contracts under `src/domain/`. They have no React, Next.js, Supabase, Docker, or browser dependencies.

Canonical contracts cover the Factory project, clarification sessions, requirements, three design directions and selection, technical architecture, content, assets, task graphs, quality/release reports, decisions, and workflow state.

All structured documents use schema version `1`, document type, project identity/version, and UTC timestamps. Identifiers are UUIDs; project slugs and relative paths are validated separately. User-provided facts, missing information, deferred values, pending decisions, and approved generated copy are represented explicitly.

The fixed stack is encoded in the architecture contract: the package manager is always npm, backend priority is Server Actions, Route Handlers, then Supabase services, and prohibited infrastructure is rejected. Logos must be user-supplied.

Canonical Brief V3 publication identity is host-owned and deterministic. A confirmed structured service address, canonical public telephone (E.164 plus derived presentation and `tel:` URI), sole-proprietorship identity, commercial-register status, and explicit tax-identifier status are persisted as typed legal/contact facts with customer-confirmation provenance and publication scopes. Missing identifiers use explicit `NOT_YET_ASSIGNED` status; the host does not infer numbers, registration, or tax treatment. These facts are not provider-writable Planning requirements, and the Brief-revision provider context omits their raw values.

This layer does not call AI, persist to Supabase, execute tasks, create customer projects, or provide workflow UI.
