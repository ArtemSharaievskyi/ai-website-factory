import type { ContractAuditInput } from "./contracts";
import type { ContractAuditResult } from "@/domain/review/schema";
import type { ApprovedProceduralSkillContext } from "@/skills/runtime/resolver";
export interface ContractAuditProvider { readonly promptVersion: string; review(input: ContractAuditInput, signal?: AbortSignal, approvedSkills?: readonly ApprovedProceduralSkillContext[], skillContextIdentity?: string): Promise<ContractAuditResult>; }
