import type { DecisionRecord } from "@/domain/workflow/decision";
import type { ClarificationSession } from "@/domain/requirements/schema";
import type { BriefDraft, BriefRevisionDraft, ClarificationPlan, ClarificationProposalInput, LeadAgentAnalysis, LeadAgentInput } from "./contracts";
import type { RequirementSpecification } from "@/domain/requirements/schema";
import type { OperatorLanguage, SiteLanguageDecision } from "@/domain/language/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";

export type BriefRevisionProviderInput = {
  projectId: string;
  projectVersion: number;
  originalPrompt: string;
  currentBrief: RequirementSpecification;
  currentCanonicalRequirements: RequirementSpecification;
  revisionInstruction: string;
  requirementKeys: string[];
  operatorLanguage: OperatorLanguage;
  siteLanguage: SiteLanguageDecision;
  currentWorkflowState: string;
};
export interface LeadAnalysisProvider { analyzePrompt(input: LeadAgentInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<LeadAgentAnalysis>; proposeClarifications(input: ClarificationProposalInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<ClarificationPlan>; assembleBriefDraft(input: { analysis: LeadAgentAnalysis; session: ClarificationSession }, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<BriefDraft>; reviseBrief?(input: BriefRevisionProviderInput, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<BriefRevisionDraft | BriefDraft | undefined>; }
export interface SkillSelectionPort { select(input: { role: "lead"; taskType: "clarify-requirements" | "create-requirements-spec" }): Promise<string[]>; }
export interface LeadMemoryPort { writeSnapshot(projectId: string, projectVersion: number, documents: Record<string, unknown>): Promise<void>; appendDecision(projectId: string, projectVersion: number, decision: DecisionRecord): Promise<void>; verify(projectId: string, projectVersion: number): Promise<boolean>; checksums(projectId: string, projectVersion: number): Promise<Record<string, string>>; }
export class EmptySkillSelectionPort implements SkillSelectionPort { async select() { return []; } }
export class DeterministicLeadProvider implements LeadAnalysisProvider { constructor(private readonly analyze: (input: LeadAgentInput) => LeadAgentAnalysis, private readonly plan: (input: { analysis: LeadAgentAnalysis; session?: ClarificationSession }) => ClarificationPlan, private readonly brief: (input: { analysis: LeadAgentAnalysis; session: ClarificationSession }) => BriefDraft, private readonly revision?: (input: BriefRevisionProviderInput) => BriefRevisionDraft | BriefDraft | Promise<BriefRevisionDraft | BriefDraft>) {} async analyzePrompt(input: LeadAgentInput) { return this.analyze(input); } async proposeClarifications(input: ClarificationProposalInput) { return this.plan(input); } async assembleBriefDraft(input: { analysis: LeadAgentAnalysis; session: ClarificationSession }) { return this.brief(input); } async reviseBrief(input: BriefRevisionProviderInput) { return this.revision?.(input); } }
