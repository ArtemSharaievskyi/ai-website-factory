-- Scope the claim-state guard to the table resolved in the active schema.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'brief_revision_projection_sync'::regclass and conname = 'brief_revision_projection_claim_state_check') then
    alter table brief_revision_projection_sync add constraint brief_revision_projection_claim_state_check
      check ((lease_owner is null and lease_expires_at is null) or (lease_owner is not null and lease_expires_at is not null));
  end if;
end $$;
