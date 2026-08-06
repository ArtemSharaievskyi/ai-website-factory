# Workspace security

Workspace slugs accept only lowercase ASCII letters, digits, and single hyphens. Traversal, separators, encoded traversal, dots, trailing spaces/dots, drive paths, UNC paths, and reserved Windows device names are rejected.

All workspace paths are derived from a validated slug and version number and checked for containment under the configured root. Existing symlinks are rejected during controlled operations and revision copying does not follow symlinks. Cleanup is limited to an operation-owned directory under `<project-root>/.staging`; final versions are never removed by generic cleanup.

Per-project lock files contain only an operation ID and bounded timestamps. Active foreign locks cannot be removed; expired locks may be reclaimed. Database row-version concurrency remains authoritative for version reservation.

Factory-level immutability means the Workspace Manager refuses to modify released versions. It cannot prevent manual edits made outside Factory processes. Secrets are excluded from revision copies; `.env.example` is retained when present, while `.env` and `.env.local` are excluded.

Implementation execution verifies a reservation-owned staging directory and refuses paths outside that staging root before applying any proposal.
