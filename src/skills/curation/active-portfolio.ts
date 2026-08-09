import { z } from "zod";

export const ActivePortfolioSkillSchema = z.object({
  skillId: z.string().min(1),
  sourceType: z.enum(["internal", "skills-sh"]),
  version: z.string().min(1),
  normalizedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  coverageKeys: z.array(z.string().min(1)),
  assignmentState: z.literal("ACTIVE_APPROVED"),
}).strict();

export const ActivePortfolioAgentSchema = z.object({
  agentId: z.string().min(1),
  approvedAllowedSkillIds: z.array(z.string()),
  skills: z.array(ActivePortfolioSkillSchema),
}).strict();

export const DeferredPortfolioSkillSchema = z.object({
  externalSkillId: z.string().min(1),
  candidateChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  targetAgent: z.string().min(1),
  decision: z.enum(["DEFERRED_FROM_INITIAL_PORTFOLIO", "NOT_SELECTED_INITIAL_PORTFOLIO"]),
  reason: z.string().min(1),
  futureReconsiderationAllowed: z.literal(true),
  runtimeResolvable: z.literal(false),
}).strict();

export const ActiveAgentSkillPortfolioSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal("4D4"),
  generatedAt: z.string().datetime(),
  sourceOfTruth: z.literal("docs/admin/skill-curation/initial-portfolio-license-decisions-2026-08-09.json"),
  approvedExternalSkillCount: z.literal(4),
  approvedInternalSkillCount: z.literal(13),
  totalApprovedSkillArtifacts: z.literal(17),
  uniqueActiveAssignmentReferenceCount: z.literal(18),
  agents: z.array(ActivePortfolioAgentSchema).length(9),
  deferredCandidates: z.array(DeferredPortfolioSkillSchema).length(3),
  skillCountQuotaIntroduced: z.literal(false),
  approvalCalled: z.literal(true),
  assignmentsChanged: z.literal(true),
  networkCalls: z.literal(0),
  vercelOidcTokenRequired: z.literal(false),
  runtimeResolverRedesigned: z.literal(false),
}).strict();

export type ActiveAgentSkillPortfolio = z.infer<typeof ActiveAgentSkillPortfolioSchema>;

export function buildActiveAgentSkillPortfolio(input: z.input<typeof ActiveAgentSkillPortfolioSchema>) {
  return ActiveAgentSkillPortfolioSchema.parse(input);
}
