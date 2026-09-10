import type { ArchitectureReviewInput, ArchitectureReviewOutput } from "./contracts";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
import type { ProviderInvocationContext, ProviderInvocationLedgerPort } from "@/integrations/openai/usage";

export type ArchitectureReviewExecutionContext = {
  correlationId?: string;
  providerInvocationLedger?: ProviderInvocationLedgerPort;
  setStage?: (stage: "PREFLIGHT" | "PROVIDER_TRANSPORT" | "PERSISTENCE") => void | Promise<void>;
  markCanonicalPersisted?: (lifecycleMutated: boolean) => void | Promise<void>;
};

export interface ArchitectureReviewProvider { readonly promptVersion: string; review(input: ArchitectureReviewInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string, providerInvocation?: ProviderInvocationContext): Promise<ArchitectureReviewOutput>; }
