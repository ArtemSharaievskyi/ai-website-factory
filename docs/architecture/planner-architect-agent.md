# Planner / Architect Agent

The Planner / Architect Agent starts only from an approved Project Brief while the workflow is `AWAITING_DESIGN_SELECTION`. It converts approved requirements into product scope, UX structure, content, assets, and fixed-stack technical planning. It cannot modify requirements, create visual directions, write source, install packages, run migrations for customer projects, or advance the workflow to implementation.

The default implementation is deterministic and network-free. The production GPT-5.6 Luna provider implements the narrow planner provider port, while provider output remains strictly validated and has no persistence, file-write, approval, or transition authority.

Planner documentation enrichment is optional, explicit, narrow, and permission-gated. Context7 may clarify current APIs or compatibility only; it cannot add features, dependencies, or accepted planning decisions.

The host may first apply a deterministic Brief consistency correction through
the V3 transaction boundary. This correction is provider-free and can
reconcile confirmed no-analytics/no-form/no-protected-functionality decisions,
bounded requirement classification and service-scope limits, and typed
publication-input statuses. Planning may proceed with publication-only
placeholders when the Brief is semantically ready, while implementation and
public deployment retain the unresolved values and deployment fails closed
until required publication inputs are resolved. Providers cannot overwrite
host-owned confirmed decisions or author legal/contact facts, tax identifiers,
register information, or supervisory authorities.
