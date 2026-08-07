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
import { IsoDateTimeSchema, NonEmptyStringSchema } from "../domain/shared/schemas";
import { RequirementSpecificationSchema } from "../domain/requirements/schema";
import { AssetManifestEntrySchema, AssetManifestSchema } from "../domain/assets/schema";
import { TechnicalArchitectureSchema } from "../domain/architecture/schema";
import { SitemapPlanSchema, UserFlowPlanSchema, TraceabilitySchema } from "../planner/contracts";
const OrchestrationPlanSchema = z.object({ tasks: z.array(z.unknown()) }).strict();

const BriefStructuredApprovalSchema = z.object({ approved: z.boolean(), approvedAt: IsoDateTimeSchema.nullable(), approvedBy: NonEmptyStringSchema.nullable(), approvedRequirementsChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
const BriefStructuredAnalysisMetadataSchema = z.object({ provider: z.string(), originalPromptChecksum: z.string().regex(/^[a-f0-9]{64}$/), unsupportedAssumptions: z.array(z.string()), contradictionCount: z.number().int().nonnegative() }).strict();
/** Strict-output transport shape; nullable values are normalized into the canonical Brief domain shape below. */
export const BriefDraftStructuredOutputSchema = BriefDraftSchema.extend({ requirements: RequirementSpecificationSchema.extend({ approval: BriefStructuredApprovalSchema, projectTitle: NonEmptyStringSchema.nullable(), analysisMetadata: BriefStructuredAnalysisMetadataSchema.nullable(), briefApprovalNote: z.string().nullable() }) });
function normalizeBriefDraft(value: z.infer<typeof BriefDraftStructuredOutputSchema>): BriefDraft {
  const { requirements } = value;
  const { approval, projectTitle, analysisMetadata, briefApprovalNote, ...canonicalFields } = requirements;
  const normalizedRequirements = { ...canonicalFields, approval: { approved: approval.approved, ...(approval.approvedAt === null ? {} : { approvedAt: approval.approvedAt }), ...(approval.approvedBy === null ? {} : { approvedBy: approval.approvedBy }), ...(approval.approvedRequirementsChecksum === null ? {} : { approvedRequirementsChecksum: approval.approvedRequirementsChecksum }) }, ...(projectTitle === null ? {} : { projectTitle }), ...(analysisMetadata === null ? {} : { analysisMetadata }), ...(briefApprovalNote === null ? {} : { briefApprovalNote }) };
  return BriefDraftSchema.parse({ ...value, requirements: normalizedRequirements });
}

const StrictTraceabilitySchema = TraceabilitySchema.extend({ unresolvedDependency: z.string().nullable() });
const StrictRouteSchema = z.object({ id: NonEmptyStringSchema, requirementReferences: z.array(NonEmptyStringSchema).min(1), path: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/), titlePurpose: NonEmptyStringSchema, pageType: z.enum(["landing", "content", "form", "dashboard", "auth", "legal", "application"]), visibility: z.enum(["public", "protected"]), intendedUser: NonEmptyStringSchema, primaryGoal: NonEmptyStringSchema, primaryCta: NonEmptyStringSchema.nullable(), contentResponsibilities: z.array(NonEmptyStringSchema), dataDependencies: z.array(NonEmptyStringSchema), formDependencies: z.array(NonEmptyStringSchema), authRequired: z.boolean(), seoRelevant: z.boolean(), parentId: NonEmptyStringSchema.nullable(), navigationVisible: z.boolean() }).strict();
const StrictStepSchema = z.object({ order: z.number().int().positive(), description: NonEmptyStringSchema, routeId: NonEmptyStringSchema.nullable(), decision: NonEmptyStringSchema.nullable() }).strict();
const StrictFlowSchema = z.object({ id: NonEmptyStringSchema, requirementReferences: z.array(NonEmptyStringSchema).min(1), actor: NonEmptyStringSchema, trigger: NonEmptyStringSchema, startRoute: NonEmptyStringSchema, steps: z.array(StrictStepSchema), dataCreated: z.array(NonEmptyStringSchema), dataRead: z.array(NonEmptyStringSchema), dataUpdated: z.array(NonEmptyStringSchema), successOutcome: NonEmptyStringSchema, failureOutcomes: z.array(NonEmptyStringSchema), authorizationRequirements: z.array(NonEmptyStringSchema), formRequirements: z.array(NonEmptyStringSchema), emailRequirements: z.array(NonEmptyStringSchema), storageRequirements: z.array(NonEmptyStringSchema), acceptanceCriteria: z.array(NonEmptyStringSchema) }).strict();
const StrictArchitectureSchema = z.object({ ...TechnicalArchitectureSchema.shape, backendPriority: z.array(z.enum(["server-actions", "route-handlers", "supabase-services"])).min(3), npmScripts: z.array(z.object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema }).strict()), acceptance: z.object({ accepted: z.boolean(), acceptedAt: IsoDateTimeSchema.nullable(), acceptedBy: NonEmptyStringSchema.nullable() }).strict() }).strict();
const StrictPlanningAcceptanceSchema = z.object({ acceptedAt: IsoDateTimeSchema.nullable(), acceptedBy: NonEmptyStringSchema.nullable(), checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
const StrictAssetManifestSchema = z.object({ ...AssetManifestSchema.shape, entries: z.array(z.object({ ...AssetManifestEntrySchema.shape, consistencyGroup: NonEmptyStringSchema.nullable() }).strict()) }).strict();
export const PlanningPackageStructuredOutputSchema = PlanningPackageSchema.extend({
  productScope: PlanningPackageSchema.shape.productScope.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  sitemap: SitemapPlanSchema.extend({ routes: z.array(StrictRouteSchema), traceability: z.array(StrictTraceabilitySchema) }),
  navigation: PlanningPackageSchema.shape.navigation.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  pages: PlanningPackageSchema.shape.pages.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  userFlows: UserFlowPlanSchema.extend({ flows: z.array(StrictFlowSchema), traceability: z.array(StrictTraceabilitySchema) }),
  forms: PlanningPackageSchema.shape.forms.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  dataModel: PlanningPackageSchema.shape.dataModel.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  authentication: PlanningPackageSchema.shape.authentication.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  supabase: PlanningPackageSchema.shape.supabase.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  email: PlanningPackageSchema.shape.email.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  storage: PlanningPackageSchema.shape.storage.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  administration: PlanningPackageSchema.shape.administration.extend({ traceability: z.array(StrictTraceabilitySchema) }),
  assets: StrictAssetManifestSchema,
  architecture: StrictArchitectureSchema,
  traceability: z.array(StrictTraceabilitySchema),
  acceptance: StrictPlanningAcceptanceSchema,
});
function omitNull<T extends Record<string, unknown>>(value: T, keys: string[]) { const result = { ...value }; for (const key of keys) if (result[key] === null) delete result[key]; return result; }
function normalizePlanningPackage(value: z.infer<typeof PlanningPackageStructuredOutputSchema>): PlanningPackage {
  const normalized = { ...value, productScope: { ...value.productScope, traceability: value.productScope.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, sitemap: { ...value.sitemap, routes: value.sitemap.routes.map((route) => omitNull(route, ["primaryCta", "parentId"])), traceability: value.sitemap.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, navigation: { ...value.navigation, traceability: value.navigation.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, pages: { ...value.pages, traceability: value.pages.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, userFlows: { ...value.userFlows, flows: value.userFlows.flows.map((flow) => ({ ...flow, steps: flow.steps.map((step) => omitNull(step, ["routeId", "decision"])) })), traceability: value.userFlows.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, forms: { ...value.forms, traceability: value.forms.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, dataModel: { ...value.dataModel, traceability: value.dataModel.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, authentication: { ...value.authentication, traceability: value.authentication.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, supabase: { ...value.supabase, traceability: value.supabase.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, email: { ...value.email, traceability: value.email.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, storage: { ...value.storage, traceability: value.storage.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, administration: { ...value.administration, traceability: value.administration.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, architecture: { ...value.architecture, acceptance: omitNull(value.architecture.acceptance, ["acceptedAt", "acceptedBy"]) }, acceptance: omitNull(value.acceptance, ["acceptedAt", "acceptedBy", "checksum"]), assets: { ...value.assets, entries: value.assets.entries.map((entry) => omitNull(entry, ["consistencyGroup"])) }, traceability: value.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) };
  (normalized as unknown as { architecture: { npmScripts: Record<string, string> } }).architecture.npmScripts = Object.fromEntries(value.architecture.npmScripts.map((script) => [script.name, script.command]));
  return PlanningPackageSchema.parse(normalized);
}

export class OpenAiLeadProvider implements LeadAnalysisProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async analyzePrompt(input: Parameters<LeadAnalysisProvider["analyzePrompt"]>[0]): Promise<LeadAgentAnalysis> { return this.call("lead", input, LeadAgentAnalysisSchema, "lead-analysis", "lead-analysis"); }
  async proposeClarifications(input: Parameters<LeadAnalysisProvider["proposeClarifications"]>[0]): Promise<ClarificationPlan> { return this.call("lead", input, ClarificationPlanSchema, "clarification-plan", "lead-clarifications"); }
  async assembleBriefDraft(input: Parameters<LeadAnalysisProvider["assembleBriefDraft"]>[0]): Promise<BriefDraft> { const prompt = rolePrompt("lead", input); const result = await this.ai.request<z.infer<typeof BriefDraftStructuredOutputSchema>>({ ...prompt, role: "lead", schema: BriefDraftStructuredOutputSchema, schemaName: "brief-draft", idempotencyKey: "lead-brief" }); return normalizeBriefDraft(result.value); }
  private async call<T>(role: "lead", input: unknown, schema: typeof LeadAgentAnalysisSchema | typeof ClarificationPlanSchema | typeof BriefDraftSchema, schemaName: string, idempotencyKey: string): Promise<T> { const prompt = rolePrompt(role, input); return (await this.ai.request<T>({ ...prompt, role, schema: schema as never, schemaName, idempotencyKey })).value; }
}
export class OpenAiPlannerProvider implements PlannerArchitectureProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async plan(input: Parameters<PlannerArchitectureProvider["plan"]>[0]): Promise<PlanningPackage> { const prompt = rolePrompt("planner", input); const result = await this.ai.request<z.infer<typeof PlanningPackageStructuredOutputSchema>>({ ...prompt, role: "planner", schema: PlanningPackageStructuredOutputSchema, schemaName: "planning-package", idempotencyKey: input.idempotencyKey }); return normalizePlanningPackage(result.value); }
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
