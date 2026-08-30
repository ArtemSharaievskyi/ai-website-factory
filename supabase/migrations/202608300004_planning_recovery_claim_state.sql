-- Split durable Planning Recovery ownership from provider-attempt consumption.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'planning_recovery_runs'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%state%'
        or pg_get_constraintdef(oid) ilike '%terminal_outcome%'
        or pg_get_constraintdef(oid) ilike '%committed_evidence_id%'
      )
  loop
    execute format('alter table planning_recovery_runs drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table planning_recovery_runs
  add constraint planning_recovery_runs_state_check
    check (state in ('CREATED','CLAIMED','PROVIDER_CALL_STARTED','PROVIDER_RETURNED','ADMISSION_STARTED','ADMISSION_PASSED','PERSISTENCE_STARTED','COMMITTED','COMMITTED_RECONCILED','PROVIDER_FAILED','PROVIDER_SEMANTIC_FAILED','ADMISSION_FAILED','CURRENTNESS_FAILED','PERSISTENCE_FAILED','CANCELLED','ABANDONED','OUTCOME_INDETERMINATE')),
  add constraint planning_recovery_runs_lease_state_check
    check (
      (state = 'CREATED' and provider_attempt_count = 0 and lease_owner is null and lease_expires_at is null)
      or (state = 'CLAIMED' and provider_attempt_count = 0 and lease_owner is not null and lease_expires_at is not null)
      or (state not in ('CREATED','CLAIMED','COMMITTED','COMMITTED_RECONCILED','PROVIDER_FAILED','PROVIDER_SEMANTIC_FAILED','ADMISSION_FAILED','CURRENTNESS_FAILED','PERSISTENCE_FAILED','CANCELLED','ABANDONED','OUTCOME_INDETERMINATE') and lease_owner is not null and lease_expires_at is not null)
      or (state in ('COMMITTED','COMMITTED_RECONCILED','PROVIDER_FAILED','PROVIDER_SEMANTIC_FAILED','ADMISSION_FAILED','CURRENTNESS_FAILED','PERSISTENCE_FAILED','CANCELLED','ABANDONED','OUTCOME_INDETERMINATE') and lease_owner is null and lease_expires_at is null)
    ),
  add constraint planning_recovery_runs_terminal_outcome_check
    check (
      (state in ('COMMITTED','COMMITTED_RECONCILED','PROVIDER_FAILED','PROVIDER_SEMANTIC_FAILED','ADMISSION_FAILED','CURRENTNESS_FAILED','PERSISTENCE_FAILED','CANCELLED','ABANDONED','OUTCOME_INDETERMINATE') and terminal_outcome is not null)
      or (state not in ('COMMITTED','COMMITTED_RECONCILED','PROVIDER_FAILED','PROVIDER_SEMANTIC_FAILED','ADMISSION_FAILED','CURRENTNESS_FAILED','PERSISTENCE_FAILED','CANCELLED','ABANDONED','OUTCOME_INDETERMINATE') and terminal_outcome is null)
    ),
  add constraint planning_recovery_runs_committed_evidence_check
    check ((state in ('COMMITTED','COMMITTED_RECONCILED') and committed_evidence_id is not null) or (state not in ('COMMITTED','COMMITTED_RECONCILED') and committed_evidence_id is null));
