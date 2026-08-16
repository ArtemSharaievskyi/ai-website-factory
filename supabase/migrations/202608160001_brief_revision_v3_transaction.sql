-- Additive persistence for the isolated Brief Revision V3 transaction boundary.
create table if not exists brief_revision_attempts (
  id uuid primary key,
  operation_kind text not null check (length(operation_kind) between 1 and 120),
  operation_key text not null check (length(operation_key) between 1 and 300),
  payload_hash char(64) not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  currentness_token jsonb not null check (jsonb_typeof(currentness_token) = 'object'),
  status text not null check (status in ('RESERVED','PROVIDER_PENDING','COMMITTED','FAILED_RETRYABLE','REJECTED_INVALID','REJECTED_STALE')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_generation integer not null default 0 check (attempt_generation >= 0),
  claimed_at timestamptz,
  committed_result jsonb,
  failure_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(operation_kind, operation_key),
  check ((status = 'PROVIDER_PENDING' and lease_owner is not null and lease_expires_at is not null) or (status <> 'PROVIDER_PENDING' and lease_owner is null and lease_expires_at is null)),
  check ((status = 'COMMITTED' and committed_result is not null) or (status <> 'COMMITTED' and committed_result is null))
);
create index if not exists brief_revision_attempts_project_idx on brief_revision_attempts(project_id, project_version, created_at desc);

create table if not exists brief_revision_history (
  id uuid primary key,
  attempt_id uuid not null unique references brief_revision_attempts(id),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  revision_reference text not null check (length(revision_reference) between 1 and 180),
  previous_current_checksum char(64) not null check (previous_current_checksum ~ '^[a-f0-9]{64}$'),
  next_current_checksum char(64) not null check (next_current_checksum ~ '^[a-f0-9]{64}$'),
  change_set_checksum char(64) not null check (change_set_checksum ~ '^[a-f0-9]{64}$'),
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  created_at timestamptz not null
);
create index if not exists brief_revision_history_project_idx on brief_revision_history(project_id, project_version, created_at, id);

create table if not exists brief_revision_projection_sync (
  id uuid primary key,
  attempt_id uuid not null unique references brief_revision_attempts(id),
  project_id uuid not null references factory_projects(id),
  project_version integer not null check (project_version > 0),
  document_checksum char(64) not null check (document_checksum ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('PENDING','SYNCED','FAILED_RETRYABLE','SUPERSEDED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_failure_code text,
  next_attempt_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists brief_revision_projection_pending_idx on brief_revision_projection_sync(status, next_attempt_at, updated_at);

alter table workflow_events add column if not exists revision_attempt_id uuid;
alter table decision_records add column if not exists revision_attempt_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workflow_events_revision_attempt_fk') then
    alter table workflow_events add constraint workflow_events_revision_attempt_fk foreign key (revision_attempt_id) references brief_revision_attempts(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decision_records_revision_attempt_fk') then
    alter table decision_records add constraint decision_records_revision_attempt_fk foreign key (revision_attempt_id) references brief_revision_attempts(id);
  end if;
end $$;

create unique index if not exists workflow_events_revision_attempt_idx on workflow_events(revision_attempt_id) where revision_attempt_id is not null;
create unique index if not exists decision_records_revision_attempt_idx on decision_records(revision_attempt_id) where revision_attempt_id is not null;

alter table brief_revision_attempts enable row level security;
alter table brief_revision_history enable row level security;
alter table brief_revision_projection_sync enable row level security;
