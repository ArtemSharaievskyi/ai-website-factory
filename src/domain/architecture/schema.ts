import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema } from "../shared/schemas";

export const BackendPrioritySchema = z
  .array(z.enum(["server-actions", "route-handlers", "supabase-services"]))
  .max(3)
  .refine((values) => new Set(values).size === values.length, "Backend priorities must be unique.");

export const TechnicalArchitectureSchema = DocumentBaseSchema.extend({
  documentType: z.literal("architecture"),
  applicationProfile: z.enum(["marketing-site", "business-site", "web-application"]),
  packageManager: z.literal("npm"),
  routes: z.array(z.object({ path: NonEmptyStringSchema, responsibility: NonEmptyStringSchema }).strict()),
  componentBoundaries: z.array(NonEmptyStringSchema),
  componentDecisions: z.array(z.object({ area: NonEmptyStringSchema, serverOrClient: z.enum(["server", "client"]), rationale: NonEmptyStringSchema }).strict()),
  serverActions: z.array(NonEmptyStringSchema),
  routeHandlers: z.array(NonEmptyStringSchema),
  backendPriority: BackendPrioritySchema,
  supabaseDatabaseRequirements: z.array(NonEmptyStringSchema),
  schemaPlan: z.array(NonEmptyStringSchema),
  rlsRequirements: z.array(NonEmptyStringSchema),
  authenticationPlan: NonEmptyStringSchema,
  storagePlan: NonEmptyStringSchema,
  emailPlan: NonEmptyStringSchema,
  environmentVariables: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), required: z.boolean(), public: z.boolean() }).strict()),
  dependencies: z.array(z.object({ name: NonEmptyStringSchema, purpose: NonEmptyStringSchema }).strict()),
  npmScripts: z.record(z.string(), NonEmptyStringSchema),
  testStrategy: z.array(NonEmptyStringSchema),
  securityControls: z.array(NonEmptyStringSchema),
  rejectedInfrastructure: z.array(NonEmptyStringSchema),
  acceptance: z.object({ accepted: z.boolean(), acceptedAt: IsoDateTimeSchema.optional(), acceptedBy: NonEmptyStringSchema.optional() }).strict(),
}).strict().superRefine((architecture, context) => {
  const forbidden = architecture.dependencies.filter((dependency) => /^(pnpm|yarn|nest|nestjs|redis|bullmq)$/i.test(dependency.name));
  if (forbidden.length) context.addIssue({ code: "custom", path: ["dependencies"], message: "Architecture contains a prohibited dependency or package manager" });
});
export type TechnicalArchitecture = z.infer<typeof TechnicalArchitectureSchema>;
