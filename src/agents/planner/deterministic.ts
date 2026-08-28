import { createHash } from "node:crypto";
import { AssetManifestSchema } from "@/domain/assets/schema";
import { TechnicalArchitectureSchema } from "@/domain/architecture/schema";
import { ContentPlanSchema } from "@/domain/content/schema";
import { type RequirementSpecification } from "@/domain/requirements/schema";
import { resolveLogoPolicy } from "@/domain/requirements/logo-policy";
import { SCHEMA_VERSION } from "@/domain/shared/schemas";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { getDependencyCatalogEntry, validateDependencyPlan, validateDependencyReferences } from "@/dependencies/authority";
import { AdministrationPlanSchema, AuthenticationPlanSchema, DataModelPlanSchema, DependencyPlanSchema, EmailPlanSchema, EnvironmentVariablePlanSchema, FormPlanSchema, NavigationPlanSchema, PageResponsibilityPlanSchema, PlanningPackageSchema, ProductScopePlanSchema, ProfileSelectionSchema, SecurityPlanSchema, SitemapPlanSchema, StoragePlanSchema, SupabasePlanSchema, TestStrategyPlanSchema, UserFlowPlanSchema, formFieldId, isLegacyFormField, type PlannerAgentInput, type PlanningPackage, type Traceability } from "./contracts";
import { effectivePlannerBrief } from "./brief-context";

const createdAt = new Date().toISOString();
const id = (key: string) => { const bytes = Buffer.from(createHash("sha256").update(key).digest("hex").slice(0, 32), "hex"); bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128; return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`; };
const base = (documentType: string, input: PlannerAgentInput) => ({ schemaVersion: SCHEMA_VERSION as 1, documentType, projectId: input.projectId, projectVersion: input.projectVersion, createdAt, updatedAt: createdAt });
const ref = (field: string) => `brief:${field}`;
const trace = (category: string, refs: string[], rationale: string, system: string[] = [], confirmation = false): Traceability => ({ decisionId: id(`${category}:${refs.join(",")}`), category, requirementReferences: refs, systemConstraintReferences: system, rationale, confidence: "high", userConfirmationRequired: confirmation });
const safePath = (slug: string) => slug === "home" || slug === "index" ? "/" : `/${slug.replace(/^\//, "").replace(/[^a-z0-9-]/g, "-")}`;
const briefFeatures = (brief: RequirementSpecification) => [...brief.features, ...brief.forms, ...brief.contentRequirements, ...brief.backendRequirements, ...brief.supabaseRequirements].join(" ").toLowerCase();
export const isClientOnlyFormBrief = (brief: {
  forms?: unknown[];
  formBehaviorRequirements?: RequirementSpecification["formBehaviorRequirements"];
  backendRequirements?: string[];
  supabaseRequirements?: string[];
  emailDecision?: RequirementSpecification["emailDecision"];
  storageDecision?: RequirementSpecification["storageDecision"];
  authenticationDecision?: RequirementSpecification["authenticationDecision"];
  administrationDecision?: RequirementSpecification["administrationDecision"];
  userRoles?: string[];
  protectedFunctionalityRequired?: boolean;
}) => {
  const form = brief.formBehaviorRequirements;
  return Boolean(
    (brief.forms?.length ?? 0) > 0
      && form?.formPresent
      && form.successUx === "SIMULATED"
      && form.dataTransmission === "NONE"
      && form.persistence === "NONE"
      && form.thirdParty === "NONE"
      && (brief.backendRequirements?.length ?? 0) === 0
      && (brief.supabaseRequirements?.length ?? 0) === 0
      && brief.emailDecision !== "needed"
      && brief.storageDecision !== "needed"
      && brief.authenticationDecision !== "authentication-required"
      && brief.administrationDecision !== "needed"
      && !brief.protectedFunctionalityRequired,
  );
};

export const isNoBackendBrief = (brief: {
  forms?: unknown[];
  features?: string[];
  formBehaviorRequirements?: RequirementSpecification["formBehaviorRequirements"];
  backendRequirements?: string[];
  supabaseRequirements?: string[];
  emailDecision?: RequirementSpecification["emailDecision"];
  storageDecision?: RequirementSpecification["storageDecision"];
  authenticationDecision?: RequirementSpecification["authenticationDecision"];
  administrationDecision?: RequirementSpecification["administrationDecision"];
  protectedFunctionalityRequired?: boolean;
}) => {
  const formText = [...(brief.features ?? []), ...(brief.forms ?? []).filter((value): value is string => typeof value === "string")];
  const formPresent = Boolean(brief.formBehaviorRequirements?.formPresent) || (brief.forms?.length ?? 0) > 0 || formText.some((value) => /\b(?:contact form|booking|reservation|request)\b/i.test(value));
  const inferredBackendSignal = (brief.features ?? []).some((feature) => /\b(?:realtime|live updates|database|persist(?:ence|ent)?|booking|reservation|dashboard|portal|account|upload(?:s|ing)?|saved data)\b/i.test(feature));
  return Boolean(
    (brief.backendRequirements?.length ?? 0) === 0
      && (brief.supabaseRequirements?.length ?? 0) === 0
      && brief.authenticationDecision === "no-authentication-guest-first"
      && brief.storageDecision === "not-needed"
      && brief.emailDecision === "not-needed"
      && brief.administrationDecision === "not-needed"
      && !brief.protectedFunctionalityRequired
      && !inferredBackendSignal
      && (!formPresent || isClientOnlyFormBrief(brief)),
  );
};

export function validatePlanningPackageAgainstBrief(brief: RequirementSpecification, planningPackage: PlanningPackage) {
  const issues: string[] = [];
  const forms = planningPackage.forms.forms;
  const clientOnlyForms = forms.filter((form) => form.submissionMechanism === "client-only");
  const expectedClientOnly = isClientOnlyFormBrief(brief);
  const expectedNoBackend = isNoBackendBrief(brief);

  if (expectedClientOnly && forms.some((form) => form.submissionMechanism !== "client-only"))
    issues.push("CLIENT_ONLY_FORM_MODE_MISMATCH");
  if (!expectedClientOnly && clientOnlyForms.length > 0)
    issues.push("CLIENT_ONLY_FORM_UNAPPROVED");
  if (clientOnlyForms.length > 0) {
    if (brief.backendRequirements.length > 0 || brief.supabaseRequirements.length > 0 || brief.emailDecision === "needed" || brief.storageDecision === "needed" || brief.authenticationDecision === "authentication-required" || brief.administrationDecision === "needed" || brief.protectedFunctionalityRequired)
      issues.push("CLIENT_ONLY_BACKEND_REQUIREMENT_CONFLICT");
    if (planningPackage.architecture.serverActions.length > 0 || planningPackage.architecture.routeHandlers.length > 0)
      issues.push("CLIENT_ONLY_SERVER_BOUNDARY_CONFLICT");
    if (planningPackage.dataModel.entities.length > 0 || planningPackage.supabase.postgres || planningPackage.supabase.auth || planningPackage.supabase.storage || planningPackage.supabase.realtime || planningPackage.supabase.edgeFunctions || planningPackage.email.decision !== "not-required")
      issues.push("CLIENT_ONLY_BACKEND_PLAN_CONFLICT");
  }
  if (expectedNoBackend) {
    if (planningPackage.architecture.backendPriority.length > 0) issues.push("NO_BACKEND_PRIORITY_CONFLICT");
    if (planningPackage.architecture.serverActions.length > 0 || planningPackage.architecture.routeHandlers.length > 0 || planningPackage.architecture.supabaseDatabaseRequirements.length > 0 || planningPackage.architecture.schemaPlan.length > 0 || planningPackage.architecture.rlsRequirements.length > 0 || planningPackage.architecture.environmentVariables.some((variable) => variable.required)) issues.push("NO_BACKEND_ARCHITECTURE_CONFLICT");
    if (planningPackage.dataModel.entities.length > 0 || planningPackage.supabase.postgres || planningPackage.supabase.auth || planningPackage.supabase.storage || planningPackage.supabase.realtime || planningPackage.supabase.edgeFunctions || planningPackage.supabase.environmentVariables.length > 0 || planningPackage.authentication.decision !== "none" || planningPackage.authentication.required || planningPackage.storage.decision !== "not-required" || planningPackage.email.decision !== "not-required" || planningPackage.administration.decision !== "no-admin") issues.push("NO_BACKEND_CAPABILITY_CONFLICT");
  }
  return [...new Set(issues)];
}

export type PlanningBlockerClass = "A" | "B" | "C" | "D" | "E" | "F";
export type PlanningDeferredStage = "DESIGN" | "PUBLICATION";
export type PlanningAcceptanceContext = {
  legalPlaceholderPolicy?: "USE_EXPLICIT_PLACEHOLDERS" | "NO_PLACEHOLDERS" | "UNRESOLVED";
};
export type PlanningAcceptanceItem = {
  id: string;
  type: "PACKAGE_BLOCKER" | "DETERMINISTIC_ADMISSION";
  sourcePath: string;
  sourceValidator: string;
  reason: string;
  classification: PlanningBlockerClass;
  deferredStage?: PlanningDeferredStage;
  publicationSafetyRequired?: boolean;
};
export type PlanningAcceptanceReadiness = {
  readyForAcceptance: boolean;
  blockingItems: PlanningAcceptanceItem[];
  deferredItems: PlanningAcceptanceItem[];
};

const legalMarker = /(?:legal|gesetz|impressum|datenschutz|privacy|anschrift|address|ladungs|steuer|tax|register|pflichtangab|platzhalter|placeholder)/i;
const publicationMarker = /(?:public|publication|publish|release|ver.?ffentlich)/i;
const legalFactMarker = /(?:address|anschrift|register|tax|steuer|pflichtangab|fact|detail|information|angab|placeholder|platzhalter|replace|ersetzen|bereit)/i;
const photoMarker = /(?:photo|photograph|photography|image|imagery|foto|bild|stock)/i;
const rightsMarker = /(?:right|license|licen[cs]|provenance|recht|lizenz|herkunft|urheber)/i;
const futurePhotoMarker = /(?:future|additional|later|selection|select|pending|unverified|zus[aä]tz|sp[aä]ter|noch|aussteh)/i;
const designMarker = /(?:design|visual|brand|direction|selection|typograph|layout|imagery)/i;

const hasLegalRoutes = (planningPackage: PlanningPackage) => {
  const routes = new Set(planningPackage.sitemap.routes.map((route) => route.path.toLowerCase()));
  return routes.has("/impressum") && routes.has("/datenschutz");
};

const hasOnlyDeferredPhotographySlots = (planningPackage: PlanningPackage) => {
  const entries = planningPackage.assets.entries.filter((entry) => !entry.isLogo);
  return entries.some((entry) => entry.sourceDecision === "custom" && entry.userApprovalRequired && ["planned", "pending-approval"].includes(entry.generationStatus))
    && entries.every((entry) => ["planned", "pending-approval"].includes(entry.generationStatus));
};

const hasKnownInvalidConcreteAsset = (planningPackage: PlanningPackage, blocker: string) =>
  planningPackage.assets.entries.some((entry) => entry.generationStatus === "rejected") && /asset|image|imagery|photo|photography|logo|reference/i.test(blocker);

const admissionSourcePath = (blocker: string) => ({
  DUPLICATE_ROUTE: "planning-package.sitemap.routes",
  DYNAMIC_ROUTE_CONFLICT: "planning-package.sitemap.routes",
  NAVIGATION_ROUTE_MISSING: "planning-package.navigation.routeReferences",
  AUTH_ARCHITECTURE_PENDING: "planning-package.authentication",
  LEGACY_FORM_FIELD_CONTRACT: "planning-package.forms.forms[].fields",
  FORM_FIELD_ID_INVALID: "planning-package.forms.forms[].fields",
  DEPENDENCY_NOT_ALLOWED: "planning-package.dependencies.dependencies",
  DEPENDENCY_VERSION_INVALID: "planning-package.dependencies.dependencies",
  ARCHITECTURE_DEPENDENCY_MISMATCH: "planning-package.architecture.dependencies",
  REQUIREMENT_TRACEABILITY_MISSING: "planning-package.traceability",
  PACKAGE_MANAGER_VIOLATION: "planning-package.architecture.packageManager",
  FIXED_STACK_VIOLATION: "planning-package.architecture",
  ASSET_MANIFEST_INVALID: "planning-package.assets.entries",
}[blocker] ?? "planning-package");

function classifyPackageBlocker(planningPackage: PlanningPackage, blocker: string, context: PlanningAcceptanceContext | undefined, index: number): PlanningAcceptanceItem {
  const sourcePath = `planning-package.blockers[${index}]`;
  if (hasKnownInvalidConcreteAsset(planningPackage, blocker)) return { id: "CONCRETE_ASSET_INVALID", type: "PACKAGE_BLOCKER", sourcePath, sourceValidator: "planning acceptance asset safety classification", reason: blocker, classification: "A" };
  const legalPublicationBlocker = legalMarker.test(blocker)
    && publicationMarker.test(blocker)
    && legalFactMarker.test(blocker)
    && hasLegalRoutes(planningPackage)
    && (context ? context.legalPlaceholderPolicy === "USE_EXPLICIT_PLACEHOLDERS" : /placeholder|platzhalter/i.test(blocker));
  if (legalPublicationBlocker) return { id: "FINAL_LEGAL_FACTS_REQUIRED", type: "PACKAGE_BLOCKER", sourcePath, sourceValidator: "planning acceptance lifecycle classification", reason: blocker, classification: "D", deferredStage: "PUBLICATION", publicationSafetyRequired: true };
  if (photoMarker.test(blocker) && rightsMarker.test(blocker) && futurePhotoMarker.test(blocker) && hasOnlyDeferredPhotographySlots(planningPackage)) return { id: "PHOTO_RIGHTS_PROVENANCE_REQUIRED", type: "PACKAGE_BLOCKER", sourcePath, sourceValidator: "planning acceptance lifecycle classification", reason: blocker, classification: "B", deferredStage: "DESIGN", publicationSafetyRequired: true };
  if (designMarker.test(blocker) && !publicationMarker.test(blocker)) return { id: "DESIGN_TIME_REQUIREMENT", type: "PACKAGE_BLOCKER", sourcePath, sourceValidator: "planning acceptance lifecycle classification", reason: blocker, classification: "B", deferredStage: "DESIGN" };
  return { id: `PACKAGE_BLOCKER_${index + 1}`, type: "PACKAGE_BLOCKER", sourcePath, sourceValidator: "planning acceptance package blocker validation", reason: blocker, classification: "A" };
}

export function selectApplicationProfile(brief: RequirementSpecification) {
  const text = briefFeatures(brief); const stateful = brief.protectedFunctionalityRequired || brief.authenticationDecision === "authentication-required" || brief.userRoles.length > 0 || brief.backendRequirements.length > 0 || brief.storageDecision === "needed" || /dashboard|portal|booking|reservation|account|persist|catalog|upload|saved|database/.test(text);
  const business = stateful || brief.emailDecision === "needed" || brief.administrationDecision === "needed" || brief.forms.length > 0 || brief.pages.some((page) => /contact|booking|catalog|services/.test(page.slug));
  const selectedProfile = stateful ? "web-application" : business ? "business-site" : "marketing-site";
  return ProfileSelectionSchema.parse({ selectedProfile, rationale: stateful ? "Approved requirements require stateful or protected workflows." : business ? "Approved requirements include structured business interaction without a full authenticated application." : "Approved requirements are primarily informational and public.", requirementReferences: [ref("features"), ref("pages")], rejectedProfiles: [selectedProfile === "web-application" ? { profile: "marketing-site", rationale: "Public informational profile cannot represent the approved stateful behavior." } : { profile: "web-application", rationale: "No approved protected or stateful behavior justifies a full application profile." }, { profile: selectedProfile === "marketing-site" ? "business-site" : "marketing-site", rationale: selectedProfile === "marketing-site" ? "No approved business interaction requires the larger profile." : "Approved business interaction exceeds a minimal marketing site." }] });
}

export function buildPlanningPackage(input: PlannerAgentInput): PlanningPackage {
  const brief = effectivePlannerBrief(input); const profile = selectApplicationProfile(brief); const text = briefFeatures(brief); const noBackend = isNoBackendBrief(brief); const routes = brief.pages.length ? brief.pages : [{ slug: "home", purpose: "Approved project entry page" }];
  const zodEntry = getDependencyCatalogEntry("zod");
  if (!zodEntry) throw new Error("The generated-project zod catalog entry is required.");
  const zodSpec = `zod@${zodEntry.allowedVersionSpec}`;
  const routeRecords = routes.map((page, index) => ({ id: `route-${page.slug}`, path: safePath(page.slug), titlePurpose: page.purpose, pageType: /dashboard|portal/.test(page.slug) ? "dashboard" as const : /\b(?:contact|booking|form)\b/.test(`${page.slug} ${page.purpose}`.toLowerCase()) ? "form" as const : index === 0 ? "landing" as const : "content" as const, visibility: brief.authenticationDecision === "authentication-required" && /dashboard|portal|account|private/.test(`${page.slug} ${page.purpose}`.toLowerCase()) ? "protected" as const : "public" as const, intendedUser: brief.targetAudiences[0] ?? "Project visitors", primaryGoal: page.purpose, primaryCta: index === 0 ? "Continue to the primary project action" : undefined, contentResponsibilities: [page.purpose], dataDependencies: [], formDependencies: /\b(?:contact|booking|form)\b/.test(`${page.slug} ${page.purpose}`.toLowerCase()) ? [`form-${page.slug}`] : [], authRequired: brief.authenticationDecision === "authentication-required" && /dashboard|portal|account|private/.test(`${page.slug} ${page.purpose}`.toLowerCase()), seoRelevant: true, parentId: index > 0 ? "route-home" : undefined, navigationVisible: true, requirementReferences: [ref("pages")] }));
  const formNeeded = brief.forms.length > 0 || /contact form|booking|reservation|request/.test(text);
  const clientOnlyForm = formNeeded && isClientOnlyFormBrief(brief);
  const sitemap = SitemapPlanSchema.parse({ ...base("sitemap", input), routes: routeRecords, traceability: [trace("sitemap", [ref("pages")], "Every route is derived from an approved page requirement.")] });
  const pagePlans = PageResponsibilityPlanSchema.parse({ ...base("page-responsibilities", input), pages: routeRecords.map((route) => ({ id: `page-${route.id}`, routeId: route.id, purpose: route.titlePurpose, targetAudience: route.intendedUser, userIntent: route.primaryGoal, contentBlocks: route.contentResponsibilities, functionalComponents: route.formDependencies.length ? ["Validated form"] : [], forms: route.formDependencies, dataReads: route.dataDependencies, dataWrites: route.formDependencies.length ? [clientOnlyForm ? "Local client state only" : "Validated submission"] : [], loadingStates: route.formDependencies.length ? ["Submission pending"] : [], emptyStates: ["No optional content available"], errorStates: ["Safe error state"], successStates: route.formDependencies.length ? ["Submission confirmation"] : [], seoMetadata: route.seoRelevant ? ["Title and description from approved page purpose", ...brief.seoRequirements] : brief.seoRequirements, assetRequirements: brief.imagesRequired ? ["Approved image source asset"] : [], acceptanceCriteria: brief.userAcceptanceCriteria, requirementReferences: [ref("pages"), ref("userAcceptanceCriteria")] })), traceability: [trace("page-responsibilities", [ref("pages"), ref("userAcceptanceCriteria")], "Page responsibilities follow approved page and acceptance requirements.")] });
  const navIds = routeRecords.filter((route) => route.navigationVisible).map((route) => route.id); const navigation = NavigationPlanSchema.parse({ ...base("navigation", input), primary: navIds.slice(0, 5), secondary: [], footer: navIds.filter((id) => /legal|privacy|terms/.test(id)), contextual: [], protected: routeRecords.filter((route) => route.authRequired).map((route) => route.id), mobileBehavior: "Collapse navigation into a menu while preserving the primary CTA and route reachability.", ctaPlacementIntent: routeRecords.filter((route) => route.primaryCta).map((route) => `${route.id}: ${route.primaryCta}`), routeReferences: navIds, traceability: [trace("navigation", [ref("pages")], "Navigation references only planned routes.")] });
  const formRoutes = routeRecords.filter((route) => route.formDependencies.length || /\b(?:contact|booking)\b/.test(route.path)); const plannedFormRoutes = formRoutes.length ? formRoutes : formNeeded ? [routeRecords[0] ?? { id: "route-home", path: "/", titlePurpose: "Approved project entry page", formDependencies: [] }] : []; const forms = FormPlanSchema.parse({ ...base("forms-plan", input), forms: plannedFormRoutes.map((route) => ({ id: `form-${route.path.slice(1) || "contact"}`, route: route.path, purpose: "Submit the approved business request", fields: [{ fieldId: "message", label: "Message", type: "textarea", required: true, validation: ["Non-empty", "Length limit"] }], businessValidation: brief.formBehaviorRequirements?.interactionStates?.map((state) => state.statement) ?? [], consentRequirements: brief.legalFacts.length ? ["Use approved consent wording"] : [], submissionMechanism: clientOnlyForm ? "client-only" : "server-action", databaseWrite: clientOnlyForm ? "No database write; local client state only." : brief.backendRequirements.length || brief.emailDecision === "needed" ? "Persist only the approved request fields with a retention decision." : "No persistent write approved.", emailBehavior: clientOnlyForm ? "No email and no external provider." : brief.emailDecision === "needed" ? "Notify the configured recipient after provider selection." : "No email behavior approved.", successState: clientOnlyForm ? "Show simulated local success, then reset." : "Show a confirmation without exposing provider details.", errorState: "Show a safe retry message.", rateLimitRequired: clientOnlyForm ? false : true, spamProtectionRequired: clientOnlyForm ? false : true, requirementReferences: [ref("forms"), ref("features")] })), traceability: [trace("forms", [ref("forms"), ref("features")], "Forms are included only when approved behavior requires them.")] });
  const entities = clientOnlyForm ? [] : /booking|reservation/.test(text) ? [{ name: "booking_requests", fields: [{ name: "status", type: "text", required: true, public: false }], relationships: [], ownership: "Requester and authorized business users", lifecycle: "Requested, reviewed, completed or rejected", retention: "Pending explicit retention policy", indexingRationale: ["Status and created time lookup"], uniquenessConstraints: [], rlsRequired: true, auditFields: ["created_at", "updated_at"], id: "entity-booking", requirementReferences: [ref("features")] }] : brief.backendRequirements.length || formNeeded ? [{ name: "approved_requests", fields: [{ name: "message", type: "text", required: true, public: false }], relationships: [], ownership: "Server-side application", lifecycle: "Created then retained or deleted per approved policy", retention: "Pending explicit retention policy", indexingRationale: ["Created time lookup"], uniquenessConstraints: [], rlsRequired: true, auditFields: ["created_at", "updated_at"], id: "entity-request", requirementReferences: [ref("backendRequirements"), ref("forms")] }] : [];
  const dataModel = DataModelPlanSchema.parse({ ...base("data-model-plan", input), entities, traceability: [trace("data-model", entities.length ? [ref("backendRequirements"), ref("forms")] : [ref("features")], entities.length ? "Entities map to approved stateful flows." : "No speculative persistent entity is added.")] });
  const authRequired = brief.authenticationDecision === "authentication-required" || brief.protectedFunctionalityRequired; const authentication = AuthenticationPlanSchema.parse({ ...base("authentication-plan", input), decision: brief.authenticationDecision === "pending" && authRequired ? "pending-blocker" : authRequired ? "supabase-auth" : "none", required: authRequired, userRoles: brief.userRoles, signInMethods: authRequired ? ["Email/password only if approved"] : [], registrationBehavior: authRequired ? "Pending approved registration behavior" : "Not applicable", protectedRoutes: routeRecords.filter((route) => route.authRequired).map((route) => route.path), sessionNeeds: authRequired ? ["Server-validated session"] : [], authorizationRules: authRequired ? ["Role and ownership checks before writes"] : [], rlsRelationship: authRequired ? "RLS mirrors authenticated ownership and role checks." : "No authenticated RLS scope is required.", accountLifecycle: authRequired ? "Pending approved lifecycle" : "Not applicable", passwordReset: "Only if authentication is approved", emailVerification: "Only if authentication and verification are approved", traceability: [trace("authentication", [ref("authenticationDecision"), ref("protectedFunctionalityRequired")], authRequired ? "Authentication follows the approved protected-functionality decision." : "Guest access is retained because no protected functionality is approved.")] });
  const storageNeeded = brief.storageDecision === "needed"; const storage = StoragePlanSchema.parse({ ...base("storage-plan", input), decision: brief.storageDecision === "pending" && storageNeeded ? "pending-blocker" : storageNeeded ? "supabase-storage" : "not-required", assetCategories: storageNeeded ? ["Runtime user uploads"] : [], uploadActors: storageNeeded ? ["Approved authenticated actors"] : [], acceptedFormats: storageNeeded ? ["Explicitly approved formats"] : [], sizeLimits: storageNeeded ? ["Explicit limit required before implementation"] : [], validation: storageNeeded ? ["MIME, extension, size, ownership"] : [], access: storageNeeded ? "private" : "not-applicable", buckets: storageNeeded ? ["approved-uploads"] : [], bucketId: storageNeeded ? "approved-uploads" : "not-applicable", policyIdentity: storageNeeded ? "runtime-owner-scoped-storage" : "not-applicable", ownerSource: "authenticated-user-id", objectPathStrategy: storageNeeded ? "user-id-prefix" : "not-applicable", objectPathTemplate: storageNeeded ? "{userId}/{objectName}" : "not-applicable", allowedOperations: storageNeeded ? ["SELECT", "INSERT", "UPDATE", "DELETE"] : [], directClientAccess: false, signedUrl: { enabled: storageNeeded, operations: storageNeeded ? ["SELECT", "INSERT"] : [], expirySeconds: 60 }, ownershipTransfer: "forbidden", serverPrivilegedAccess: false, retention: storageNeeded ? "Pending explicit retention policy" : "Not applicable", deletionBehavior: storageNeeded ? "Owner/admin deletion subject to policy" : "Not applicable", policies: storageNeeded ? ["Bucket-scoped authenticated Storage ownership policies"] : [], traceability: [trace("storage", [ref("storageDecision")], storageNeeded ? "Storage is included only for approved runtime uploads with a typed owner/path/operation contract." : "Static assets do not require runtime Storage.")] });
  const emailNeeded = brief.emailDecision === "needed"; const email = EmailPlanSchema.parse({ ...base("email-plan", input), decision: emailNeeded ? "required-provider-pending" : "not-required", emailTypes: emailNeeded ? ["Approved notification"] : [], triggers: emailNeeded ? ["Approved form or workflow event"] : [], recipients: emailNeeded ? ["Verified recipient from approved facts"] : [], senderIdentityNeeds: emailNeeded ? ["User-confirmed sender identity"] : [], templatesRequired: emailNeeded ? ["Confirmation and notification"] : [], retryExpectations: emailNeeded ? "Retry policy pending provider selection" : "Not applicable", failureBehavior: emailNeeded ? "Persist safe failure and expose retry state" : "Not applicable", privacy: emailNeeded ? ["Do not log message contents"] : [], environmentVariables: emailNeeded ? ["EMAIL_PROVIDER credentials, server-only"] : [], testingStrategy: emailNeeded ? ["Provider fake and failure-path tests"] : [], traceability: [trace("email", [ref("emailDecision")], emailNeeded ? "Email is included because the approved brief requires it." : "No email integration is added without an approved requirement.")] });
  const adminNeeded = brief.administrationDecision === "needed"; const administration = AdministrationPlanSchema.parse({ ...base("administration-plan", input), decision: adminNeeded ? "limited-management" : "no-admin", actors: adminNeeded ? brief.userRoles : [], managedEntities: adminNeeded ? entities.map((entity) => entity.name) : [], permittedActions: adminNeeded ? ["Only approved entity management actions"] : [], protectedRoutes: adminNeeded ? ["/admin"] : [], auditNeeds: adminNeeded ? ["Record actor and timestamp for mutations"] : [], authorizationRules: adminNeeded ? ["Role checks and RLS before mutations"] : [], traceability: [trace("administration", [ref("administrationDecision")], adminNeeded ? "Management is included because it is approved." : "No admin route is added without an approved management requirement.")] });
  const supabaseUsed = brief.supabaseRequirements.length > 0 || entities.length > 0 || authRequired || storageNeeded || /realtime|live updates/.test(text);
  const supabase = SupabasePlanSchema.parse({ ...base("supabase-plan", input), postgres: entities.length > 0, auth: authRequired, storage: storageNeeded, realtime: /realtime|live updates/.test(text), edgeFunctions: false, clientBoundaries: supabaseUsed ? ["Server-side Supabase client for privileged operations", "Browser client only for explicitly safe public behavior"] : [], rlsExpectations: entities.length ? ["Every persisted entity has RLS expectations"] : [], migrationNeeds: entities.length ? ["Logical schema only; customer migrations are out of scope"] : [], environmentVariables: supabaseUsed ? ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] : [], storageBuckets: storage.buckets, policies: [...storage.policies, ...authentication.authorizationRules], serviceRoleUse: supabaseUsed ? "Server-only and only when a narrowly justified operation requires it." : "No Supabase service role is required or permitted.", anonKeyUse: supabaseUsed ? "Public client configuration only; never a secret." : "No Supabase client configuration is required.", traceability: [trace("supabase", [ref("supabaseRequirements"), ref("backendRequirements")], "Supabase capabilities are limited to approved persistence, auth, and storage needs.")] });
  const content = ContentPlanSchema.parse({ ...base("content-plan", input), userProvidedFacts: [...brief.businessGoals, ...brief.contactFacts, ...brief.legalFacts, ...brief.brandFacts], approvedGeneratedCopy: [], missingFactualContent: [...(brief.contactFacts.length ? [] : formNeeded ? ["Verified contact facts"] : []), ...(brief.legalFacts.length ? [] : brief.legalFacts)], legalContentRequiringConfirmation: brief.legalFacts.length ? ["Legal wording requires user confirmation"] : [], approvedPlaceholders: brief.imageSourceDecision === "placeholders" ? ["Explicitly approved placeholder imagery"] : [], suppliedContentNotes: [] });
  const logoPolicy = resolveLogoPolicy(brief);
  const assets = AssetManifestSchema.parse({ ...base("asset-manifest", input), entries: brief.imagesRequired && brief.imageSourceDecision !== "pending" ? [{ id: id("asset:primary"), purpose: "Approved primary project imagery", targetPage: routeRecords[0]?.path ?? "/", sourceDecision: brief.imageSourceDecision, subject: "Project-relevant subject from approved brief", styleDirection: "Design Agent to determine later", aspectRatio: "16:9", targetDimensions: { width: 1600, height: 900 }, format: "webp", filename: "primary.webp", relativeOutputPath: "public/images/primary.webp", consistencyGroup: "primary-imagery", altText: "Descriptive alternative text to be confirmed", generationStatus: "planned", userApprovalRequired: true, isLogo: false }] : [] });
  if (logoPolicy.mode === "USER_SUPPLIED_LOGO") (assets.entries as Array<Record<string, unknown>>).push({ id: id("asset:logo"), purpose: "User-supplied logo", targetPage: "/", sourceDecision: "user-supplied", subject: "Supplied logo", styleDirection: "Use supplied asset without redesign", aspectRatio: "1:1", targetDimensions: { width: 512, height: 512 }, format: "svg", filename: "logo.svg", relativeOutputPath: "public/images/logo.svg", altText: "Project logo", generationStatus: "planned", userApprovalRequired: false, isLogo: true });
  const architecture = TechnicalArchitectureSchema.parse({ ...base("architecture", input), applicationProfile: profile.selectedProfile, packageManager: "npm", routes: routeRecords.map((route) => ({ path: route.path, responsibility: route.titlePurpose })), componentBoundaries: ["Server Components for data-free pages", "Client Components only for interactive forms"], componentDecisions: [{ area: "Interactive forms", serverOrClient: "client", rationale: "Client validation and submission feedback are required." }], serverActions: forms.forms.filter((form) => form.submissionMechanism !== "client-only").map((form) => `${form.id}: preferred server action`), routeHandlers: [], backendPriority: noBackend ? [] : ["server-actions", "route-handlers", "supabase-services"], supabaseDatabaseRequirements: brief.supabaseRequirements, schemaPlan: entities.map((entity) => entity.name), rlsRequirements: dataModel.entities.filter((entity) => entity.rlsRequired).map((entity) => `${entity.name}: ownership and role RLS`), authenticationPlan: authentication.decision, storagePlan: storage.decision, emailPlan: email.decision, environmentVariables: supabaseUsed ? [{ name: "NEXT_PUBLIC_SUPABASE_URL", required: entities.length > 0 || authRequired || storageNeeded, public: true }, { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: entities.length > 0 || authRequired || storageNeeded, public: true }] : [], dependencies: [{ name: zodSpec, purpose: "Runtime validation" }], npmScripts: { build: "next build", test: "vitest", lint: "eslint" }, testStrategy: ["Unit", "Integration", "Build validation"], securityControls: ["Zod validation", "Server-only secrets", "RLS for persisted data"], rejectedInfrastructure: ["NestJS", "Redis", "BullMQ", "Workers", "Microservices", "CMS", "Automatic admin panel"], acceptance: { accepted: false } });
  const environment = EnvironmentVariablePlanSchema.parse({ ...base("environment-variable-plan", input), variables: supabaseUsed ? [{ name: "NEXT_PUBLIC_SUPABASE_URL", purpose: "Supabase project URL", required: entities.length > 0 || authRequired || storageNeeded, serverOnly: false, secret: false, source: "Factory configuration", environments: ["development", "test", "production"], validationRule: "Valid URL", requirementReferences: [ref("supabaseRequirements")] }, { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", purpose: "Supabase public client key", required: entities.length > 0 || authRequired || storageNeeded, serverOnly: false, secret: false, source: "Factory configuration", environments: ["development", "test", "production"], validationRule: "Non-empty public key", requirementReferences: [ref("supabaseRequirements")] }] : [] });
  const dependencies = DependencyPlanSchema.parse({ ...base("dependency-plan", input), dependencies: [{ name: zodSpec, purpose: "Runtime validation", runtime: "runtime", required: true, requirementReferences: [ref("constraints")], builtInInsufficientReason: "Runtime schema validation is required at trust boundaries.", securityConsiderations: ["Keep schemas strict"] }] });
  const testStrategy = TestStrategyPlanSchema.parse({ ...base("test-strategy", input), categories: ["Unit", "Integration", "Build validation", ...(entities.length ? ["Database and RLS"] : []), ...(forms.forms.length ? ["Form submission"] : [])], acceptanceMapping: brief.userAcceptanceCriteria.map((criterion) => ({ acceptanceCriterion: criterion, testCategories: ["Integration"] })), excludedGates: ["Screenshot visual regression", "Standalone accessibility audit"] });
  const security = SecurityPlanSchema.parse({ ...base("security-plan", input), controls: [{ control: "Strict input validation", scope: "All boundaries", requirementReferences: [ref("constraints")] }, ...(entities.length ? [{ control: "RLS and server authorization", scope: "Persisted entities", requirementReferences: [ref("backendRequirements")] }] : [])], dataRetention: ["Retention must be confirmed before persistent personal data is implemented."], loggingRedaction: ["Do not log secrets or submitted personal content."], errorHandling: ["Return safe errors without provider or secret details."] });
  const blockers = [...(brief.authenticationDecision === "pending" && brief.protectedFunctionalityRequired ? ["AUTH_ARCHITECTURE_PENDING"] : []), ...(emailNeeded ? ["EMAIL_PROVIDER_PENDING"] : []), ...(storageNeeded && brief.storageDecision === "pending" ? ["STORAGE_DECISION_PENDING"] : []), ...(brief.imagesRequired && brief.imageSourceDecision === "pending" ? ["IMAGE_SOURCE_PENDING"] : []), ...(logoPolicy.mode === "USER_SUPPLIED_LOGO" && brief.suppliedLogoLocation.status !== "provided" ? ["LOGO_FILE_MISSING"] : []), ...(logoPolicy.mode === "TEXT_WORDMARK" && !logoPolicy.wordmarkText ? ["LOGO_WORDMARK_TEXT_MISSING"] : []), ...(brief.localization.locales.length === 0 ? ["LANGUAGE_CONFIGURATION_INCOMPLETE"] : []), ...(brief.userAcceptanceCriteria.length === 0 ? ["DATA_MODEL_INCOMPLETE"] : []), ...(profile.selectedProfile === "web-application" && entities.length === 0 ? ["DATA_MODEL_INCOMPLETE"] : [])];
  const inScopeCapabilities = [...new Set([...brief.features, ...brief.forms, ...brief.contentRequirements])];
  const productScope = ProductScopePlanSchema.parse({ ...base("product-scope", input), purpose: brief.projectSummary, primaryOutcomes: brief.businessGoals, secondaryOutcomes: [], inScopeCapabilities, outOfScopeCapabilities: ["Design directions", "Production source generation", "Unapproved features", ...brief.explicitExclusions], userRoles: brief.userRoles, majorEntities: entities.map((entity) => entity.name), majorWorkflows: forms.forms.map((form) => form.purpose), externalIntegrations: [], assumptions: [], constraints: brief.technicalConstraints, acceptanceMapping: brief.userAcceptanceCriteria.map((criterion) => ({ criterion, requirementReferences: [ref("userAcceptanceCriteria")] })), traceability: [trace("product-scope", ["brief:features", "brief:forms", "brief:contentRequirements", "brief:explicitExclusions"], "Product scope preserves every Planning-relevant capability and exclusion from the approved Brief view without feature invention.")] });
  const userFlows = UserFlowPlanSchema.parse({ ...base("user-flows", input), flows: forms.forms.map((form) => ({ id: `flow-${form.id}`, actor: brief.targetAudiences[0] ?? "Visitor", trigger: form.purpose, startRoute: form.route, steps: [{ order: 1, description: "Complete approved fields", routeId: routeRecords.find((route) => route.path === form.route)?.id }, { order: 2, description: form.submissionMechanism === "client-only" ? "Validate locally, show simulated success, and reset" : "Submit through the planned server boundary" }], dataCreated: entities.map((entity) => entity.name), dataRead: [], dataUpdated: [], successOutcome: form.successState, failureOutcomes: [form.errorState], authorizationRequirements: authentication.required ? ["Approved session and role"] : [], formRequirements: [form.id], emailRequirements: emailNeeded ? ["Approved notification"] : [], storageRequirements: storageNeeded ? ["Approved upload policy"] : [], acceptanceCriteria: brief.userAcceptanceCriteria, requirementReferences: [ref("features"), ref("forms")] })), traceability: [trace("user-flows", [ref("features"), ref("forms")], "Flows are created only for approved interactive behavior.")] });
  const traceability = [profile, sitemap, navigation, pagePlans, userFlows, forms, dataModel, authentication, supabase, email, storage, administration, productScope].flatMap((plan) => "traceability" in plan ? plan.traceability : []);
  traceability.push(
    trace("brand", ["brief:brandVisualRequirements"], "Canonical visual requirements remain traceable to Planning without inventing visual facts."),
    trace("seo", ["brief:seoRequirements"], "Canonical SEO requirements remain traceable to Planning without changing approved wording."),
  );
  const databaseRecommendation = { recommendation: entities.length || brief.supabaseRequirements.length ? "REQUIRED" as const : "NOT_REQUIRED" as const, rationale: entities.length || brief.supabaseRequirements.length ? "Approved requirements contain persistent data or explicit Supabase database requirements; the user must select and approve the database mode." : "No approved requirement currently requires database persistence; the user must still explicitly approve NONE.", requirementReferences: entities.length || brief.supabaseRequirements.length ? [ref("backendRequirements"), ref("supabaseRequirements")] : [ref("features")], userDecisionRequired: true as const };
  const packageValue = { ...base("planning-package", input), approvedBriefChecksum: input.approvedBriefChecksum, profile, productScope, sitemap, navigation, pages: pagePlans, userFlows, forms, dataModel, authentication, supabase, email, storage, administration, content, assets, architecture, environment, dependencies, testStrategy, security, traceability, blockers, accepted: false, acceptance: {}, databaseRecommendation };
  return PlanningPackageSchema.parse(packageValue);
}

/** Checksum for the exact persisted PlanningPackage document/envelope. */
export const planningDocumentChecksum = (planningPackage: PlanningPackage) => checksumPersistedDocument(planningPackage);

/** Checksum for PlanningPackage meaning, excluding the host-owned acceptance envelope. */
export const planningSemanticChecksum = (planningPackage: PlanningPackage) => checksumPersistedDocument({
  ...planningPackage,
  accepted: false,
  acceptance: {},
  updatedAt: planningPackage.createdAt,
  architecture: { ...planningPackage.architecture, acceptance: { accepted: false } },
});

export function validatePlanningStructure(planningPackage: PlanningPackage) {
  const blockers: string[] = []; const paths = planningPackage.sitemap.routes.map((route) => route.path); if (new Set(paths).size !== paths.length) blockers.push("DUPLICATE_ROUTE"); if (paths.some((path) => /\/:[^/]+\/[^/]+/.test(path))) blockers.push("DYNAMIC_ROUTE_CONFLICT"); const routeIds = new Set(planningPackage.sitemap.routes.map((route) => route.id)); if (planningPackage.navigation.routeReferences.some((routeId) => !routeIds.has(routeId))) blockers.push("NAVIGATION_ROUTE_MISSING"); if (planningPackage.sitemap.routes.some((route) => route.authRequired) && planningPackage.authentication.decision === "none") blockers.push("AUTH_ARCHITECTURE_PENDING"); for (const form of planningPackage.forms.forms) { const ids = form.fields.map(formFieldId); if (form.fields.some(isLegacyFormField)) blockers.push("LEGACY_FORM_FIELD_CONTRACT"); if (ids.some((id) => !id) || new Set(ids).size !== ids.length) blockers.push("FORM_FIELD_ID_INVALID"); } return blockers;
}

export function validatePlanningAssets(planningPackage: PlanningPackage) {
  return planningPackage.assets.entries.some((entry) => entry.generationStatus === "rejected") ? ["ASSET_MANIFEST_INVALID"] : [];
}

export function validatePlanningDependencies(planningPackage: PlanningPackage) {
  const dependencyPlan = validateDependencyPlan(planningPackage.dependencies.dependencies);
  const architectureDependencies = validateDependencyReferences(
    planningPackage.architecture.dependencies.map((dependency) => dependency.name),
    planningPackage.dependencies.dependencies,
  );
  return [...dependencyPlan.decisions, ...architectureDependencies.decisions];
}

export function validatePlanningAdmission(planningPackage: PlanningPackage) {
  const blockers = [
    ...validatePlanningStructure(planningPackage),
    ...validatePlanningAssets(planningPackage),
    ...validatePlanningDependencies(planningPackage)
      .filter((item) => !item.approved)
      .map((item) => `${item.code}:${item.packageName}`),
  ];
  if (
    planningPackage.traceability.some(
      (entry) => entry.requirementReferences.length === 0,
    )
  )
    blockers.push("REQUIREMENT_TRACEABILITY_MISSING");
  if (planningPackage.architecture.packageManager !== "npm")
    blockers.push("PACKAGE_MANAGER_VIOLATION");
  if (
    planningPackage.architecture.dependencies.some((dependency) =>
      /nest|redis|bullmq|pnpm|yarn/i.test(dependency.name),
    )
  )
    blockers.push("FIXED_STACK_VIOLATION");
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)] };
}

/** The single host-owned Planning Acceptance authority. */
export function evaluatePlanningAcceptanceReadiness(input: { planningPackage: PlanningPackage; context?: PlanningAcceptanceContext }): PlanningAcceptanceReadiness {
  const packageValue = input.planningPackage;
  const admission = validatePlanningAdmission(packageValue);
  const blockingItems: PlanningAcceptanceItem[] = [];
  const deferredItems: PlanningAcceptanceItem[] = [];
  packageValue.blockers.forEach((blocker, index) => {
    const item = classifyPackageBlocker(packageValue, blocker, input.context, index);
    if (item.classification === "B" || item.classification === "C" || item.classification === "D" || item.classification === "F") deferredItems.push(item);
    else blockingItems.push(item);
  });
  for (const blocker of admission.blockers) {
    if (packageValue.blockers.includes(blocker)) continue;
    blockingItems.push({ id: blocker, type: "DETERMINISTIC_ADMISSION", sourcePath: admissionSourcePath(blocker), sourceValidator: "validatePlanningAdmission", reason: blocker, classification: "A" });
  }
  return { readyForAcceptance: blockingItems.length === 0, blockingItems, deferredItems };
}
