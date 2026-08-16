export type BriefV3ErrorCode =
  | "BRIEF_V3_SCHEMA_INVALID"
  | "BRIEF_V3_INVARIANT_VIOLATION"
  | "BRIEF_V3_CHANGESET_INVALID"
  | "BRIEF_V3_UNKNOWN_TARGET"
  | "BRIEF_V3_UNSUPPORTED_VALUE"
  | "BRIEF_V3_CONFLICTING_OPERATIONS"
  | "BRIEF_V3_INVALID_COMBINATION"
  | "BRIEF_V3_DUPLICATE_TARGET"
  | "BRIEF_V3_REDUCTION_INVALID"
  | "BRIEF_V3_MIGRATION_INVALID"
  | "BRIEF_V3_MIGRATION_AMBIGUOUS";

/** Typed, safe domain failure for the V3 core. Details must not contain raw provider payloads. */
export class BriefV3Error extends Error {
  readonly name: string = "BriefV3Error";

  constructor(
    readonly code: BriefV3ErrorCode,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(code);
  }
}

export class BriefV3MigrationAmbiguityError extends BriefV3Error {
  readonly name: string = "BriefV3MigrationAmbiguityError";

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super("BRIEF_V3_MIGRATION_AMBIGUOUS", { field, reason });
  }
}
