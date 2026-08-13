-- Correct the legacy smoke provenance backfill using PostgreSQL word-boundary
-- syntax. The project title is deliberately not part of this classification.
update factory_projects
set origin = 'SMOKE'
where origin = 'USER'
  and slug like 'real-e2e-%'
  and original_prompt ~* '\msynthetic\M';
