import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { AgentContextCategorySchema } from "@/domain/agents/schema";
import { ToolIdSchema } from "@/domain/tooling/schema";
import { EMIL_ANIMATE_SKILL_ID, EMIL_DESIGN_ENGINEERING_SKILL_ID } from "@/domain/design/emil-identifiers";

export const ImplementationDomainSchema = z.enum(["FRONTEND", "BACKEND", "DATABASE"]);
export type ImplementationDomain = z.infer<typeof ImplementationDomainSchema>;

export const ImplementationSpecialistIdSchema = z.enum([
  "frontend-implementation",
  "backend-implementation",
  "database-implementation",
]);
export type ImplementationSpecialistId = z.infer<typeof ImplementationSpecialistIdSchema>;

export const ProfileSurfaceSchema = z.enum([
  "SOURCE_READ",
  "FRONTEND_SOURCE_WRITE",
  "BACKEND_SOURCE_WRITE",
  "DATABASE_SCHEMA_WRITE",
  "CONTROLLED_TEXT_PATCH",
  "CONTROLLED_AST_PATCH",
  "ASSET_READ",
  "RELEVANT_TESTS",
]);
export type ProfileSurface = z.infer<typeof ProfileSurfaceSchema>;

export const ImplementationCapabilitySchema = z.enum([
  "REACT_UI",
  "NEXT_APP_ROUTER",
  "TYPESCRIPT",
  "TAILWIND",
  "SHADCN_UI",
  "ACCESSIBILITY_IMPLEMENTATION",
  "RESPONSIVE_IMPLEMENTATION",
  "SERVER_CLIENT_BOUNDARIES",
  "FORM_IMPLEMENTATION",
  "STATE_BOUNDARIES",
  "PERFORMANCE_IMPLEMENTATION",
  "FRONTEND_TESTING",
  "CANONICAL_CONTRACT_CONSUMPTION",
  "DEPENDENCY_DISCIPLINE",
  "ERROR_LOADING_EMPTY_STATES",
  "DESIGN_CONTRACT_IMPLEMENTATION",
  "VISUAL_CRAFT_IMPLEMENTATION",
  "MOTION_DESIGN_IMPLEMENTATION",
  "EMIL_DESIGN_ENGINEERING",
  "EMIL_ANIMATION_CONSTRUCTION",
  "IMPECCABLE_DESIGN_INTEGRATION",
  "DIALKIT_AUTHORING",
  "ANTI_AI_SLOP_DESIGN_GUARD",
  "DESIGN_SYSTEM_CHECKLIST",
  "DAISYUI_INTEGRATION",
  "MAGIC_UI_INTEGRATION",
  "SEO_IMPLEMENTATION",
  "NEXT_SERVER_RUNTIME",
  "ZOD_VALIDATION",
  "SERVER_ARCHITECTURE",
  "AUTHENTICATION",
  "AUTHORIZATION",
  "SERVER_TRUST_BOUNDARY",
  "TYPED_BACKEND_CONTRACTS",
  "TRANSACTION_CONCURRENCY",
  "ERROR_MODELING",
  "SERVER_ONLY_BOUNDARIES",
  "CACHE_REVALIDATION",
  "BACKEND_TESTING",
  "CONDITIONAL_SUPABASE",
  "CONDITIONAL_POSTGRES_APPLICATION",
  "DATABASE_OWNERSHIP_HANDOFF",
]);
export type ImplementationCapability = z.infer<typeof ImplementationCapabilitySchema>;

export const SkillActivationSchema = z.enum([
  "ALWAYS",
  "FORM_TASK",
  "MOTION_TASK",
  "DAISYUI_TASK",
  "MAGIC_UI_TASK",
  "SUPABASE_OR_DATABASE_TASK",
]);
export type SkillActivation = z.infer<typeof SkillActivationSchema>;

export const ImplementationSkillBindingSchema = z.object({
  skillId: z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
  agentId: z.literal("implementation"),
  capability: ImplementationCapabilitySchema,
  tools: z.array(ToolIdSchema),
  permissions: z.array(ProfileSurfaceSchema).min(1),
  activation: SkillActivationSchema,
  inputContract: z.literal("implementation.input"),
  outputContract: z.literal("implementation.output"),
  coverageKeys: z.array(z.string().min(1)).min(1),
}).strict();
export type ImplementationSkillBinding = z.infer<typeof ImplementationSkillBindingSchema>;

const ImportedProfileSourceSchema = z.object({
  sourceRepository: z.literal("defuj/opencode-agent-kit"),
  sourceProfilePath: z.string().regex(/^\.opencode\/prompts\/agents\/[a-z-]+\.md$/),
  sourceProfileUrl: z.string().url(),
  repositoryUrl: z.literal("https://github.com/defuj/opencode-agent-kit"),
  sourceContentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  license: z.literal("MIT"),
  licenseUrl: z.literal("https://github.com/defuj/opencode-agent-kit/blob/main/LICENSE"),
}).strict();

export const AgentProfileSchema = z.object({
  profileId: ImplementationSpecialistIdSchema,
  agentId: z.literal("implementation"),
  role: z.literal("implementation"),
  displayName: z.string().min(1),
  domain: ImplementationDomainSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.literal("APPROVED"),
  source: ImportedProfileSourceSchema,
  normalizedGuidance: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  rejectedForeignAssumptions: z.array(z.string().min(1).max(300)).min(1).max(20),
  capabilitySurface: z.array(ProfileSurfaceSchema).min(1),
  implementationCapabilities: z.array(ImplementationCapabilitySchema).min(1),
  allowedTools: z.array(ToolIdSchema),
  allowedSkillIds: z.array(z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)),
  skillBindings: z.array(ImplementationSkillBindingSchema),
  allowedTaskTypes: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).min(1),
  contextPolicy: z.object({
    version: z.string().min(1),
    allowedCategories: z.array(AgentContextCategorySchema).min(1),
    maxBytes: z.number().int().positive(),
    maxItems: z.number().int().positive(),
  }).strict(),
  approval: z.object({
    status: z.literal("APPROVED"),
    reviewer: z.literal("factory-import-policy"),
    approvedAt: z.string().datetime(),
  }).strict(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((profile, context) => {
  if (profile.allowedTools.some((tool) => tool.includes("*"))) {
    context.addIssue({ code: "custom", path: ["allowedTools"], message: "Imported profiles cannot grant wildcard or Git authority." });
  }
  if (profile.allowedSkillIds.some((skill) => skill.includes("*"))) {
    context.addIssue({ code: "custom", path: ["allowedSkillIds"], message: "Imported profiles cannot grant wildcard skills." });
  }
  if (profile.profileId !== `${profile.domain.toLowerCase()}-implementation`) {
    context.addIssue({ code: "custom", path: ["profileId"], message: "Profile identity must match its implementation domain." });
  }
  if (new Set(profile.implementationCapabilities).size !== profile.implementationCapabilities.length) {
    context.addIssue({ code: "custom", path: ["implementationCapabilities"], message: "Implementation capabilities must be unique." });
  }
  if (new Set(profile.allowedSkillIds).size !== profile.allowedSkillIds.length) {
    context.addIssue({ code: "custom", path: ["allowedSkillIds"], message: "Allowed skills must be unique." });
  }
  const allowedSkillIds = new Set(profile.allowedSkillIds);
  const allowedTools = new Set(profile.allowedTools);
  const allowedPermissions = new Set(profile.capabilitySurface);
  const bindingKeys = new Set<string>();
  for (const binding of profile.skillBindings) {
    const key = `${binding.skillId}:${binding.capability}`;
    if (bindingKeys.has(key)) context.addIssue({ code: "custom", path: ["skillBindings"], message: "Skill bindings must be unique by skill and capability." });
    bindingKeys.add(key);
    if (!allowedSkillIds.has(binding.skillId)) context.addIssue({ code: "custom", path: ["skillBindings"], message: "A skill binding must reference an explicitly allowed skill." });
    if (!profile.implementationCapabilities.includes(binding.capability)) context.addIssue({ code: "custom", path: ["skillBindings"], message: "A skill binding capability must be declared by the profile." });
    if (binding.tools.some((tool) => !allowedTools.has(tool))) context.addIssue({ code: "custom", path: ["skillBindings"], message: "A skill binding cannot grant a tool outside the profile allowlist." });
    if (binding.permissions.some((permission) => !allowedPermissions.has(permission))) context.addIssue({ code: "custom", path: ["skillBindings"], message: "A skill binding cannot grant a permission outside the profile surface." });
  }
  const withoutChecksum = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "checksum"));
  if (profile.checksum !== checksumPersistedDocument(withoutChecksum)) {
    context.addIssue({ code: "custom", path: ["checksum"], message: "Approved profile checksum is stale." });
  }
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

const APPROVED_AT = "2026-09-03T00:00:00.000Z";

const createApprovedProfile = (value: Omit<AgentProfile, "checksum">): AgentProfile => {
  const checksum = checksumPersistedDocument(value);
  const profile = AgentProfileSchema.parse({ ...value, checksum });
  const freeze = (current: unknown): void => {
    if (!current || typeof current !== "object" || Object.isFrozen(current)) return;
    Object.values(current as Record<string, unknown>).forEach(freeze);
    Object.freeze(current);
  };
  freeze(profile);
  return profile;
};

const frontendProfile = createApprovedProfile({
  profileId: "frontend-implementation",
  agentId: "implementation",
  role: "implementation",
  displayName: "FrontendImplementationAgent",
  domain: "FRONTEND",
  version: "1.2.0",
  status: "APPROVED",
  source: {
    sourceRepository: "defuj/opencode-agent-kit",
    sourceProfilePath: ".opencode/prompts/agents/react-frontend-developer.md",
    sourceProfileUrl: "https://raw.githubusercontent.com/defuj/opencode-agent-kit/main/.opencode/prompts/agents/react-frontend-developer.md",
    repositoryUrl: "https://github.com/defuj/opencode-agent-kit",
    sourceContentChecksum: "eb0bfbc04907684718bbaef429c62e7ebf6dcdd13f501388da674959c32977a0",
    license: "MIT",
    licenseUrl: "https://github.com/defuj/opencode-agent-kit/blob/main/LICENSE",
  },
  normalizedGuidance: [
    "Implement approved Next.js App Router and React UI responsibilities with clear component boundaries, accessible HTML, and responsive behavior.",
    "Keep Server Components and client interaction aligned with the approved Architecture; frontend ownership does not grant backend, database, auth, email, analytics, or deployment authority.",
    "Use the selected Design contract, canonical content, approved assets, and typed form plan as host-owned inputs; preserve facts and do not invent requirements.",
    "Implement semantic names, labels, keyboard and focus behavior, heading order, alt text, disabled semantics, dialog behavior, and accessible form errors without treating ARIA as a substitute for native HTML.",
    "Implement only approved SEO metadata, canonical, robots, sitemap, structured-data, and indexability behavior through the existing implement-seo task; do not invent claims, locations, ratings, or other factual search content.",
    "Treat the Design contract as the responsive authority: preserve hierarchy across mobile, tablet, and desktop, prevent overflow, and adapt navigation, grids, media, and touch interactions deliberately.",
    "Separate server data, URL state, form state, local UI state, and shared application state; do not introduce a global state library or a dependency when the approved stack already provides the capability.",
    "Consume canonical shared contracts and approved route, content, asset, and error/loading/empty-state inputs before creating a new type; keep focused tests beside the owned behavior.",
    "Prefer small, maintainable, performance-aware changes: minimize client JavaScript and hydration, avoid unnecessary effects and waterfalls, and keep image, font, loading, error, empty, retry, and recovery behavior reachable.",
    "Do not hide failures with mock data, fake success, swallowed exceptions, or client-only completion for a required server operation; implementation verification does not replace independent Browser, Security, Accessibility, Performance, Code, Dependency, or Release review.",
    "Make every visual decision intentional: preserve the approved composition, hierarchy, typography, whitespace, rhythm, proportion, density, contrast, alignment, imagery, brand character, and responsive asymmetry instead of defaulting to template patterns or cardifying every region.",
    "Implement purposeful motion as a small coherent vocabulary for state, hierarchy, continuity, causality, feedback, and orientation; use the approved motion tokens, support interruption, and keep navigation and comprehension correct without animation.",
    "Use the host-controlled Impeccable integration as design vocabulary, anti-pattern detection, and polish guidance; approved Design and canonical content remain higher authority and Impeccable cannot introduce a competing visual direction.",
    "Use DialKit only as an authoring-time parameter exploration boundary for spacing, scale, opacity, blur, timing, springs, and sequencing; extract approved values into canonical tokens and never ship its controls, overlays, imports, or runtime dependency.",
    "Before frontend handoff, complete the bounded DesignSystemChecklist: inspect all thirty Factory anti-AI-slop heuristics, normalize Impeccable findings, preserve contextual Design justifications, and block unsupplied content, missing states, motion accessibility defects, and authoring-tool leaks.",
    "Use daisyUI only when the accepted DependencyPlan and Phase 7C approval select the exact host-pinned devDependency; preserve Tailwind v4, semantic Design tokens, and shadcn/ui as higher authorities.",
    "Adapt only explicitly selected free Magic UI candidates from the read-only Design-source evidence; preserve provenance, validate dependencies, minimize client islands, and normalize motion and accessibility.",
    "Do not invent testimonials, customer identities, metrics, awards, partner logos, prices, legal claims, or legal copy; surface missing privacy, terms, consent, or product-demo requirements for the correct authority to resolve.",
  ],
  rejectedForeignAssumptions: [
    "OpenCode or Claude-specific orchestration, subagent invocation, session, question, and MCP authority.",
    "Foreign slash commands, model selection, filesystem or shell authority, Git push/commit authority, and package installation.",
    "Foreign framework defaults such as Vite, Zustand, Prisma, or Express when they are not present in the approved Factory Architecture.",
  ],
  capabilitySurface: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "ASSET_READ", "RELEVANT_TESTS"],
  implementationCapabilities: ["REACT_UI", "NEXT_APP_ROUTER", "TYPESCRIPT", "TAILWIND", "SHADCN_UI", "ACCESSIBILITY_IMPLEMENTATION", "RESPONSIVE_IMPLEMENTATION", "SERVER_CLIENT_BOUNDARIES", "FORM_IMPLEMENTATION", "STATE_BOUNDARIES", "PERFORMANCE_IMPLEMENTATION", "FRONTEND_TESTING", "CANONICAL_CONTRACT_CONSUMPTION", "DEPENDENCY_DISCIPLINE", "ERROR_LOADING_EMPTY_STATES", "DESIGN_CONTRACT_IMPLEMENTATION", "VISUAL_CRAFT_IMPLEMENTATION", "MOTION_DESIGN_IMPLEMENTATION", "EMIL_DESIGN_ENGINEERING", "EMIL_ANIMATION_CONSTRUCTION", "IMPECCABLE_DESIGN_INTEGRATION", "DIALKIT_AUTHORING", "ANTI_AI_SLOP_DESIGN_GUARD", "DESIGN_SYSTEM_CHECKLIST", "DAISYUI_INTEGRATION", "MAGIC_UI_INTEGRATION", "SEO_IMPLEMENTATION"],
  allowedTools: ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "controlled-edit"],
  allowedSkillIds: ["nextjs-server-client-implementation", "typed-form-implementation", "maintainable-performance-implementation", EMIL_DESIGN_ENGINEERING_SKILL_ID, EMIL_ANIMATE_SKILL_ID, "design-motion-principles", "magic-ui-adaptation", "daisyui-tailwind-v4"],
  skillBindings: [
    { skillId: "nextjs-server-client-implementation", agentId: "implementation", capability: "SERVER_CLIENT_BOUNDARIES", tools: ["context7-read", "codebase-memory-read", "controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "ALWAYS", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["nextjs-implementation", "server-client-boundaries"] },
    { skillId: "typed-form-implementation", agentId: "implementation", capability: "FORM_IMPLEMENTATION", tools: ["context7-read", "shadcn-registry-read", "controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "FORM_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["forms-validation"] },
    { skillId: "maintainable-performance-implementation", agentId: "implementation", capability: "PERFORMANCE_IMPLEMENTATION", tools: ["codebase-memory-read", "controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "ALWAYS", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["maintainability-performance"] },
    { skillId: EMIL_DESIGN_ENGINEERING_SKILL_ID, agentId: "implementation", capability: "EMIL_DESIGN_ENGINEERING", tools: ["controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "ALWAYS", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["emil-design-engineering", "interaction-craft", "typography", "spacing", "responsive-craft"] },
    { skillId: EMIL_ANIMATE_SKILL_ID, agentId: "implementation", capability: "EMIL_ANIMATION_CONSTRUCTION", tools: ["controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "MOTION_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["emil-animation-construction", "motion-tokens", "reduced-motion", "interruptibility"] },
    { skillId: "design-motion-principles", agentId: "implementation", capability: "MOTION_DESIGN_IMPLEMENTATION", tools: ["controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "MOTION_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["motion-frequency-gate", "motion-accessibility", "motion-create-audit"] },
    { skillId: "magic-ui-adaptation", agentId: "implementation", capability: "MAGIC_UI_INTEGRATION", tools: ["controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "MAGIC_UI_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["magic-ui-adaptation", "component-provenance"] },
    { skillId: "daisyui-tailwind-v4", agentId: "implementation", capability: "DAISYUI_INTEGRATION", tools: ["controlled-edit"], permissions: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "RELEVANT_TESTS"], activation: "DAISYUI_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["daisyui-tailwind-v4", "daisyui-theme-tokens"] },
  ],
  allowedTaskTypes: ["prepare-workspace", "implement-project-foundation", "implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form", "integrate-assets", "integrate-content", "implement-seo", "implement-motion", "write-unit-tests", "write-integration-tests", "write-e2e-tests", "repair-targeted-failure"],
  contextPolicy: { version: "frontend-specialist-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 120_000, maxItems: 80 },
  approval: { status: "APPROVED", reviewer: "factory-import-policy", approvedAt: APPROVED_AT },
});

const backendProfile = createApprovedProfile({
  profileId: "backend-implementation",
  agentId: "implementation",
  role: "implementation",
  displayName: "BackendImplementationAgent",
  domain: "BACKEND",
  version: "1.1.0",
  status: "APPROVED",
  source: {
    sourceRepository: "defuj/opencode-agent-kit",
    sourceProfilePath: ".opencode/prompts/agents/node-backend-developer.md",
    sourceProfileUrl: "https://raw.githubusercontent.com/defuj/opencode-agent-kit/main/.opencode/prompts/agents/node-backend-developer.md",
    repositoryUrl: "https://github.com/defuj/opencode-agent-kit",
    sourceContentChecksum: "b93c1cb963386bb04569a37e0c0e55cd9752479a99122b10941a415a9490aa0d",
    license: "MIT",
    licenseUrl: "https://github.com/defuj/opencode-agent-kit/blob/main/LICENSE",
  },
  normalizedGuidance: [
    "Implement only approved Next.js Route Handler and Server Action behavior, including server-side validation, safe error behavior, and explicit API boundaries.",
    "Consume approved database and authentication contracts without redesigning schema, RLS, or persistence authority; keep secrets server-only and use existing Factory adapters.",
    "Keep authentication (who the caller is) separate from authorization (whether the caller may act on this resource); derive identity, role, ownership, tenant, price, permission, and status from trusted server context instead of client input.",
    "Use typed Zod input, result, and error contracts at every server boundary, preserve deterministic validation, unauthenticated, forbidden, not-found, conflict, stale, rate-limit, and internal semantics, and never return raw exceptions or fake success.",
    "When Architecture requires it, make multi-step mutations atomic and reason about compare-and-set, idempotency, unique constraints, state transitions, history, and lost updates; database-owned primitives remain DatabaseImplementationAgent work.",
    "Keep database clients, service credentials, secret environment variables, and private server modules behind server-only boundaries; do not leak privileged data or credentials to Client Components.",
    "Use cache, no-store, revalidation, tag/path invalidation, and authenticated dynamic-data semantics only when the approved Architecture requires them; never cache private data by default or disable caching without reason.",
    "Cover the bounded server behavior with focused validation, authorization, error, transaction/concurrency, route/action, and server-boundary tests, then preserve host-owned task, path, dependency, contract, and approval constraints.",
    "Do not edit schema, migrations, indexes, constraints, RLS, database functions, or database-owned persistence contracts; request a Database task through the host ChangeProposal/TaskGraph route when needed.",
  ],
  rejectedForeignAssumptions: [
    "OpenCode or Claude-specific orchestration, subagent delegation, session tools, question tools, MCP authority, and automatic retries.",
    "Express, Prisma, Postman, foreign package installation, shell, Docker, deployment, Git, and model-selection authority.",
    "Independent database schema or RLS design; Backend may consume only current approved data contracts.",
  ],
  capabilitySurface: ["SOURCE_READ", "BACKEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "RELEVANT_TESTS"],
  implementationCapabilities: ["NEXT_SERVER_RUNTIME", "TYPESCRIPT", "ZOD_VALIDATION", "SERVER_ARCHITECTURE", "AUTHENTICATION", "AUTHORIZATION", "SERVER_TRUST_BOUNDARY", "TYPED_BACKEND_CONTRACTS", "TRANSACTION_CONCURRENCY", "ERROR_MODELING", "SERVER_ONLY_BOUNDARIES", "CACHE_REVALIDATION", "BACKEND_TESTING", "CANONICAL_CONTRACT_CONSUMPTION", "DEPENDENCY_DISCIPLINE", "CONDITIONAL_SUPABASE", "CONDITIONAL_POSTGRES_APPLICATION", "DATABASE_OWNERSHIP_HANDOFF"],
  allowedTools: ["openai-generation", "context7-read", "codebase-memory-read"],
  allowedSkillIds: ["supabase-application-integration"],
  skillBindings: [
    { skillId: "supabase-application-integration", agentId: "implementation", capability: "CONDITIONAL_SUPABASE", tools: ["context7-read", "codebase-memory-read"], permissions: ["SOURCE_READ", "BACKEND_SOURCE_WRITE", "RELEVANT_TESTS"], activation: "SUPABASE_OR_DATABASE_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["supabase-implementation"] },
  ],
  allowedTaskTypes: ["implement-server-action", "implement-route-handler", "implement-authentication", "implement-storage", "implement-email", "repair-targeted-failure"],
  contextPolicy: { version: "backend-specialist-context-v1", allowedCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 80_000, maxItems: 60 },
  approval: { status: "APPROVED", reviewer: "factory-import-policy", approvedAt: APPROVED_AT },
});

const databaseProfile = createApprovedProfile({
  profileId: "database-implementation",
  agentId: "implementation",
  role: "implementation",
  displayName: "DatabaseImplementationAgent",
  domain: "DATABASE",
  version: "1.0.0",
  status: "APPROVED",
  source: {
    sourceRepository: "defuj/opencode-agent-kit",
    sourceProfilePath: ".opencode/prompts/agents/database-specialist.md",
    sourceProfileUrl: "https://raw.githubusercontent.com/defuj/opencode-agent-kit/main/.opencode/prompts/agents/database-specialist.md",
    repositoryUrl: "https://github.com/defuj/opencode-agent-kit",
    sourceContentChecksum: "729da19aba957c448bf16b64f8ddc0501d5c5ca1ac2f678b64d4fe6c5d083e06",
    license: "MIT",
    licenseUrl: "https://github.com/defuj/opencode-agent-kit/blob/main/LICENSE",
  },
  normalizedGuidance: [
    "Implement only the approved PostgreSQL/Supabase schema, migration, constraint, index, query, and RLS contract for the current project.",
    "Treat the approved DatabaseDecision, DataContracts, ownership rules, and migration policy as authoritative; never invent entities, permissions, credentials, or destructive changes.",
    "Return bounded database artifacts and evidence for the owning task; do not implement application UI or API behavior and do not delegate through foreign agent systems.",
  ],
  rejectedForeignAssumptions: [
    "OpenCode or Claude-specific orchestration, delegation commands, session/question tools, MCP authority, and automatic retries.",
    "Prisma/Express application ownership, package installation, shell, Docker, deployment, Git, and direct production-database authority.",
    "Application code, API, UI, or authentication ownership; those remain separate typed Factory task domains.",
  ],
  capabilitySurface: ["SOURCE_READ", "DATABASE_SCHEMA_WRITE", "CONTROLLED_TEXT_PATCH", "RELEVANT_TESTS"],
  implementationCapabilities: ["TYPESCRIPT", "CANONICAL_CONTRACT_CONSUMPTION", "DEPENDENCY_DISCIPLINE", "BACKEND_TESTING", "CONDITIONAL_SUPABASE", "DATABASE_OWNERSHIP_HANDOFF"],
  allowedTools: ["openai-generation", "context7-read", "codebase-memory-read"],
  allowedSkillIds: ["supabase-application-integration"],
  skillBindings: [
    { skillId: "supabase-application-integration", agentId: "implementation", capability: "CONDITIONAL_SUPABASE", tools: ["context7-read", "codebase-memory-read"], permissions: ["SOURCE_READ", "DATABASE_SCHEMA_WRITE", "RELEVANT_TESTS"], activation: "SUPABASE_OR_DATABASE_TASK", inputContract: "implementation.input", outputContract: "implementation.output", coverageKeys: ["supabase-implementation"] },
  ],
  allowedTaskTypes: ["implement-database-schema", "implement-rls-policy", "write-database-tests", "validate-database", "repair-targeted-failure"],
  contextPolicy: { version: "database-specialist-context-v1", allowedCategories: ["PLANNING_PACKAGE", "TASK_SLICE", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"], maxBytes: 80_000, maxItems: 60 },
  approval: { status: "APPROVED", reviewer: "factory-import-policy", approvedAt: APPROVED_AT },
});

export const APPROVED_IMPLEMENTATION_PROFILES = Object.freeze([frontendProfile, backendProfile, databaseProfile]);
export type ApprovedImplementationProfile = (typeof APPROVED_IMPLEMENTATION_PROFILES)[number];

export class AgentProfileRegistryError extends Error {
  constructor(readonly code: "PROFILE_NOT_FOUND" | "PROFILE_DOMAIN_MISMATCH", message: string) {
    super(message);
    this.name = "AgentProfileRegistryError";
  }
}

export class AgentProfileRegistry {
  private readonly profiles = new Map(APPROVED_IMPLEMENTATION_PROFILES.map((profile) => [profile.profileId, profile]));

  all() {
    return APPROVED_IMPLEMENTATION_PROFILES;
  }

  get(profileId: ImplementationSpecialistId) {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new AgentProfileRegistryError("PROFILE_NOT_FOUND", `Implementation profile ${profileId} is not approved.`);
    return profile;
  }

  forDomain(domain: ImplementationDomain) {
    const profile = APPROVED_IMPLEMENTATION_PROFILES.find((candidate) => candidate.domain === domain);
    if (!profile) throw new AgentProfileRegistryError("PROFILE_DOMAIN_MISMATCH", `No approved implementation profile exists for ${domain}.`);
    return profile;
  }
}

export const implementationProfileRegistry = new AgentProfileRegistry();

export function shouldActivateSupabaseImplementationSkill(input: { domain?: ImplementationDomain; taskType: string; hasDatabaseHandoff?: boolean; databaseMode?: "NONE" | "SUPABASE_NEW" | "SUPABASE_EXISTING" }) {
  return input.domain === "DATABASE"
    || Boolean(input.hasDatabaseHandoff)
    || input.databaseMode === "SUPABASE_NEW"
    || input.databaseMode === "SUPABASE_EXISTING"
    || ["implement-authentication", "implement-storage", "implement-database-schema", "implement-rls-policy", "write-database-tests"].includes(input.taskType);
}

export function activeImplementationSkillBindings(profile: AgentProfile, taskType: string, options: { supabaseRequired?: boolean; motionRequested?: boolean; daisyUiRequested?: boolean; magicUiRequested?: boolean } = {}) {
  return profile.skillBindings.filter((binding) =>
    binding.activation === "ALWAYS"
    || (binding.activation === "FORM_TASK" && taskType === "implement-form")
    || (binding.activation === "MOTION_TASK" && options.motionRequested === true)
    || (binding.activation === "DAISYUI_TASK" && options.daisyUiRequested === true)
    || (binding.activation === "MAGIC_UI_TASK" && options.magicUiRequested === true)
    || (binding.activation === "SUPABASE_OR_DATABASE_TASK" && options.supabaseRequired === true),
  );
}

export function activeImplementationSkillIds(profile: AgentProfile, taskType: string, options: { supabaseRequired?: boolean; motionRequested?: boolean; daisyUiRequested?: boolean; magicUiRequested?: boolean } = {}) {
  return activeImplementationSkillBindings(profile, taskType, options).map((binding) => binding.skillId);
}

const FRONTEND_TASK_TYPES = new Set(frontendProfile.allowedTaskTypes.filter((taskType) => taskType !== "repair-targeted-failure"));
const BACKEND_TASK_TYPES = new Set(backendProfile.allowedTaskTypes.filter((taskType) => taskType !== "repair-targeted-failure"));
const DATABASE_TASK_TYPES = new Set(databaseProfile.allowedTaskTypes.filter((taskType) => taskType !== "repair-targeted-failure" && taskType !== "validate-database"));

export function implementationDomainForTaskType(taskType: string): ImplementationDomain | undefined {
  if (FRONTEND_TASK_TYPES.has(taskType)) return "FRONTEND";
  if (BACKEND_TASK_TYPES.has(taskType)) return "BACKEND";
  if (DATABASE_TASK_TYPES.has(taskType)) return "DATABASE";
  return undefined;
}

export function specialistProfileIdForDomain(domain: ImplementationDomain): ImplementationSpecialistId {
  return implementationProfileRegistry.forDomain(domain).profileId;
}
