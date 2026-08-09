import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import type { ArchitectureReviewResult } from "@/domain/review/schema";

export const ARCHITECTURE_REVIEW_POLICY_VERSION = "architecture-review-v1" as const;
export const FACTORY_ARCHITECTURE_STACK = ["Next.js App Router", "React", "TypeScript", "Tailwind", "shadcn/ui where appropriate", "Supabase only when persistence/auth/storage is required", "Zod", "React Hook Form when justified", "Server Actions preferred", "Route Handlers second", "npm", "Vitest", "Playwright", "ESLint", "Motion only where purposeful"] as const;
export const FactoryArchitecturePolicySchema = z.object({
  policyVersion: z.literal("factory-architecture-v1"), stack: z.array(z.string().min(1)).min(1), prohibitedTechnologies: z.array(z.string().min(1)), serverActionPreference: z.literal("preferred"), routeHandlerPreference: z.literal("second"), packageManager: z.literal("npm"),
}).strict();
export type FactoryArchitecturePolicy = z.infer<typeof FactoryArchitecturePolicySchema>;

export const ArchitectureReviewInputSchema = z.object({
  projectId: z.string().uuid(), projectVersion: z.number().int().positive(), approvedBrief: RequirementSpecificationSchema, approvedBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/), acceptedPlanningPackage: PlanningPackageSchema, acceptedPlanningChecksum: z.string().regex(/^[a-f0-9]{64}$/), factoryArchitecturePolicy: FactoryArchitecturePolicySchema, relevantProjectConstraints: z.array(z.string().min(1)).max(40), idempotencyKey: z.string().min(1), expectedRowVersion: z.number().int().positive(),
}).strict();
export type ArchitectureReviewInput = z.input<typeof ArchitectureReviewInputSchema>;
export type ArchitectureReviewOutput = ArchitectureReviewResult;
