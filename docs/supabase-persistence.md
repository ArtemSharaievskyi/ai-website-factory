# Supabase persistence

Factory workflow metadata is persisted in Supabase PostgreSQL through a server-only `pg` adapter. The repository layer accepts the domain Zod contracts, maps them to typed rows, and validates them again after retrieval. Unit tests use `InMemoryPersistenceDatabase` and never require credentials.

Supabase stores project metadata, version state, workflow events, validated structured documents, decisions, quality/release records, and future cost records. The generated project source and its `.factory` Project Memory remain filesystem-owned; Supabase is not their only copy.

RLS is enabled for the metadata tables with no anonymous policies. This is a local single-user application: only the trusted server-side database connection is supported. No browser Supabase client or Factory authentication is implemented. `DATABASE_URL` is server-only and required for production persistence. `SUPABASE_SERVICE_ROLE_KEY` is reserved for a future explicit adapter and is never exposed to client code.

Apply `supabase/migrations/*.sql` with the normal Supabase migration workflow. `npm run db:validate` performs offline safety assertions; it does not connect to or reset a real database. No agents, OpenAI calls, Workspace Manager, generated projects, Preview, or deployment are included.
