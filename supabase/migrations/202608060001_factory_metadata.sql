-- Factory workflow metadata only. Generated source and .factory Project Memory remain filesystem-owned.
create extension if not exists pgcrypto;

create table if not exists factory_projects (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text,
  original_prompt text not null,
  current_version integer not null check (current_version > 0),
  workflow_state text not null check (workflow_state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_DESIGN_SELECTION','READY_FOR_IMPLEMENTATION','IMPLEMENTING','VALIDATING','REPAIRING','PROJECT_READY','FAILED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  implementation_started_at timestamptz,
  completed_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0)
);

create table if not exists project_versions (
  id uuid primary key,
  project_id uuid not null references factory_projects(id),
  version_number integer not null check (version_number > 0),
  state text not null check (state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_DESIGN_SELECTION','READY_FOR_IMPLEMENTATION','IMPLEMENTING','VALIDATING','REPAIRING','PROJECT_READY','FAILED')),
  memory_root_path text,
  requirements_checksum char(64),
  selected_design_checksum char(64),
  architecture_checksum char(64),
  released_at timestamptz,
  immutable boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  row_version bigint not null default 1 check (row_version > 0),
  unique(project_id, version_number),
  check (not immutable or state = 'PROJECT_READY')
);

create table if not exists workflow_documents (
  project_id uuid not null references factory_projects(id),
  project_version integer not null,
  document_type text not null,
  schema_version integer not null check (schema_version > 0),
  checksum char(64) not null check (checksum ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  row_version bigint not null default 1 check (row_version > 0),
  primary key(project_id, project_version, document_type)
);

create table if not exists clarification_questions (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  category text not null, question text not null, reason text not null, required boolean not null, blocking boolean not null,
  asked_at timestamptz not null, answer_status text not null check (answer_status in ('answered','not-applicable','deferred','unresolved'))
);
create index if not exists clarification_blocking_unresolved_idx on clarification_questions(project_id, project_version) where blocking and answer_status = 'unresolved';
create table if not exists clarification_answers (
  id uuid primary key default gen_random_uuid(), question_id uuid not null references clarification_questions(id),
  status text not null check (status in ('answered','not-applicable','deferred','unresolved')), answer text, answered_at timestamptz not null, answered_by text not null
);

create table if not exists design_direction_sets (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  generated_at timestamptz not null, generated_by text not null, ready_for_selection boolean not null,
  unique(project_id, project_version)
);
create table if not exists design_directions (
  id uuid primary key, direction_set_id uuid not null references design_direction_sets(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), unique(direction_set_id, id)
);
create table if not exists selected_designs (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  direction_set_id uuid not null references design_direction_sets(id), selected_direction_id uuid not null,
  selected_at timestamptz not null, selected_by text not null, selection_notes text not null, selected_direction_checksum char(64) not null,
  unique(project_id, project_version)
);

create table if not exists agent_tasks (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), row_version bigint not null default 1
);
create table if not exists task_dependencies (
  task_id uuid not null references agent_tasks(id) on delete cascade, dependency_id uuid not null references agent_tasks(id),
  primary key(task_id, dependency_id), check(task_id <> dependency_id)
);
create table if not exists decision_records (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  timestamp timestamptz not null, actor_type text not null, actor_identifier text not null, category text not null,
  decision text not null, rationale text not null, affected_documents jsonb not null, requirement_change boolean not null,
  user_approval_required boolean not null, user_approval_status text not null, supersedes_decision_id uuid references decision_records(id)
);
create table if not exists quality_reports (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), unique(project_id, project_version)
);
create table if not exists quality_checks (
  id uuid primary key, quality_report_id uuid not null references quality_reports(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create table if not exists release_reports (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), unique(project_id, project_version)
);
create table if not exists workflow_events (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  from_state text not null, to_state text not null, actor text not null, reason text not null, created_at timestamptz not null, idempotency_key text
);
create table if not exists cost_records (
  id uuid primary key, project_id uuid not null references factory_projects(id), project_version integer not null,
  role text not null, task_id uuid references agent_tasks(id), provider text not null, model text not null,
  input_tokens integer not null check (input_tokens >= 0), cached_input_tokens integer not null check (cached_input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0), estimated_cost numeric not null check (estimated_cost >= 0), created_at timestamptz not null
);
create table if not exists idempotency_records (
  operation text not null, idempotency_key text not null, payload_hash char(64) not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(operation, idempotency_key)
);

-- This is a local single-user server-side database. RLS is enabled and there are
-- intentionally no anon policies; the server database owner/service role is the
-- only supported access path.
do $$ declare table_name text; begin
  foreach table_name in array array['factory_projects','project_versions','workflow_documents','clarification_questions','clarification_answers','design_direction_sets','design_directions','selected_designs','agent_tasks','task_dependencies','decision_records','quality_reports','quality_checks','release_reports','workflow_events','cost_records','idempotency_records'] loop
    execute format('alter table %I enable row level security', table_name);
  end loop;
end $$;
