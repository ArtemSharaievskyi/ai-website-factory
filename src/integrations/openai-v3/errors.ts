export type BriefV3ProviderErrorCode =
  | "BRIEF_V3_PROVIDER_UNKNOWN_TARGET"
  | "BRIEF_V3_PROVIDER_INVALID_OUTPUT"
  | "BRIEF_V3_PROVIDER_TARGET_VALUE_INVALID";

/** Safe boundary error; details never contain raw provider output or prompts. */
export class BriefV3ProviderError extends Error {
  name = "BriefV3ProviderError";

  constructor(
    readonly code: BriefV3ProviderErrorCode,
    readonly details: { fieldPath?: string } = {},
  ) {
    super(code);
  }
}
