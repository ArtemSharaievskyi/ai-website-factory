-- Preserve bounded, safe provider failure evidence without changing attempt identity or lifecycle.
alter table brief_revision_attempts add column if not exists failure_diagnostics jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brief_revision_attempts_failure_diagnostics_array_check') then
    alter table brief_revision_attempts add constraint brief_revision_attempts_failure_diagnostics_array_check
      check (failure_diagnostics is null or jsonb_typeof(failure_diagnostics) = 'array');
  end if;
end $$;
