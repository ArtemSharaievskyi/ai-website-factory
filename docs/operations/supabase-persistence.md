# Supabase persistence

Factory workflow metadata is persisted in Supabase PostgreSQL through a server-only `pg` adapter. The repository layer accepts the domain Zod contracts, maps them to typed rows, and validates them again after retrieval. Unit tests use `InMemoryPersistenceDatabase` and never require credentials.

Supabase stores project metadata, version state, workflow events, validated structured documents, decisions, quality/release records, and future cost records. The generated project source and its `.factory` Project Memory remain filesystem-owned; Supabase is not their only copy.

RLS is enabled for the metadata tables with no anonymous policies. This is a local single-user application: only the trusted server-side database connection is supported. No browser Supabase client or Factory authentication is implemented. `DATABASE_URL` is server-only and required for production persistence. `SUPABASE_SERVICE_ROLE_KEY` is reserved for a future explicit adapter and is never exposed to client code.

Apply and verify the migration through the server-only scripts:

```text
npm run db:validate
npm run db:migrate
npm run db:status
npm run db:verify
npm run db:smoke
```

The migration runner records filename/checksum history, uses an advisory lock, applies each migration transactionally, and makes repeated runs no-ops. `db:verify` checks tables, constraints, indexes, TLS, transactions, and RLS. `db:smoke` uses unique disposable data and cleans it up; no reset or destructive migration command is provided. `npm run db:validate` and `npm run db:test-integrity` are offline checks. No agents, OpenAI calls, Workspace Manager, generated projects, Preview, or deployment are included.
