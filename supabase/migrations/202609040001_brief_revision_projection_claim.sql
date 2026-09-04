-- Add a generation-bound lease so only one worker may execute a projection job.
alter table brief_revision_projection_sync
  add column if not exists claim_generation integer not null default 0,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brief_revision_projection_claim_state_check') then
    alter table brief_revision_projection_sync add constraint brief_revision_projection_claim_state_check
      check ((lease_owner is null and lease_expires_at is null) or (lease_owner is not null and lease_expires_at is not null));
  end if;
end $$;

create index if not exists brief_revision_projection_claim_idx
  on brief_revision_projection_sync(status, next_attempt_at, lease_expires_at, created_at, id);
