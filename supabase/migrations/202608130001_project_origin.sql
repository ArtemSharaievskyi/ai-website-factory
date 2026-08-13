-- Typed project provenance keeps synthetic infrastructure records out of the
-- normal Workbench navigation without deleting any persisted project data.
alter table factory_projects add column if not exists origin text;

-- Legacy real-E2E records carry an explicit smoke boundary in their slug and
-- an explicit synthetic marker in the original request. This is provenance
-- backfill, not customer-name matching.
update factory_projects
set origin = 'SMOKE'
where origin is null
  and slug like 'real-e2e-%'
  and original_prompt ~* '\m synthetic \M';

update factory_projects
set origin = 'USER'
where origin is null;

alter table factory_projects alter column origin set default 'USER';
alter table factory_projects alter column origin set not null;
alter table factory_projects add constraint factory_projects_origin_ck
  check (origin in ('USER','REAL','TEST','FIXTURE','SYNTHETIC','SMOKE','QA','REVIEW','DEMO'));
