-- Additive migration: explicit customer-site language and project-scoped user asset intake.
alter table factory_projects add column if not exists site_language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'factory_projects_site_language_check'
  ) then
    alter table factory_projects add constraint factory_projects_site_language_check
      check (site_language is null or site_language = 'UNRESOLVED' or site_language ~ '^[a-z]{2}(-[A-Z]{2})?$');
  end if;
end $$;

create table if not exists factory_project_assets (
  schema_version integer not null default 1 check (schema_version = 1),
  asset_id uuid primary key,
  project_id uuid not null references factory_projects(id) on delete cascade,
  project_version integer not null check (project_version > 0),
  category text not null check (category in ('LOGO', 'IMAGE', 'REFERENCE', 'DOCUMENT')),
  source text not null check (source = 'USER_SUPPLIED'),
  safe_display_name text not null check (char_length(safe_display_name) between 1 and 160 and safe_display_name !~ '[\\/]'),
  media_type text not null check (media_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_identity text not null check (storage_identity ~ '^projects/[0-9a-f-]+/assets/[0-9a-f-]+/(png|jpg|webp|pdf)$'),
  status text not null check (status in ('UPLOADING', 'READY', 'REJECTED', 'REMOVED', 'SUPERSEDED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  asset_version integer not null check (asset_version > 0),
  currentness text not null check (currentness in ('CURRENT', 'SUPERSEDED')),
  supersedes_asset_id uuid,
  rejection_reason text,
  unique (project_id, asset_id),
  foreign key (project_id, supersedes_asset_id) references factory_project_assets(project_id, asset_id)
);

alter table factory_project_assets enable row level security;

create index if not exists factory_project_assets_project_idx on factory_project_assets (project_id, created_at desc, asset_id desc);
create index if not exists factory_project_assets_current_idx on factory_project_assets (project_id, status, currentness);
create index if not exists factory_project_assets_hash_idx on factory_project_assets (project_id, sha256, category);
