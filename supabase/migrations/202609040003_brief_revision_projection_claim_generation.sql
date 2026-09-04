-- Keep claim generations monotonic and non-negative.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'brief_revision_projection_sync'::regclass and conname = 'brief_revision_projection_claim_generation_check') then
    alter table brief_revision_projection_sync add constraint brief_revision_projection_claim_generation_check
      check (claim_generation >= 0);
  end if;
end $$;
