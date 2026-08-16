# Persistence rules

- Keep database access behind `src/persistence/database/` repositories,
  transactions, and typed ports. Application services own business decisions;
  repositories own storage mechanics and validation at the persistence edge.
- Normalize database nulls before strict domain parsing and preserve the
  domain's explicit optional/nullable meaning.
- Preserve transaction boundaries, expected row versions, workflow currentness,
  document checksums, idempotency reservations, immutable released versions,
  workflow events, and user/project scoping.
- Use the fake database and repository tests for deterministic behavior; keep
  Postgres mapping and migration behavior covered separately.
- Do not repair state manually or bypass repositories with ad hoc SQL. Schema
  changes require an explicit migration, migration validation, integrity checks,
  and review of RLS behavior where applicable.
