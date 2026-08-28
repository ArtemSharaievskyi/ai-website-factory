-- Host-owned, immutable identity lineage for the V3 requirement namespace.
-- Historical Briefs remain readable; only current V3 writes may use the v3 namespace.
create table if not exists requirement_identity_lineage (
  lineage_id text primary key check (lineage_id ~ '^lineage:v3-[a-f0-9]{64}$'),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  foreign key (project_id, project_version) references project_versions(project_id, version_number),
  from_namespace text not null check (from_namespace in ('legacy-v1', 'legacy-v2')),
  from_requirement_id text not null check (from_requirement_id ~ '^REQUIREMENT:legacy-v[12]-[A-Za-z0-9_.:-]{1,180}$'),
  to_namespace text not null check (to_namespace = 'v3'),
  to_requirement_id text not null check (to_requirement_id ~ '^REQUIREMENT:v3-[a-f0-9]{64}$'),
  canonical_semantic_identity text not null check (length(canonical_semantic_identity) between 1 and 300 and canonical_semantic_identity !~ '[\r\n]'),
  migration_policy_version text not null check (migration_policy_version = 'requirement-identity-v3.v1'),
  created_at timestamptz not null,
  unique(project_id, project_version, from_requirement_id),
  unique(project_id, project_version, to_requirement_id),
  check ((from_namespace = 'legacy-v1' and from_requirement_id ~ '^REQUIREMENT:legacy-v1-') or (from_namespace = 'legacy-v2' and from_requirement_id ~ '^REQUIREMENT:legacy-v2-'))
);
create index if not exists requirement_identity_lineage_project_idx on requirement_identity_lineage(project_id, project_version, created_at, lineage_id);

create table if not exists requirement_identity_migrations (
  migration_id text not null check (length(migration_id) between 1 and 180),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  foreign key (project_id, project_version) references project_versions(project_id, version_number),
  plan_checksum char(64) not null check (plan_checksum ~ '^[a-f0-9]{64}$'),
  previous_brief_checksum char(64) not null check (previous_brief_checksum ~ '^[a-f0-9]{64}$'),
  next_brief_checksum char(64) not null check (next_brief_checksum ~ '^[a-f0-9]{64}$'),
  previous_planning_semantic_checksum char(64) check (previous_planning_semantic_checksum is null or previous_planning_semantic_checksum ~ '^[a-f0-9]{64}$'),
  next_planning_semantic_checksum char(64) check (next_planning_semantic_checksum is null or next_planning_semantic_checksum ~ '^[a-f0-9]{64}$'),
  migration_policy_version text not null check (migration_policy_version = 'requirement-identity-v3.v1'),
  created_at timestamptz not null,
  primary key(project_id, project_version, migration_id)
);
create index if not exists requirement_identity_migrations_project_idx on requirement_identity_migrations(project_id, project_version, created_at, migration_id);

alter table requirement_identity_lineage enable row level security;
alter table requirement_identity_migrations enable row level security;
