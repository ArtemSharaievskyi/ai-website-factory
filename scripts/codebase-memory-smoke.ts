import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadFactoryCliEnv } from "./cli-env";
import { readCodebaseMemoryConfig } from "../src/codebase-memory/config";
import { CodebaseMemoryService } from "../src/codebase-memory/service";
import { createProcessTransport } from "../src/codebase-memory/transport";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_REAL_CODEBASE_MEMORY_SMOKE !== "true") { console.log("REAL_CODEBASE_MEMORY_SMOKE_PENDING"); return; }
  const root=await mkdtemp(path.join(os.tmpdir(),"factory-codebase-memory-smoke-")); const workspace=path.join(root,"fixture","v1"); await mkdir(path.join(workspace,"src"),{recursive:true}); await writeFile(path.join(workspace,"src","index.ts"),"export function submitRepairRequest() { return ContactForm(); }\nfunction ContactForm() { return true; }\n");
  try { const config=readCodebaseMemoryConfig({ ...process.env, CODEBASE_MEMORY_ENABLED:"true", GENERATED_PROJECTS_ROOT:root }); if (!config.executable) throw new Error("CODEBASE_MEMORY_EXECUTABLE_REQUIRED"); const service=new CodebaseMemoryService(createProcessTransport(config.executable,workspace,config.timeoutMs),config); const scope={projectId:randomUUID(),projectVersion:1,workspacePath:workspace,generatedProjectsRoot:root,workspaceManagerReference:"smoke-fixture:v1"}; const index=await service.ensureIndex(scope,"smoke"); const plan={queryId:randomUUID(),projectId:scope.projectId,projectVersion:1,taskId:"smoke",requesterRole:"implementation" as const,operation:"findSymbol" as const,symbol:"submitRepairRequest",reason:"Verify the known fixture symbol is indexed.",requirementReferences:["smoke"],taskReferences:["smoke"],maxResults:5,maxBytes:4000,sourceManifestChecksum:index.manifestChecksum,workspaceScope:scope}; const result=await service.findSymbol(plan); if (!result.symbols.length) throw new Error("SMOKE_SYMBOL_NOT_FOUND"); console.log(JSON.stringify({status:"REAL_CODEBASE_MEMORY_SMOKE_PASSED",resultCount:result.symbols.length})); } finally { await rm(root,{recursive:true,force:true}); }
}
void main();
