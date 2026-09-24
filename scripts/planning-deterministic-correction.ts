import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { createProductionFactoryRuntime } from "@/runtime/production-factory-runtime-core";
import { DocumentRepository, ProjectRepository } from "@/persistence/database/repositories";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { planningSemanticChecksum } from "@/agents/planner/deterministic";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

const projectId = process.env.PLANNING_CORRECTION_PROJECT_ID ?? "ec5549cb-b4b5-4906-8667-7767ff71708e";
const expectedBriefChecksum = process.env.PLANNING_CORRECTION_BRIEF_CHECKSUM ?? "2e6bc44e263a5e2412bb1c1aabf83519498293c4698e2f0476c72c36115204ba";
const expectedPlanningSemanticChecksum = process.env.PLANNING_CORRECTION_PLANNING_CHECKSUM ?? "97f98c56bc5e9fdc787ef25c8ae63621cc3c70487200c7726e595aa5a959ead5";
const expectedProjectRowVersion = Number(process.env.PLANNING_CORRECTION_PROJECT_ROW_VERSION ?? "12");

loadEnvConfig(process.cwd());
const generatedProjectsRoot = path.resolve(process.env.GENERATED_PROJECTS_ROOT ?? ".factory-generated");
const runtime = createProductionFactoryRuntime({ env: process.env, generatedProjectsRoot, allowWeb: true });
try {
  const projects = new ProjectRepository(runtime.database);
  const documents = new DocumentRepository(runtime.database);
  const current = await projects.getWithVersion(projectId);
  if (!current) throw new Error("PLANNING_CORRECTION_PROJECT_NOT_FOUND");
  const planning = await documents.get(projectId, current.project.currentVersion, "planning-package");
  const briefV3 = await documents.get(projectId, current.project.currentVersion, "brief-v3");
  if (!planning || planning.documentType !== "planning-package" || !briefV3 || briefV3.documentType !== "brief-v3") throw new Error("PLANNING_CORRECTION_CANONICAL_READ_FAILED");
  const parsedBrief = BriefV3DocumentSchema.parse(briefV3);
  const parsedPlanning = PlanningPackageSchema.parse(planning);
  if (current.rowVersion !== expectedProjectRowVersion || current.project.currentVersion !== 1 || current.project.workflowState !== "AWAITING_PLANNING_APPROVAL" || parsedBrief.briefChecksum !== expectedBriefChecksum || planningSemanticChecksum(parsedPlanning) !== expectedPlanningSemanticChecksum) throw new Error("PLANNING_CORRECTION_PREFLIGHT_CHANGED");
  const scope = runtime.createProjectScope({ workspaceRoot: generatedProjectsRoot, slug: current.project.slug });
  const operationKey = `planning-deterministic-correction:${projectId}:v${current.project.currentVersion}:${expectedPlanningSemanticChecksum}:v1`;
  const result = await scope.planner.correctUnapprovedPlanningDeterministically({ projectId, projectVersion: 1, expectedProjectRowVersion, expectedBriefChecksum, expectedPlanningSemanticChecksum, operationKey });
  console.log(JSON.stringify({ status: result.status, projectId, projectVersion: 1, providerCalls: result.providerCalls, operationKey, previousPlanningSemanticChecksum: planningSemanticChecksum(result.previousPlanning), nextPlanningSemanticChecksum: planningSemanticChecksum(result.package), nextPlanningDocumentChecksum: checksumPersistedDocument(result.package), correctionKinds: result.entry.correctionKinds }));
} finally {
  await runtime.close();
}
