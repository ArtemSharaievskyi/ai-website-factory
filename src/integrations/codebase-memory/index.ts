export * from "./contracts";
export * from "./errors";
export * from "./config";
export * from "./policy";
export * from "./service";
export * from "./transport";
export * from "./mock";
export * from "./metadata";
export * from "./repair";
import { CodebaseMemoryError } from "./errors";
import type { CodebaseMemoryPort } from "./contracts";
export function createDisabledCodebaseMemoryPort(): CodebaseMemoryPort { const unavailable=async()=>{throw new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE","Codebase Memory is disabled.");}; return {ensureIndex:unavailable,getIndexStatus:unavailable,findSymbol:unavailable,findFile:unavailable,findReferences:unavailable,findCallers:unavailable,findCallees:unavailable,findImports:unavailable,findRoutes:unavailable,analyzeImpact:unavailable,getRelevantSource:unavailable,refreshIndex:unavailable} as CodebaseMemoryPort; }
