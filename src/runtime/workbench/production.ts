import "server-only";
import path from "node:path";
import { createProductionFactoryRuntime, type ProductionFactoryProjectScope } from "@/runtime/production-factory-runtime-core";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { ProjectAssetService } from "@/runtime/assets/service";

type ProductionWorkbench = {
  application: WorkbenchApplication;
  assets: ProjectAssetService;
  close: () => Promise<void>;
};

let runtime: ProductionWorkbench | undefined;

export function getProductionWorkbench(): WorkbenchApplication {
  if (!runtime) {
    const env = process.env;
    const generatedProjectsRoot = path.resolve(env.GENERATED_PROJECTS_ROOT ?? ".factory-generated");
    const assetRoot = path.resolve(env.FACTORY_ASSET_ROOT ?? ".factory-assets");
    const factory = createProductionFactoryRuntime({ env, generatedProjectsRoot, allowWeb: true });
    const assets = new ProjectAssetService({ database: factory.database, root: assetRoot });
    const scopes = new Map<string, ProductionFactoryProjectScope>();
    const scopeFor = (slug: string) => {
      const existing = scopes.get(slug);
      if (existing) return existing;
      const created = factory.createProjectScope({ workspaceRoot: generatedProjectsRoot, slug });
      scopes.set(slug, created);
      return created;
    };
    const entry = new TrialEntryService({ database: factory.database, assets, createLeadAgent: (slug) => scopeFor(slug).lead, createBriefRevisionV3: (slug) => scopeFor(slug).briefRevisionV3, createBriefApproval: (slug) => scopeFor(slug).briefApproval });
    runtime = {
      application: new WorkbenchApplication({ database: factory.database, entry, assets, getWorkflowScope: (slug) => scopeFor(slug) }),
      assets,
      close: factory.close,
    };
  }
  return runtime.application;
}

export function getProductionAssetIntake(): ProjectAssetService {
  if (!runtime) getProductionWorkbench();
  return runtime!.assets;
}
