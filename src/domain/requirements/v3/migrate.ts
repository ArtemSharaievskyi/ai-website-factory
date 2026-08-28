import { migrateV1ToCanonicalBriefV3, migrateV1RecordToCanonicalBriefV3WithLineage } from "./migrate-v1";
import { migrateV2ToCanonicalBriefV3, migrateV2RecordToCanonicalBriefV3WithLineage } from "./migrate-v2";

/** Read-only compatibility boundary. The reducer never receives a legacy Brief. */
export function migrateLegacyBriefToCanonicalBriefV3(input: unknown) {
  if (input && typeof input === "object" && "briefSchemaVersion" in input && input.briefSchemaVersion === 2) return migrateV2ToCanonicalBriefV3(input);
  return migrateV1ToCanonicalBriefV3(input);
}

export { migrateV1ToCanonicalBriefV3, migrateV1RecordToCanonicalBriefV3WithLineage } from "./migrate-v1";
export { migrateV2ToCanonicalBriefV3, migrateV2RecordToCanonicalBriefV3WithLineage } from "./migrate-v2";

export function migrateLegacyBriefToCanonicalBriefV3WithLineage(input: unknown) {
  if (input && typeof input === "object" && "briefSchemaVersion" in input && input.briefSchemaVersion === 2) return migrateV2RecordToCanonicalBriefV3WithLineage(input as Parameters<typeof migrateV2RecordToCanonicalBriefV3WithLineage>[0]);
  return migrateV1RecordToCanonicalBriefV3WithLineage(input as Parameters<typeof migrateV1RecordToCanonicalBriefV3WithLineage>[0]);
}
