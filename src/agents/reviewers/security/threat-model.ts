import { runSecurityThreatModel, ThreatModelInputSchema, ThreatModelResultSchema, type ThreatModelInput, type ThreatModelResult } from "@/domain/assurance/contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import type { OrchestratorInput } from "@/orchestration/orchestrator/contracts";

/**
 * Read-only, deterministic pre-implementation threat modeling. The host calls
 * this after approved Architecture and before implementation admission; it
 * never edits source or persists a lifecycle decision.
 */
export class SecurityThreatModelAgent {
  readonly agent = "security-threat-model" as const;
  readonly readOnly = true as const;
  run(raw: ThreatModelInput): ThreatModelResult {
    return ThreatModelResultSchema.parse(runSecurityThreatModel(ThreatModelInputSchema.parse(raw)));
  }
}

export function assertSecurityThreatModelReady(result: ThreatModelResult) {
  const parsed = ThreatModelResultSchema.parse(result);
  if (parsed.verdict === "BLOCK") throw new Error("SECURITY_THREAT_MODEL_BLOCKED");
  return parsed;
}

const bounded = (values: readonly unknown[]) => values
  .map((value) => typeof value === "string" ? value : JSON.stringify(value))
  .filter((value): value is string => Boolean(value && value.trim()))
  .map((value) => value.replaceAll(/\s+/g, " ").trim().slice(0, 500))
  .filter(Boolean);

/** Build a semantic, bounded threat-model view from already-approved host data. */
export function threatModelInputFromOrchestrator(input: Pick<OrchestratorInput, "approvedBrief" | "acceptedPlanningPackage" | "technicalArchitecture">): ThreatModelInput {
  const brief = input.approvedBrief;
  const planning = input.acceptedPlanningPackage;
  const architecture = input.technicalArchitecture;
  const briefFacts = bounded([
    brief.projectSummary,
    ...brief.businessGoals,
    ...brief.targetAudiences,
    ...brief.features,
    ...brief.forms,
    ...brief.backendRequirements,
    ...brief.supabaseRequirements,
    ...brief.contentRequirements,
    ...brief.technicalConstraints,
  ]);
  const authentication = planning.authentication;
  const storage = planning.storage;
  const dependencyFacts = planning.dependencies.dependencies.map((dependency) => `${dependency.name}: ${dependency.purpose}; ${dependency.securityConsiderations.join(", ")}`);
  return ThreatModelInputSchema.parse({
    architectureChecksum: checksumPersistedDocument(architecture),
    briefText: briefFacts.join(" "),
    planningText: bounded([planning.sitemap.routes.map((route) => `${route.path}: ${route.titlePurpose}`)]).join(" "),
    dataFlows: bounded([...architecture.serverActions, ...architecture.routeHandlers, ...architecture.backendPriority]),
    authModel: bounded([architecture.authenticationPlan, authentication.decision, ...authentication.protectedRoutes, ...authentication.sessionNeeds, authentication.rlsRelationship]),
    roleModel: bounded([...authentication.userRoles, ...authentication.authorizationRules, ...architecture.rlsRequirements]),
    databaseBoundaries: bounded([...architecture.supabaseDatabaseRequirements, ...architecture.schemaPlan, ...architecture.rlsRequirements, planning.dataModel.entities]),
    thirdPartyIntegrations: bounded([...architecture.dependencies.map((dependency) => `${dependency.name}: ${dependency.purpose}`), ...dependencyFacts]),
    externalApis: bounded([...architecture.routeHandlers.filter((route) => /api|webhook|provider|external/i.test(route)), ...brief.backendRequirements.filter((item) => /api|webhook|provider|external/i.test(item))]),
    uploads: bounded([architecture.storagePlan, storage.decision, storage.buckets, storage.policies]),
    payments: bounded(briefFacts.filter((item) => /payment|checkout|subscription|price|order/i.test(item))),
    userGeneratedContent: bounded(briefFacts.filter((item) => /user.?generated|comment|review|rich.?text|markdown/i.test(item))),
    sensitiveDataClassification: bounded([...(brief.legalFacts ?? []), ...(brief.contactFacts ?? []), ...planning.dataModel.entities].filter((item) => /personal|sensitive|health|financial|identity|email|address|phone/i.test(typeof item === "string" ? item : JSON.stringify(item)))),
    securityControls: bounded([
      ...architecture.securityControls,
      ...planning.security.controls.map((control) => `${control.control}: ${control.scope}`),
      ...planning.security.loggingRedaction,
      ...planning.security.errorHandling,
    ]),
  });
}

export function runPreImplementationSecurityThreatModel(input: Pick<OrchestratorInput, "approvedBrief" | "acceptedPlanningPackage" | "technicalArchitecture">) {
  if (!input.technicalArchitecture.acceptance.accepted) throw new Error("SECURITY_THREAT_MODEL_ARCHITECTURE_NOT_APPROVED");
  return assertSecurityThreatModelReady(new SecurityThreatModelAgent().run(threatModelInputFromOrchestrator(input)));
}
