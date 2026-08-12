import { z } from "zod";
import type { WorkflowState } from "@/domain/workflow/engine";

export const WORKBENCH_REQUEST_BYTES = 128 * 1024;

export const WorkbenchActionSchema = z.enum([
  "ANSWER_LEAD_CLARIFICATIONS",
  "APPROVE_BRIEF",
  "REQUEST_BRIEF_CHANGES",
  "APPROVE_PLANNING",
  "REQUEST_PLANNING_CHANGES",
  "DATABASE_DECISION",
  "DEPENDENCY_APPROVAL",
  "DESIGN_SELECTION",
  "START_IMPLEMENTATION",
]);
export type WorkbenchAction = z.infer<typeof WorkbenchActionSchema>;

const ProjectIdSchema = z.string().uuid();
const AnswerSchema = z.object({
  questionId: ProjectIdSchema,
  status: z.enum(["answered", "not-applicable", "deferred", "unresolved"]).optional(),
  answer: z.string().max(WORKBENCH_REQUEST_BYTES).optional(),
}).strict();

export const WorkbenchRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestText: z.string().min(1).max(WORKBENCH_REQUEST_BYTES), languageHint: z.string().max(64).optional() }).strict(),
  z.object({ action: z.literal("status"), projectId: ProjectIdSchema }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("respond"), projectId: ProjectIdSchema, answers: z.array(AnswerSchema).min(1).max(40) }).strict(),
  z.object({ action: z.literal("approve-brief"), projectId: ProjectIdSchema, briefChecksum: z.string().regex(/^[a-f0-9]{64}$/), expectedRowVersion: z.number().int().positive(), approvalNote: z.string().max(4000).optional() }).strict(),
  z.object({ action: z.literal("request-brief-changes"), projectId: ProjectIdSchema, reason: z.string().trim().min(1).max(4000), requirementKeys: z.array(z.string().min(1).max(128)).max(40).default([]) }).strict(),
  z.object({ action: z.literal("approve-planning"), projectId: ProjectIdSchema }).strict(),
  z.object({ action: z.literal("request-planning-changes"), projectId: ProjectIdSchema, reason: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("database-decision"), projectId: ProjectIdSchema, mode: z.enum(["NONE", "SUPABASE_NEW", "SUPABASE_EXISTING"]), reason: z.string().max(4000).optional() }).strict(),
  z.object({ action: z.literal("dependency-approval"), projectId: ProjectIdSchema }).strict(),
  z.object({ action: z.literal("design-selection"), projectId: ProjectIdSchema, selectedDirectionId: ProjectIdSchema }).strict(),
  z.object({ action: z.literal("start-implementation"), projectId: ProjectIdSchema }).strict(),
]);
export type WorkbenchRequest = z.infer<typeof WorkbenchRequestSchema>;

export type WorkbenchProject = {
  projectId: string;
  name: string;
  slug: string;
  workflowState: WorkflowState;
  statusLabel: string;
  updatedAt: string;
};

export type WorkbenchQuestion = {
  id: string;
  requirementKey?: string;
  category: string;
  question: string;
  blocking: boolean;
  required: boolean;
  answerStatus: string;
  answer?: string;
};

export type WorkbenchBrief = {
  checksum: string;
  readyForApproval: boolean;
  approved: boolean;
  projectSummary?: string;
  businessGoals: string[];
  targetAudiences: string[];
  pages: string[];
  features: string[];
  forms: string[];
  imageStrategy?: string;
  constraints: string[];
};

export type WorkbenchPlanning = {
  checksum: string;
  accepted: boolean;
  architecture: string;
  routes: string[];
  majorFeatures: string[];
  databaseRecommendation?: string;
  dependencies: Array<{ name: string; purpose: string; runtime: string; required: boolean }>;
  blockers: string[];
};

export type WorkbenchDatabase = {
  packageChecksum: string;
  recommendation: string;
  mode: string;
  rationale: string;
  status: string;
  connectionStatus: string;
};

export type WorkbenchDependency = {
  packageName: string;
  versionSpec: string;
  purpose: string;
  approvalRequired: boolean;
  approvalStatus: string;
};

export type WorkbenchDesign = {
  id: string;
  label: string;
  concept: string;
  typography: string;
  layout: string;
  photography: string;
  componentCharacter: string;
  motion: string;
  tradeoffs: string[];
  selected: boolean;
  checksum?: string;
};

export type ConversationEntry = {
  entryId: string;
  actor: "USER" | "FACTORY" | "SYSTEM";
  kind: "MESSAGE" | "CLARIFICATION" | "BRIEF" | "PLANNING" | "DATABASE_DECISION" | "DEPENDENCY_DECISION" | "DESIGN_DIRECTIONS" | "PROGRESS" | "ERROR";
  title: string;
  text: string;
  status?: "current" | "complete" | "blocked";
};

export type WorkbenchProjection = {
  mode: "NEW_PROJECT" | "PROJECT_WORKBENCH";
  project?: {
    projectId: string;
    name: string;
    slug: string;
    promptPreview: string;
    workflowState: WorkflowState;
    rowVersion: number;
    projectVersion: number;
  };
  status: {
    label: string;
    detail: string;
    stage: "Lead" | "Brief" | "Planning" | "Design" | "Implementation" | "Review" | "Complete";
    pendingUserAction: string;
    allowedActions: WorkbenchAction[];
    canCompose: boolean;
  };
  questions: WorkbenchQuestion[];
  brief?: WorkbenchBrief;
  planning?: WorkbenchPlanning;
  database?: WorkbenchDatabase;
  dependencies: WorkbenchDependency[];
  designs: WorkbenchDesign[];
  selectedDesignId?: string;
  conversation: ConversationEntry[];
  projects: WorkbenchProject[];
  designSetChecksum?: string;
};

const STATUS: Record<WorkflowState, { label: string; detail: string; stage: WorkbenchProjection["status"]["stage"] }> = {
  DRAFT: { label: "Ready for Lead", detail: "Send a project request to begin the controlled workflow.", stage: "Lead" },
  CLARIFYING: { label: "Lead clarification", detail: "Answer the open questions so Lead can prepare a Project Brief.", stage: "Lead" },
  AWAITING_BRIEF_APPROVAL: { label: "Project Brief ready", detail: "Review the current Brief, then approve it or request changes.", stage: "Brief" },
  AWAITING_DESIGN_SELECTION: { label: "Planning and design", detail: "Planning, architecture review, and design selection remain explicit gates.", stage: "Planning" },
  ARCHITECTURE_REVIEW: { label: "Architecture review", detail: "The current planning package is with the read-only architecture gate.", stage: "Review" },
  READY_FOR_IMPLEMENTATION: { label: "Ready to implement", detail: "All current gates must pass before implementation can start.", stage: "Implementation" },
  CONTRACT_AUDIT: { label: "Contract audit", detail: "The pre-implementation contract chain is being checked.", stage: "Review" },
  IMPLEMENTING: { label: "Implementation started", detail: "The canonical task graph owns implementation progress.", stage: "Implementation" },
  CODE_INTEGRATION_REVIEW: { label: "Code review", detail: "The read-only Code / Integration Reviewer owns this gate.", stage: "Review" },
  SECURITY_REVIEW: { label: "Security review", detail: "The read-only Security Reviewer owns this gate.", stage: "Review" },
  VALIDATING: { label: "Validation", detail: "Deterministic validation and QA evidence are in progress.", stage: "Review" },
  TEST_QUALITY_REVIEW: { label: "Test / Quality review", detail: "Semantic quality sufficiency is being reviewed.", stage: "Review" },
  REPAIRING: { label: "Repairing", detail: "A bounded canonical repair path is active.", stage: "Review" },
  PROJECT_READY: { label: "Complete", detail: "The current project version is ready.", stage: "Complete" },
  FAILED: { label: "Needs attention", detail: "The workflow recorded a failure and requires explicit recovery.", stage: "Review" },
};

export function actionsForWorkbenchState(input: {
  workflowState: WorkflowState;
  hasBlockingQuestions: boolean;
  hasBrief: boolean;
  briefReady: boolean;
  hasPlanning: boolean;
  hasDesigns: boolean;
  implementationReady?: boolean;
}): WorkbenchAction[] {
  switch (input.workflowState) {
    case "CLARIFYING": return input.hasBlockingQuestions ? ["ANSWER_LEAD_CLARIFICATIONS"] : [];
    case "AWAITING_BRIEF_APPROVAL": return input.hasBrief && input.briefReady ? ["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"] : [];
    case "AWAITING_DESIGN_SELECTION":
      return [
        ...(!input.hasPlanning ? ["APPROVE_PLANNING"] as WorkbenchAction[] : []),
        ...(input.hasPlanning ? ["APPROVE_PLANNING", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL"] as WorkbenchAction[] : []),
        ...(input.hasDesigns ? ["DESIGN_SELECTION"] as WorkbenchAction[] : []),
      ];
    case "READY_FOR_IMPLEMENTATION": return input.implementationReady ? ["START_IMPLEMENTATION"] : [];
    default: return [];
  }
}

export function workbenchStatus(state: WorkflowState, allowedActions: WorkbenchAction[], hasBlockingQuestions: boolean): WorkbenchProjection["status"] {
  const current = STATUS[state];
  return {
    label: current.label,
    detail: current.detail,
    stage: current.stage,
    pendingUserAction: allowedActions[0] ?? (hasBlockingQuestions ? "ANSWER_LEAD_CLARIFICATIONS" : "WAIT_FOR_WORKFLOW_OWNER"),
    allowedActions,
    canCompose: state === "CLARIFYING" || allowedActions.includes("REQUEST_BRIEF_CHANGES") || allowedActions.includes("REQUEST_PLANNING_CHANGES"),
  };
}

export const projectStatusLabel = (state: WorkflowState) => STATUS[state].label;
