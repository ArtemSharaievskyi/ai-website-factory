alter table factory_project_assets
  drop constraint if exists factory_project_assets_source_check;

alter table factory_project_assets
  add constraint factory_project_assets_source_check
  check (source in ('USER_SUPPLIED', 'AI_GENERATED'));

alter table factory_project_assets
  add column if not exists generation_provenance jsonb;

alter table factory_project_assets
  add constraint factory_project_assets_generation_provenance_check
  check ((source = 'USER_SUPPLIED' and generation_provenance is null) or (source = 'AI_GENERATED' and generation_provenance is not null));
