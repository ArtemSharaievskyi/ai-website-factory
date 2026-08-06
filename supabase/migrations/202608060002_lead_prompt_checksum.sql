-- Lead Agent intake integrity: the original prompt is retained verbatim except
-- for normalized line endings, with a separately queryable SHA-256 checksum.
-- The parent table already has row-level security; this metadata-only migration
-- does not create a new table or weaken the existing enable row level security policy.
alter table factory_projects add column if not exists original_prompt_checksum char(64);

update factory_projects
set original_prompt_checksum = encode(digest(replace(replace(original_prompt, E'\r\n', E'\n'), E'\r', E'\n'), 'sha256'), 'hex')
where original_prompt_checksum is null;

alter table factory_projects alter column original_prompt_checksum set not null;
alter table factory_projects add constraint factory_projects_original_prompt_checksum_ck
  check (original_prompt_checksum ~ '^[a-f0-9]{64}$');
