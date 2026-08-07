import type { LeadAnalysisProvider } from "../lead/ports";
import { BriefDraftSchema, ClarificationPlanSchema, LeadAgentAnalysisSchema, type BriefDraft, type ClarificationPlan, type LeadAgentAnalysis } from "../lead/contracts";
import type { PlannerArchitectureProvider } from "../planner/ports";
import { PlanningPackageSchema, type PlanningPackage } from "../planner/contracts";
import type { DesignDirectionProvider } from "../design-agent/ports";
import { DesignDirectionSchema, DesignDirectionSetSchema, type DesignDirectionSet } from "../domain/design/schema";
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
const StrictDesignDirectionSchema = DesignDirectionSchema.required();
const StrictDesignProviderSchema = z.object({ name: NonEmptyStringSchema, used: z.boolean(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict();
export const DesignDirectionStructuredOutputSchema = z.object({ ...DesignDirectionSetSchema.shape, directions: z.array(StrictDesignDirectionSchema).length(3), approvedBriefChecksum: z.string().nullable(), acceptedPlanningChecksum: z.string().nullable(), blockingReasons: z.array(NonEmptyStringSchema), warnings: z.array(NonEmptyStringSchema), directionSetChecksum: z.string().nullable(), provider: StrictDesignProviderSchema, supersedesSetId: z.string().nullable(), supersededAt: z.string().nullable() }).strict().required();
function normalizeBriefDraft(value: z.infer<typeof BriefDraftStructuredOutputSchema>): BriefDraft {
  const { requirements } = value;
  const { approval, projectTitle, analysisMetadata, briefApprovalNote, ...canonicalFields } = requirements;
  const normalizedRequirements = { ...canonicalFields, approval: { approved: approval.approved, ...(approval.approvedAt === null ? {} : { approvedAt: approval.approvedAt }), ...(approval.approvedBy === null ? {} : { approvedBy: approval.approvedBy }), ...(approval.approvedRequirementsChecksum === null ? {} : { approvedRequirementsChecksum: approval.approvedRequirementsChecksum }) }, ...(projectTitle === null ? {} : { projectTitle }), ...(analysisMetadata === null ? {} : { analysisMetadata }), ...(briefApprovalNote === null ? {} : { briefApprovalNote }) };
  normalizedRequirements.brandFacts = normalizedRequirements.brandFacts.filter((fact) => !/^(project name:|business name:|no supplied|no (palette|typography|logo|layout)|no prescribed (palette|typography|logo|layout)|no (logo|brand|palette|typography|layout) (was )?(provided|supplied)|(?:logo|brand|palette|typography|layout) (was )?not (provided|supplied)|(?:use|propose) a neutral .* design direction|.*is the project name)/i.test(fact.trim()));
  const workflowApprovalBlocker = (text: string) => /(?:project )?brief approval (?:is required|is still pending)|brief.*(?:approval|user approval).*before planner|approve.*brief.*before planner|planner.*before.*brief approval|explicit approval.*brief.*(?:not|pending|recorded)/i.test(text);
  const unresolvedItems = value.unresolvedItems.filter((item) => !(item.key === "briefApproval" || item.key === "approval.project-brief" || item.key === "approval.projectBrief" || item.key === "approval.required" || item.key === "workflow.briefApproval" || item.key === "workflow.brief_approval" || item.key === "workflow.brief-approval" || (/brief/i.test(item.key) && /approval|approve/i.test(item.key)) || workflowApprovalBlocker(item.description)));
  const blockingReasons = value.blockingReasons.filter((reason) => !workflowApprovalBlocker(reason));
  return BriefDraftSchema.parse({ ...value, requirements: normalizedRequirements, unresolvedItems, blockingReasons, readyForApproval: blockingReasons.length === 0 && unresolvedItems.every((item) => !item.blocking) });
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
function normalizePlanningPackage(value: z.infer<typeof PlanningPackageStructuredOutputSchema>, approvedBriefChecksum: string): PlanningPackage {
  const routeIdsByPath = new Map(value.sitemap.routes.flatMap((route) => [[route.path, route.id], [route.id, route.id], [`sitemap.${route.id.replace(/^route-/, "")}`, route.id], [route.id.replace(/^route-/, ""), route.id]]));
  const normalizeRouteReferences = (references: string[]) => references.map((reference) => routeIdsByPath.get(reference) ?? reference);
  const normalized = { ...value, blockers: value.blockers.filter((blocker) => !/design[- ]direction selection.*(pending|existing design stage|not select|defer)/i.test(blocker)), productScope: { ...value.productScope, traceability: value.productScope.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, sitemap: { ...value.sitemap, routes: value.sitemap.routes.map((route) => omitNull(route, ["primaryCta", "parentId"])), traceability: value.sitemap.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, navigation: { ...value.navigation, primary: normalizeRouteReferences(value.navigation.primary), secondary: normalizeRouteReferences(value.navigation.secondary), footer: normalizeRouteReferences(value.navigation.footer), contextual: normalizeRouteReferences(value.navigation.contextual), protected: normalizeRouteReferences(value.navigation.protected), routeReferences: normalizeRouteReferences(value.navigation.routeReferences), traceability: value.navigation.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, pages: { ...value.pages, traceability: value.pages.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, userFlows: { ...value.userFlows, flows: value.userFlows.flows.map((flow) => ({ ...flow, steps: flow.steps.map((step) => omitNull(step, ["routeId", "decision"])) })), traceability: value.userFlows.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, forms: { ...value.forms, traceability: value.forms.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, dataModel: { ...value.dataModel, traceability: value.dataModel.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, authentication: { ...value.authentication, traceability: value.authentication.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, supabase: { ...value.supabase, traceability: value.supabase.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, email: { ...value.email, traceability: value.email.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, storage: { ...value.storage, traceability: value.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, administration: { ...value.administration, traceability: value.administration.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) }, architecture: { ...value.architecture, acceptance: omitNull(value.architecture.acceptance, ["acceptedAt", "acceptedBy"]) }, acceptance: omitNull(value.acceptance, ["acceptedAt", "acceptedBy", "checksum"]), assets: { ...value.assets, entries: value.assets.entries.map((entry) => omitNull(entry, ["consistencyGroup"])) }, traceability: value.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"])) };
  (normalized as unknown as { blockers: string[] }).blockers = value.blockers.filter((blocker) => !(/design[- ]direction selection.*(pending|existing design stage|not select|defer)/i.test(blocker) || /design direction is not selected.*(exactly three|design stage)/i.test(blocker) || /design direction has not been selected.*(design stage|planner|implementation)/i.test(blocker) || /design direction .*must be selected after planner/i.test(blocker) || /user must select one of exactly three.*before implementation.*non-blocking for planning/i.test(blocker) || /after design selection/i.test(blocker)));
  delete (normalized as unknown as { approvedBriefChecksum?: unknown }).approvedBriefChecksum;
  delete (normalized as unknown as { acceptedPlanningChecksum?: unknown }).acceptedPlanningChecksum;
  delete (normalized as unknown as { directionSetChecksum?: unknown }).directionSetChecksum;
  delete (normalized as unknown as { supersedesSetId?: unknown }).supersedesSetId;
  delete (normalized as unknown as { supersededAt?: unknown }).supersededAt;
  (normalized as unknown as { approvedBriefChecksum: string }).approvedBriefChecksum = approvedBriefChecksum;
  (normalized as unknown as { architecture: { backendPriority: ["server-actions", "route-handlers", "supabase-services"] } }).architecture.backendPriority = ["server-actions", "route-handlers", "supabase-services"];
  (normalized as unknown as { storage: { traceability: unknown[] } }).storage.traceability = value.storage.traceability.map((entry) => omitNull(entry, ["unresolvedDependency"]));
  (normalized as unknown as { architecture: { npmScripts: Record<string, string> } }).architecture.npmScripts = Object.fromEntries(value.architecture.npmScripts.map((script) => [script.name, script.command]));
  return PlanningPackageSchema.parse(normalized);
}
const DESIGN_OPTIONAL_KEYS = ["shortName", "businessRationale", "audienceFit", "visualPersonality", "gridStrategy", "navigationCharacter", "cardPolicy", "formCharacter", "ctaCharacter", "logoUsageRules", "iconographyDirection", "decorativeLanguage", "mobileCharacter", "contentDensity", "whitespaceStrategy", "imageSourceDecision", "implementationComplexity", "suitabilitySummary", "prohibitedInterpretations", "approvedRequirementReferences", "planningReferences", "colorRoles", "imageArtDirectionDetails", "motionDetails", "responsiveDetails", "genericTemplateRisk"];
function normalizeDesignDirectionSet(value: z.infer<typeof DesignDirectionStructuredOutputSchema>): DesignDirectionSet {
  const normalized = { ...value, directions: value.directions.map((direction) => omitNull(direction, DESIGN_OPTIONAL_KEYS)), ...(value.approvedBriefChecksum === null ? {} : { approvedBriefChecksum: value.approvedBriefChecksum }), ...(value.acceptedPlanningChecksum === null ? {} : { acceptedPlanningChecksum: value.acceptedPlanningChecksum }), ...(value.directionSetChecksum === null ? {} : { directionSetChecksum: value.directionSetChecksum }), ...(value.supersedesSetId === null ? {} : { supersedesSetId: value.supersedesSetId }), ...(value.supersededAt === null ? {} : { supersededAt: value.supersededAt }) };
  delete (normalized as unknown as { approvedBriefChecksum?: unknown }).approvedBriefChecksum;
  delete (normalized as unknown as { acceptedPlanningChecksum?: unknown }).acceptedPlanningChecksum;
  delete (normalized as unknown as { directionSetChecksum?: unknown }).directionSetChecksum;
  delete (normalized as unknown as { supersedesSetId?: unknown }).supersedesSetId;
  delete (normalized as unknown as { supersededAt?: unknown }).supersededAt;
  return DesignDirectionSetSchema.parse(normalized);
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
  async plan(input: Parameters<PlannerArchitectureProvider["plan"]>[0]): Promise<PlanningPackage> { const prompt = rolePrompt("planner", input); const result = await this.ai.request<z.infer<typeof PlanningPackageStructuredOutputSchema>>({ ...prompt, role: "planner", schema: PlanningPackageStructuredOutputSchema, schemaName: "planning-package", idempotencyKey: input.idempotencyKey }); return normalizePlanningPackage(result.value, input.approvedBriefChecksum); }
}
export class OpenAiDesignProvider implements DesignDirectionProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}
  async proposeDesignDirections(input: Parameters<DesignDirectionProvider["proposeDesignDirections"]>[0]): Promise<DesignDirectionSet> { const prompt = rolePrompt("design", input); const result = await this.ai.request<z.infer<typeof DesignDirectionStructuredOutputSchema>>({ ...prompt, role: "design", schema: DesignDirectionStructuredOutputSchema, schemaName: "design-direction-set", idempotencyKey: input.idempotencyKey }); return normalizeDesignDirectionSet(result.value); }
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
