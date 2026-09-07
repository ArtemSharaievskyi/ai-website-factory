-- Keep the persistence state contract aligned with the canonical pre-Planning
-- and explicit Planning-approval workflow frontiers.
alter table if exists factory_projects drop constraint if exists factory_projects_workflow_state_check;
alter table if exists factory_projects add constraint factory_projects_workflow_state_check check (workflow_state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_PLANNING_GENERATION','AWAITING_PLANNING_APPROVAL','AWAITING_DESIGN_SELECTION','ARCHITECTURE_REVIEW','READY_FOR_IMPLEMENTATION','CONTRACT_AUDIT','IMPLEMENTING','CODE_INTEGRATION_REVIEW','SECURITY_REVIEW','VALIDATING','TEST_QUALITY_REVIEW','REPAIRING','PROJECT_READY','FAILED'));

alter table if exists project_versions drop constraint if exists project_versions_state_check;
alter table if exists project_versions add constraint project_versions_state_check check (state in ('DRAFT','CLARIFYING','AWAITING_BRIEF_APPROVAL','AWAITING_PLANNING_GENERATION','AWAITING_PLANNING_APPROVAL','AWAITING_DESIGN_SELECTION','ARCHITECTURE_REVIEW','READY_FOR_IMPLEMENTATION','CONTRACT_AUDIT','IMPLEMENTING','CODE_INTEGRATION_REVIEW','SECURITY_REVIEW','VALIDATING','TEST_QUALITY_REVIEW','REPAIRING','PROJECT_READY','FAILED'));
