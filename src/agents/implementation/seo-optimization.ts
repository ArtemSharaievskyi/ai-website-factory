import { implementationAgentDefinition } from "@/agents/catalog";

export const SEO_OPTIMIZATION_TASK_TYPE = "implement-seo" as const;
export const SEO_OPTIMIZATION_CAPABILITY = "implementation.seo" as const;
export const SEO_OPTIMIZATION_SCOPES = [
  "src/app/**/metadata.*",
  "src/app/sitemap.*",
  "src/app/robots.*",
] as const;

const isSeoPath = (relativePath: string) => {
  const path = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  return path.startsWith("src/app/") && (
    /(?:^|\/)metadata\.[^/]+$/i.test(path)
    || /(?:^|\/)sitemap\.[^/]+$/i.test(path)
    || /(?:^|\/)robots\.[^/]+$/i.test(path)
  );
};

/**
 * SEO is a named capability of the existing Implementation Agent. This
 * descriptor gives the host a discoverable bounded route without creating a
 * second source-write authority or a self-certifying SEO reviewer.
 */
export class SEOOptimizationAgent {
  readonly agentId = "implementation" as const;
  readonly capability = SEO_OPTIMIZATION_CAPABILITY;
  readonly taskType = SEO_OPTIMIZATION_TASK_TYPE;
  readonly readOnly = false as const;
  readonly writeAuthority = "ImplementationAgentService" as const;
  readonly independentReviewer = "seo-review" as const;
  readonly scopes = SEO_OPTIMIZATION_SCOPES;

  getAgentDefinition() {
    return implementationAgentDefinition;
  }

  canWrite(relativePath: string) {
    return isSeoPath(relativePath);
  }

  assertWriteScope(relativePath: string) {
    if (!this.canWrite(relativePath)) throw new Error("SEO_OPTIMIZATION_SCOPE_INVALID");
    return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  }
}
