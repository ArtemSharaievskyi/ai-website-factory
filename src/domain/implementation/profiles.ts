import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { AgentContextCategorySchema } from "@/domain/agents/schema";
import { ToolIdSchema } from "@/domain/tooling/schema";

export const ImplementationDomainSchema = z.enum(["FRONTEND", "BACKEND", "DATABASE"]);
export type ImplementationDomain = z.infer<typeof ImplementationDomainSchema>;

export const ImplementationSpecialistIdSchema = z.enum([
  "frontend-implementation",
  "backend-implementation",
  "database-implementation",
]);
export type ImplementationSpecialistId = z.infer<typeof ImplementationSpecialistIdSchema>;

const ProfileSurfaceSchema = z.enum([
  "SOURCE_READ",
  "FRONTEND_SOURCE_WRITE",
  "BACKEND_SOURCE_WRITE",
  "DATABASE_SCHEMA_WRITE",
  "CONTROLLED_TEXT_PATCH",
  "CONTROLLED_AST_PATCH",
  "ASSET_READ",
  "RELEVANT_TESTS",
]);

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
  allowedTools: z.array(ToolIdSchema),
  allowedSkillIds: z.array(z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)),
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
  version: "1.0.0",
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
    "Prefer small, maintainable changes and validate the relevant frontend behavior within the exact task scopes.",
  ],
  rejectedForeignAssumptions: [
    "OpenCode or Claude-specific orchestration, subagent invocation, session, question, and MCP authority.",
    "Foreign slash commands, model selection, filesystem or shell authority, Git push/commit authority, and package installation.",
    "Foreign framework defaults such as Vite, Zustand, Prisma, or Express when they are not present in the approved Factory Architecture.",
  ],
  capabilitySurface: ["SOURCE_READ", "FRONTEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "CONTROLLED_AST_PATCH", "ASSET_READ", "RELEVANT_TESTS"],
  allowedTools: ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "controlled-edit"],
  allowedSkillIds: ["nextjs-server-client-implementation", "typed-form-implementation", "maintainable-performance-implementation"],
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
  version: "1.0.0",
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
    "Cover the bounded server behavior with relevant tests and preserve the host-owned task, path, dependency, and approval constraints.",
  ],
  rejectedForeignAssumptions: [
    "OpenCode or Claude-specific orchestration, subagent delegation, session tools, question tools, MCP authority, and automatic retries.",
    "Express, Prisma, Postman, foreign package installation, shell, Docker, deployment, Git, and model-selection authority.",
    "Independent database schema or RLS design; Backend may consume only current approved data contracts.",
  ],
  capabilitySurface: ["SOURCE_READ", "BACKEND_SOURCE_WRITE", "CONTROLLED_TEXT_PATCH", "RELEVANT_TESTS"],
  allowedTools: ["openai-generation", "context7-read", "codebase-memory-read"],
  allowedSkillIds: ["supabase-application-integration"],
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
  allowedTools: ["openai-generation", "context7-read", "codebase-memory-read"],
  allowedSkillIds: ["supabase-application-integration"],
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
