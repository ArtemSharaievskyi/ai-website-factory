-- Immutable host evidence for the explicitly authorized full Planning recovery path.
create table if not exists planning_recovery_evidence (
  id uuid primary key,
  operation_key text not null check (length(operation_key) between 1 and 180),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  foreign key (project_id, project_version) references project_versions(project_id, version_number),
  recovery_plan_checksum char(64) not null check (recovery_plan_checksum ~ '^[a-f0-9]{64}$'),
  brief_row_version integer not null check (brief_row_version > 0),
  brief_semantic_checksum char(64) not null check (brief_semantic_checksum ~ '^[a-f0-9]{64}$'),
  brief_document_checksum char(64) not null check (brief_document_checksum ~ '^[a-f0-9]{64}$'),
  prior_planning_row_version integer not null check (prior_planning_row_version > 0),
  prior_planning_semantic_checksum char(64) not null check (prior_planning_semantic_checksum ~ '^[a-f0-9]{64}$'),
  prior_planning_document_checksum char(64) not null check (prior_planning_document_checksum ~ '^[a-f0-9]{64}$'),
  prior_planning_package jsonb not null,
  next_planning_row_version integer not null check (next_planning_row_version > 0),
  next_planning_semantic_checksum char(64) not null check (next_planning_semantic_checksum ~ '^[a-f0-9]{64}$'),
  next_planning_document_checksum char(64) not null check (next_planning_document_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  unique(project_id, project_version, operation_key)
);
create index if not exists planning_recovery_evidence_project_idx on planning_recovery_evidence(project_id, project_version, created_at, id);
alter table planning_recovery_evidence enable row level security;

create or replace function reject_planning_recovery_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'planning_recovery_evidence is immutable';
end;
$$;

drop trigger if exists planning_recovery_evidence_immutable on planning_recovery_evidence;
create trigger planning_recovery_evidence_immutable
before update or delete on planning_recovery_evidence
for each row execute function reject_planning_recovery_evidence_mutation();
