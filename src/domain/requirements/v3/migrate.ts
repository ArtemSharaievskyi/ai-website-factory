import { migrateV1ToCanonicalBriefV3 } from "./migrate-v1";
import { migrateV2ToCanonicalBriefV3 } from "./migrate-v2";

/** Read-only compatibility boundary. The reducer never receives a legacy Brief. */
export function migrateLegacyBriefToCanonicalBriefV3(input: unknown) {
  if (input && typeof input === "object" && "briefSchemaVersion" in input && input.briefSchemaVersion === 2) return migrateV2ToCanonicalBriefV3(input);
  return migrateV1ToCanonicalBriefV3(input);
}

export { migrateV1ToCanonicalBriefV3 } from "./migrate-v1";
export { migrateV2ToCanonicalBriefV3 } from "./migrate-v2";
