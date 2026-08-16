import { createHash } from "node:crypto";
import type { BriefRequirementEntry, BriefAssetRequirement, BriefDeferredIntegration, BriefDecision } from "../brief";
import type { RequirementSpecification } from "../schema";
import type { CanonicalAsset, CanonicalRequirement, RequirementCategory } from "./schema";

export const legacyTextIdentity = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

/** Legacy identity is used only once at migration; V3 mutation never compares these statements. */
export const legacyRequirementId = (version: 1 | 2, field: string, value: string, _index: number, explicitId?: string) =>
  `REQUIREMENT:legacy-v${version}-${field}-${digest(explicitId ? `id:${explicitId}` : `text:${legacyTextIdentity(value)}`)}`;

export const legacyAssetId = (version: 1 | 2, field: string, reference: string, role: string) =>
  `ASSET:v${version}-${field}-${digest(`${role}:${reference}`)}`;

export const legacySourceRef = (version: 1 | 2, field: string, index: number, identity?: string) => identity === undefined
  ? `legacy:v${version}:${field}:${index}`
  : `legacy:v${version}:${field}:${digest(legacyTextIdentity(identity))}`;

export function legacyRequirement(version: 1 | 2, field: string, index: number, statement: string, category: RequirementCategory, sourceRefs: string[] = [], explicitId?: string): CanonicalRequirement {
  return {
    id: legacyRequirementId(version, field, statement, index, explicitId),
    category,
    statement,
    sourceRefs: sourceRefs.length ? sourceRefs : [legacySourceRef(version, field, index, statement)],
  };
}

export function legacyEntryRequirement(version: 1 | 2, field: string, index: number, entry: BriefRequirementEntry, category: RequirementCategory): CanonicalRequirement {
  return legacyRequirement(version, field, index, entry.statement, category, entry.sourceRefs, entry.id);
}

export function legacyAsset(version: 1 | 2, field: string, index: number, asset: BriefAssetRequirement, id: string): CanonicalAsset {
  return {
    id,
    reference: asset.reference,
    role: asset.role,
    usage: asset.usage,
    replacementPolicy: asset.replacementForbidden ? "FORBIDDEN" : "ALLOWED",
    sourceRefs: asset.sourceRefs.length ? asset.sourceRefs : [legacySourceRef(version, field, index, `${asset.role}:${asset.reference}`)],
  };
}

export function legacyDecisionRequirement(version: 1 | 2, field: string, index: number, item: BriefDecision): CanonicalRequirement {
  return legacyRequirement(version, field, index, `${item.key}: ${item.value}`, "DECISION", item.sourceRefs, item.key);
}

export function legacyDeferredRequirement(version: 1 | 2, field: string, index: number, item: BriefDeferredIntegration): CanonicalRequirement {
  return legacyRequirement(version, field, index, `${item.integration}: ${item.rationale}`, "DEFERRED_INTEGRATION", item.sourceRefs, item.integration);
}

export function isLegacySimulationProhibition(value: string): boolean {
  const normalized = legacyTextIdentity(value).toLowerCase();
  const success = /(?:success|submission|submit|erfolg|übermittlung|uebermittlung|übertragung|uebertragung|vortäusch|vortaeusch|fake|simulat|успеш|отправ|имитац|симул|успіх|передач|відправ)/i.test(normalized);
  const prohibition = /(?:no |not |do not|don't|forbid|prohibit|kein|nicht|verbot|запрещ|нельзя|не можна|не іміт)/i.test(normalized);
  return success && prohibition;
}

export const valueText = (value: RequirementSpecification["suppliedBrandInformation"]) => value.status === "provided" ? value.value : value.status === "deferred" ? value.reason : null;
