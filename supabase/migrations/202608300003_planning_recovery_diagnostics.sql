-- Additive bounded diagnostics for host-owned Planning Recovery terminal outcomes.
alter table planning_recovery_runs
  add column if not exists diagnostic_summary jsonb;
