import "server-only";
import path from "node:path";
import { createProductionFactoryRuntime, type ProductionFactoryProjectScope } from "@/runtime/production-factory-runtime-core";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";

type ProductionWorkbench = {
  application: WorkbenchApplication;
  close: () => Promise<void>;
};

let runtime: ProductionWorkbench | undefined;

export function getProductionWorkbench(): WorkbenchApplication {
  if (!runtime) {
    const env = process.env;
    const generatedProjectsRoot = path.resolve(env.GENERATED_PROJECTS_ROOT ?? ".factory-generated");
    const factory = createProductionFactoryRuntime({ env, generatedProjectsRoot, allowWeb: true });
    const scopes = new Map<string, ProductionFactoryProjectScope>();
    const scopeFor = (slug: string) => {
      const existing = scopes.get(slug);
      if (existing) return existing;
      const created = factory.createProjectScope({ workspaceRoot: generatedProjectsRoot, slug });
      scopes.set(slug, created);
      return created;
    };
    const entry = new TrialEntryService({ database: factory.database, createLeadAgent: (slug) => scopeFor(slug).lead });
    runtime = {
      application: new WorkbenchApplication({ database: factory.database, entry, getWorkflowScope: (slug) => scopeFor(slug) }),
      close: factory.close,
    };
  }
  return runtime.application;
}
