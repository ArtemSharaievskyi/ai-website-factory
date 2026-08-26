import type { CanonicalBriefV3, CanonicalUnresolvedStage } from "./schema";

const legalFactMarker = /(?:\blegal\b|\brecht(?:lich)?\b|gesetz(?:lich)?|impressum|datenschutz|privacy|anschrift|address|ladungs|steuer|tax|handelsregister|company details|business details)/iu;
const missingFactMarker = /(?:unresolved|not (?:provided|supplied|available)|missing|remain(?:s)?|lack(?:s)?|fehlen|fehlend|nicht (?:bereitgestellt|vorhanden|geliefert)|ausstehend|offen|required|needed)/iu;
const placeholderMarker = /(?:placeholder|platzhalter)/iu;
const publicationMarker = /(?:public(?:ation|ly)?|publish(?:ing|ed)?|release|veröffent|öffentlich|freigabe)/iu;
const imageMarker = /(?:photo(?:graph)?s?|image(?:ry)?|asset|foto(?:s)?|bild(?:er)?|imagery)/iu;
const rightsMarker = /(?:right(?:s)?|license|licen[cs]e|provenance|copyright|urheber|lizenz|herkunft|source)/iu;

type CanonicalUnresolvedItem = CanonicalBriefV3["unresolved"][number];

/** Generic semantic recognition used only for historical items without ownership metadata. */
export function isLegalUnresolvedRequirement(brief: CanonicalBriefV3, item: CanonicalUnresolvedItem): boolean {
  if (brief.legal.placeholderPolicy !== "USE_EXPLICIT_PLACEHOLDERS") return false;
  const targetLooksLegal = /(?:^|:)(?:legal|legal[_-]|imprint|privacy)(?:$|[:_-])/iu.test(item.target);
  const text = `${item.target} ${item.reason} ${item.sourceRefs.join(" ")}`;
  return legalFactMarker.test(text)
    && missingFactMarker.test(text)
    && placeholderMarker.test(text)
    && (targetLooksLegal || publicationMarker.test(text));
}

export function isPhotoRightsUnresolvedRequirement(item: CanonicalUnresolvedItem): boolean {
  const text = `${item.target} ${item.reason} ${item.sourceRefs.join(" ")}`;
  return imageMarker.test(text) && rightsMarker.test(text) && missingFactMarker.test(text);
}

/**
 * Return canonical lifecycle ownership. Explicit ownership is authoritative;
 * historical items without it fail closed to Planning unless a generic legal
 * placeholder or photo-rights pattern proves a later-stage deferral.
 */
export function canonicalUnresolvedBlockingStages(
  brief: CanonicalBriefV3,
  item: CanonicalUnresolvedItem,
): readonly CanonicalUnresolvedStage[] {
  if (item.blockingStages !== undefined) return [...item.blockingStages];
  if (isLegalUnresolvedRequirement(brief, item)) return ["PUBLICATION"];
  if (isPhotoRightsUnresolvedRequirement(item)) return ["ASSET_REVIEW", "PUBLICATION"];
  return ["PLANNING"];
}

export function canonicalUnresolvedBlocksStage(
  brief: CanonicalBriefV3,
  item: CanonicalUnresolvedItem,
  stage: CanonicalUnresolvedStage,
): boolean {
  return canonicalUnresolvedBlockingStages(brief, item).includes(stage);
}
