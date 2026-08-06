import type { LeadAnalysisProvider } from "../lead/ports";
import { BriefDraftSchema, ClarificationPlanSchema, LeadAgentAnalysisSchema, type BriefDraft, type ClarificationPlan, type LeadAgentAnalysis } from "../lead/contracts";
import type { PlannerArchitectureProvider } from "../planner/ports";
import { PlanningPackageSchema, type PlanningPackage } from "../planner/contracts";
import type { DesignDirectionProvider } from "../design-agent/ports";
import { DesignDirectionSetSchema, type DesignDirectionSet } from "../domain/design/schema";
import type { ImplementationProvider, ImplementationContext, ImplementationChangeProposal } from "../implementation-agent/contracts";
import { ImplementationChangeProposalSchema } from "../implementation-agent/contracts";
import { OpenAiStructuredClient } from "./client";
import { rolePrompt } from "./prompts";
import type { ProviderUsageSink } from "./usage";
import type { OrchestrationPlanningProvider } from "../orchestrator/service";
import { z } from "zod";
const OrchestrationPlanSchema = z.object({ tasks: z.array(z.unknown()) }).strict();

export class OpenAiLeadProvider implements LeadAnalysisProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async analyzePrompt(input: Parameters<LeadAnalysisProvider["analyzePrompt"]>[0]): Promise<LeadAgentAnalysis> { return this.call("lead", input, LeadAgentAnalysisSchema, "lead-analysis", "lead-analysis"); }
  async proposeClarifications(input: Parameters<LeadAnalysisProvider["proposeClarifications"]>[0]): Promise<ClarificationPlan> { return this.call("lead", input, ClarificationPlanSchema, "clarification-plan", "lead-clarifications"); }
  async assembleBriefDraft(input: Parameters<LeadAnalysisProvider["assembleBriefDraft"]>[0]): Promise<BriefDraft> { return this.call("lead", input, BriefDraftSchema, "brief-draft", "lead-brief"); }
  private async call<T>(role: "lead", input: unknown, schema: typeof LeadAgentAnalysisSchema | typeof ClarificationPlanSchema | typeof BriefDraftSchema, schemaName: string, idempotencyKey: string): Promise<T> { const prompt = rolePrompt(role, input); return (await this.ai.request<T>({ ...prompt, role, schema: schema as never, schemaName, idempotencyKey })).value; }
}
export class OpenAiPlannerProvider implements PlannerArchitectureProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async plan(input: Parameters<PlannerArchitectureProvider["plan"]>[0]): Promise<PlanningPackage> { const prompt = rolePrompt("planner", input); return (await this.ai.request<PlanningPackage>({ ...prompt, role: "planner", schema: PlanningPackageSchema, schemaName: "planning-package", idempotencyKey: input.idempotencyKey })).value; }
}
export class OpenAiDesignProvider implements DesignDirectionProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async proposeDesignDirections(input: Parameters<DesignDirectionProvider["proposeDesignDirections"]>[0]): Promise<DesignDirectionSet> { const prompt = rolePrompt("design", input); return (await this.ai.request<DesignDirectionSet>({ ...prompt, role: "design", schema: DesignDirectionSetSchema, schemaName: "design-direction-set", idempotencyKey: input.idempotencyKey })).value; }
}
export class OpenAiImplementationProvider implements ImplementationProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async proposeTaskChanges(context: ImplementationContext, signal?: AbortSignal): Promise<ImplementationChangeProposal> { const prompt = rolePrompt("implementation", context); return (await this.ai.request<ImplementationChangeProposal>({ ...prompt, role: "implementation", schema: ImplementationChangeProposalSchema, schemaName: "implementation-change-proposal", signal, idempotencyKey: `${context.task.id}:${context.contextChecksum}` })).value; }
}
export class OpenAiOrchestrationProvider implements OrchestrationPlanningProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async plan(input: unknown, signal?: AbortSignal) { const prompt = rolePrompt("orchestrator", input); return (await this.ai.request({ ...prompt, role: "orchestrator", schema: OrchestrationPlanSchema, schemaName: "orchestration-plan", signal })).value as { tasks: unknown[] }; }
}
export function createProviderAdapters(ai: OpenAiStructuredClient) { return { lead: new OpenAiLeadProvider(ai), planner: new OpenAiPlannerProvider(ai), design: new OpenAiDesignProvider(ai), implementation: new OpenAiImplementationProvider(ai), orchestrator: new OpenAiOrchestrationProvider(ai) }; }
export type { ProviderUsageSink };
