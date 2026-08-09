import type { ContractAuditInput } from "./contracts";
import type { ContractAuditResult } from "@/domain/review/schema";
export interface ContractAuditProvider { readonly promptVersion: string; review(input: ContractAuditInput, signal?: AbortSignal): Promise<ContractAuditResult>; }
