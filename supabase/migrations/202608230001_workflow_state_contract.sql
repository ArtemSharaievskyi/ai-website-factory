-- Keep the database workflow-state checks aligned with the host-owned workflow engine.
-- Planning Acceptance must be able to commit its canonical ARCHITECTURE_REVIEW state.
alter table if exists factory_projects drop constraint if exists factory_projects_workflow_state_check;
alter table if exists factory_projects add constraint factory_projects_workflow_state_check check (workflow_state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_DESIGN_SELECTION','ARCHITECTURE_REVIEW','READY_FOR_IMPLEMENTATION','CONTRACT_AUDIT','IMPLEMENTING','CODE_INTEGRATION_REVIEW','SECURITY_REVIEW','VALIDATING','TEST_QUALITY_REVIEW','REPAIRING','PROJECT_READY','FAILED'));

alter table if exists project_versions drop constraint if exists project_versions_state_check;
alter table if exists project_versions add constraint project_versions_state_check check (state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_DESIGN_SELECTION','ARCHITECTURE_REVIEW','READY_FOR_IMPLEMENTATION','CONTRACT_AUDIT','IMPLEMENTING','CODE_INTEGRATION_REVIEW','SECURITY_REVIEW','VALIDATING','TEST_QUALITY_REVIEW','REPAIRING','PROJECT_READY','FAILED'));
