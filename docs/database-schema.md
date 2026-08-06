# Database schema

The migration `supabase/migrations/202608060001_factory_metadata.sql` defines the durable Factory metadata model:

- `factory_projects` and `project_versions` own project identity, state, versions, checksums, immutability, and row versions.
- `workflow_documents` stores validated JSONB payloads for requirements, designs, selected design, architecture, content, assets, task graphs, quality, and release documents.
- Clarifications, design sets/directions, selected designs, tasks/dependencies, decisions, quality reports/checks, release reports, workflow events, costs, and idempotency records have dedicated tables where relationships and append-only behavior matter.

JSONB is not an unchecked escape hatch: repositories validate every payload with the existing Zod schemas and compare the persisted checksum on retrieval. Database constraints enforce UUID relationships, positive versions, valid workflow states, unique version numbers, unique current design sets/selections, and duplicate-free task dependency edges.
