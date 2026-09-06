export const LOCAL_SUPABASE_RUNTIME_POLICY_VERSION = "local-supabase-runtime-v1";

export type GeneratedDatabaseCommand =
  | "docker-info"
  | "supabase-version"
  | "supabase-init"
  | "supabase-start"
  | "supabase-status"
  | "supabase-reset"
  | "supabase-test"
  | "supabase-stop";

export type GeneratedDatabaseProcessResult = {
  command: GeneratedDatabaseCommand;
  exitCode: number | null;
  stdoutSummary: string;
  stderrSummary: string;
  startedAt: string;
  completedAt: string;
};

export type GeneratedDatabaseProcessPort = {
  run(input: {
    command: GeneratedDatabaseCommand;
    workspacePath: string;
    signal?: AbortSignal;
  }): Promise<GeneratedDatabaseProcessResult>;
};

export type GeneratedDatabaseValidationStatus =
  | "STATIC_VALIDATION_PASSED"
  | "STATIC_VALIDATION_FAILED"
  | "BEHAVIORAL_VALIDATION_PASSED"
  | "BEHAVIORAL_VALIDATION_RUNTIME_UNAVAILABLE"
  | "BEHAVIORAL_VALIDATION_FAILED";

export type GeneratedDatabaseBehavioralValidation =
  | "NOT_RUN"
  | "PASSED"
  | "RUNTIME_UNAVAILABLE"
  | "FAILED";

export type GeneratedDatabaseValidationResult = {
  passed: boolean;
  status: GeneratedDatabaseValidationStatus;
  staticValidation: "PASSED" | "FAILED";
  behavioralValidation: GeneratedDatabaseBehavioralValidation;
  safeFailureCode?:
    | "LOCAL_SUPABASE_RUNTIME_UNAVAILABLE"
    | "LOCAL_SUPABASE_CLI_UNAVAILABLE"
    | "GENERATED_DATABASE_NOT_INITIALIZED"
    | "GENERATED_DATABASE_MIGRATION_INVALID"
    | "GENERATED_DATABASE_TESTS_MISSING"
    | "GENERATED_DATABASE_VALIDATION_FAILED";
  summary: string;
  startedAt: string;
  completedAt: string;
  commands: GeneratedDatabaseProcessResult[];
  migrationCount: number;
  testCount: number;
};

export type GeneratedDatabaseValidatorPort = {
  validate(input: {
    workspacePath: string;
    generatedProjectsRoot: string;
    signal?: AbortSignal;
  }): Promise<GeneratedDatabaseValidationResult>;
};
