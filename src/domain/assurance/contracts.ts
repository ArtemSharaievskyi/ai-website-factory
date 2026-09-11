import { z } from "zod";
import { IsoDateTimeSchema } from "@/domain/shared/schemas";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const SafeTextSchema = z.string().min(1).max(500);
const SafeRouteSchema = z.string().min(1).max(300).refine((value) => value.startsWith("/") ? !value.startsWith("//") && !value.includes("..") : SafeIdSchema.safeParse(value).success, "Route must be a safe relative path or bounded evidence reference.");

export const SECURITY_BASELINE_VERSION = "security-baseline-owasp-asvs-5.0.0-top10-2025-v1" as const;
export const OWASP_ASVS_BASELINE = "OWASP ASVS 5.0.0" as const;
export const OWASP_TOP_10_BASELINE = "OWASP Top 10:2025" as const;
export const OWASP_TOP_10_2025_IDS = ["A01-Broken Access Control", "A02-Security Misconfiguration", "A03-Software Supply Chain Failures", "A04-Cryptographic Failures", "A05-Injection", "A06-Insecure Design", "A07-Authentication Failures", "A08-Software and Data Integrity Failures", "A09-Security Logging and Alerting Failures", "A10-Mishandling of Exceptional Conditions"] as const;

export const SecurityThreatCategorySchema = z.enum([
  "AUTHENTICATION", "AUTHORIZATION", "SESSION", "INJECTION", "XSS", "CSRF", "SSRF", "UPLOAD",
  "SECRETS", "SENSITIVE_DATA", "CRYPTOGRAPHY", "THIRD_PARTY", "ABUSE_RATE_LIMIT", "ERROR_HANDLING",
  "SUPPLY_CHAIN", "MONITORING",
]);
export type SecurityThreatCategory = z.infer<typeof SecurityThreatCategorySchema>;
export const SecurityThreatSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type SecurityThreatSeverity = z.infer<typeof SecurityThreatSeveritySchema>;
export const AttackSurfaceSchema = z.object({
  id: SafeIdSchema,
  kind: z.enum(["PUBLIC_ROUTE", "AUTH", "AUTHORIZATION", "DATABASE", "STORAGE", "UPLOAD", "EXTERNAL_API", "PAYMENT", "USER_CONTENT", "SENSITIVE_DATA", "THIRD_PARTY"]),
  boundary: SafeTextSchema,
  exposure: z.enum(["PUBLIC", "AUTHENTICATED", "INTERNAL"]),
  sensitiveData: z.boolean(),
  evidenceRefs: z.array(SafeIdSchema).max(20),
}).strict();
export type AttackSurface = z.infer<typeof AttackSurfaceSchema>;
export const SecurityControlRequirementSchema = z.object({
  id: SafeIdSchema,
  title: SafeTextSchema,
  mandatory: z.boolean(),
  owner: z.enum(["ARCHITECTURE", "IMPLEMENTATION", "DATABASE", "OPERATIONS", "USER_INPUT"]),
  evidenceRefs: z.array(SafeIdSchema).max(20),
}).strict();
export type SecurityControlRequirement = z.infer<typeof SecurityControlRequirementSchema>;
export const SecurityThreatSchema = z.object({
  id: SafeIdSchema,
  surfaceId: SafeIdSchema,
  category: SecurityThreatCategorySchema,
  severity: SecurityThreatSeveritySchema,
  summary: SafeTextSchema,
  requiredControlIds: z.array(SafeIdSchema).min(1).max(10),
  mitigated: z.boolean(),
  evidenceRefs: z.array(SafeIdSchema).max(20),
}).strict();
export type SecurityThreat = z.infer<typeof SecurityThreatSchema>;

export const ThreatModelInputSchema = z.object({
  architectureChecksum: HashSchema,
  briefText: z.string().max(200_000).default(""),
  planningText: z.string().max(200_000).default(""),
  dataFlows: z.array(SafeTextSchema).max(100).default([]),
  authModel: z.array(SafeTextSchema).max(50).default([]),
  roleModel: z.array(SafeTextSchema).max(50).default([]),
  databaseBoundaries: z.array(SafeTextSchema).max(50).default([]),
  thirdPartyIntegrations: z.array(SafeTextSchema).max(50).default([]),
  externalApis: z.array(SafeTextSchema).max(50).default([]),
  uploads: z.array(SafeTextSchema).max(50).default([]),
  payments: z.array(SafeTextSchema).max(50).default([]),
  userGeneratedContent: z.array(SafeTextSchema).max(50).default([]),
  sensitiveDataClassification: z.array(SafeTextSchema).max(50).default([]),
  securityControls: z.array(SafeTextSchema).max(100).default([]),
}).strict();
export type ThreatModelInput = z.input<typeof ThreatModelInputSchema>;
export const ThreatModelResultSchema = z.object({
  architectureChecksum: HashSchema,
  baselineVersion: z.literal(SECURITY_BASELINE_VERSION),
  attackSurfaces: z.array(AttackSurfaceSchema).max(100),
  threats: z.array(SecurityThreatSchema).max(200),
  requiredControls: z.array(SecurityControlRequirementSchema).max(200),
  blockingThreats: z.array(SafeIdSchema).max(100),
  verdict: z.enum(["PASS", "WARN", "BLOCK"]),
}).strict();
export type ThreatModelResult = z.infer<typeof ThreatModelResultSchema>;

export const ArchitectureCriticFindingSchema = z.object({
  id: SafeIdSchema,
  category: z.enum(["TRUST_BOUNDARY", "COUPLING", "OWNERSHIP", "DATA_CONSISTENCY", "FAILURE_RECOVERY", "UNNECESSARY_COMPLEXITY", "SPECIALIST_HANDOFF"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  summary: SafeTextSchema,
  requiredAction: SafeTextSchema,
  evidenceRefs: z.array(SafeIdSchema).min(1).max(20),
}).strict();
export type ArchitectureCriticFinding = z.infer<typeof ArchitectureCriticFindingSchema>;
export const ArchitectureCriticResultSchema = z.object({
  architectureChecksum: HashSchema,
  findings: z.array(ArchitectureCriticFindingSchema).max(100),
  blockingFindings: z.array(SafeIdSchema).max(100),
  verdict: z.enum(["PASS", "WARN", "BLOCK"]),
}).strict().superRefine((result, context) => {
  const findingIds = new Set(result.findings.map((finding) => finding.id));
  if (findingIds.size !== result.findings.length) context.addIssue({ code: "custom", path: ["findings"], message: "Architecture critic finding IDs must be unique." });
  if (result.blockingFindings.some((id) => !findingIds.has(id))) context.addIssue({ code: "custom", path: ["blockingFindings"], message: "Blocking architecture critic findings must reference findings." });
  if ((result.verdict === "BLOCK") !== result.blockingFindings.length > 0) context.addIssue({ code: "custom", path: ["verdict"], message: "Architecture critic BLOCK must correspond to blocking findings." });
});
export type ArchitectureCriticResult = z.infer<typeof ArchitectureCriticResultSchema>;

const sourceHostAllowed = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return new URL(value).protocol === "https:" && ["gesetze-im-internet.de", "eur-lex.europa.eu", "bfdi.bund.de", "bmas.de", "bundesregierung.de", "bundesnetzagentur.de", "bundesfachstelle-barrierefreiheit.de", "commission.europa.eu", "ec.europa.eu"].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch { return false; }
};
export const GERMAN_PRIMARY_SOURCE_HOSTS = ["gesetze-im-internet.de", "eur-lex.europa.eu", "bfdi.bund.de", "bmas.de", "bundesregierung.de", "bundesnetzagentur.de", "bundesfachstelle-barrierefreiheit.de", "commission.europa.eu", "ec.europa.eu"] as const;
export const GermanLegalDomainSchema = z.enum(["DSGVO", "BDSG", "DDG", "TDDDG", "UWG", "VSBG", "BFSG", "BFSGV", "BGB", "EGBGB", "PAngV", "E_COMMERCE", "NEWSLETTER", "SECTOR_SPECIFIC"]);
export type GermanLegalDomain = z.infer<typeof GermanLegalDomainSchema>;
export const GermanLegalAuthoritySnapshotSchema = z.object({
  sourceId: SafeIdSchema,
  sourceUrl: z.string().url().refine(sourceHostAllowed, "Legal authority must be an approved primary source."),
  retrievedAt: IsoDateTimeSchema,
  legalVersion: SafeTextSchema,
  currentness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
  domains: z.array(GermanLegalDomainSchema).min(1).max(15),
  sourceChecksum: HashSchema,
}).strict();
export type GermanLegalAuthoritySnapshot = z.infer<typeof GermanLegalAuthoritySnapshotSchema>;

export const ConsentExecutionEvidenceSchema = z.object({
  required: z.boolean(),
  beforeConsentNonEssentialExecuted: z.boolean(),
  rejectNonEssentialExecuted: z.boolean(),
  acceptNonEssentialMayExecute: z.boolean(),
  withdrawStopsSubsequentProcessing: z.boolean(),
  evidenceRefs: z.array(SafeIdSchema).max(20),
}).strict();
export type ConsentExecutionEvidence = z.infer<typeof ConsentExecutionEvidenceSchema>;
export const PrivacyProcessingEntrySchema = z.object({
  name: SafeIdSchema,
  purpose: SafeTextSchema,
  category: z.enum(["STRICTLY_REQUIRED", "CONSENT_REQUIRED", "NEEDS_LEGAL_REVIEW"]),
  implementationRefs: z.array(SafeIdSchema).min(1).max(20),
  noticeRef: SafeIdSchema.optional(),
}).strict();
export type PrivacyProcessingEntry = z.infer<typeof PrivacyProcessingEntrySchema>;
export const GermanComplianceFindingSchema = z.object({
  id: SafeIdSchema,
  domain: GermanLegalDomainSchema,
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  code: SafeIdSchema,
  summary: SafeTextSchema,
  required: z.boolean(),
  status: z.enum(["OPEN", "USER_INPUT_REQUIRED", "LEGAL_REVIEW_REQUIRED", "IMPLEMENTATION_MISMATCH", "NOT_APPLICABLE"]),
  evidenceRefs: z.array(SafeIdSchema).max(20),
}).strict();
export type GermanComplianceFinding = z.infer<typeof GermanComplianceFindingSchema>;
export const GermanComplianceInputSchema = z.object({
  implementationChecksum: HashSchema,
  publicSite: z.boolean(),
  germanMarket: z.boolean(),
  commercial: z.boolean(),
  siteType: z.enum(["INFORMATIONAL", "CONTACT_FORM", "ECOMMERCE", "PRIVATE_DASHBOARD", "CONTENT"]),
  businessIdentityFactsComplete: z.boolean().default(false),
  hasImpressumSurface: z.boolean().default(false),
  hasPrivacySurface: z.boolean().default(false),
  processingInventory: z.array(PrivacyProcessingEntrySchema).max(100).default([]),
  consentExecution: ConsentExecutionEvidenceSchema.optional(),
  checkoutInformationComplete: z.boolean().default(false),
  newsletterPresent: z.boolean().default(false),
  newsletterConsentSeparated: z.boolean().default(false),
  vsbgApplicable: z.enum(["APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"]).default("UNKNOWN"),
  vsbgInformationPresent: z.boolean().default(false),
  bfsgStatus: z.enum(["APPLICABLE", "EXEMPT", "NOT_APPLICABLE", "UNKNOWN"]).default("UNKNOWN"),
  accessibilityEvidenceComplete: z.boolean().default(false),
  authoritySnapshots: z.array(GermanLegalAuthoritySnapshotSchema).min(1).max(20),
}).strict();
export type GermanComplianceInput = z.input<typeof GermanComplianceInputSchema>;
export const GermanComplianceResultSchema = z.object({
  implementationChecksum: HashSchema,
  authoritySourceIds: z.array(SafeIdSchema).min(1).max(20),
  authoritySnapshots: z.array(GermanLegalAuthoritySnapshotSchema).min(1).max(20),
  currentness: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
  applicableDomains: z.array(GermanLegalDomainSchema).max(20),
  processingInventory: z.array(PrivacyProcessingEntrySchema).max(100),
  findings: z.array(GermanComplianceFindingSchema).max(100),
  verdict: z.enum(["COMPLIANT_EVIDENCE_COMPLETE", "COMPLIANT_WITH_WARNINGS", "BLOCKED_MISSING_FACTS", "BLOCKED_IMPLEMENTATION", "LEGAL_REVIEW_REQUIRED", "NOT_APPLICABLE"]),
}).strict();
export type GermanComplianceResult = z.infer<typeof GermanComplianceResultSchema>;

export const ExploratoryScenarioSchema = z.object({
  scenarioId: SafeIdSchema,
  route: SafeRouteSchema,
  precondition: SafeTextSchema,
  steps: z.array(SafeTextSchema).min(1).max(30),
  expected: SafeTextSchema,
  actual: SafeTextSchema,
  safeEvidence: z.array(SafeIdSchema).min(1).max(20),
  status: z.enum(["PASS", "FAIL", "SKIPPED"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  blocking: z.boolean(),
}).strict();
export type ExploratoryScenario = z.infer<typeof ExploratoryScenarioSchema>;
export const ExploratoryScenarioRequestSchema = ExploratoryScenarioSchema.pick({ scenarioId: true, route: true, precondition: true, steps: true, expected: true, severity: true, blocking: true });
export type ExploratoryScenarioRequest = z.infer<typeof ExploratoryScenarioRequestSchema>;
export const ExploratoryQAEvidenceSchema = z.object({
  implementationChecksum: HashSchema,
  targetBoundary: z.enum(["LOCAL_TEST_APPLICATION", "DISPOSABLE_TEST_APPLICATION", "EXPLICIT_AUTHORIZED_STAGING"]),
  authorizationEvidence: SafeIdSchema.optional(),
  timeoutMs: z.number().int().positive().max(60_000),
  requestBudget: z.number().int().positive().max(100),
  nonDestructive: z.literal(true),
  scenarios: z.array(ExploratoryScenarioSchema).max(100),
  capturedAt: IsoDateTimeSchema,
}).strict().superRefine((evidence, context) => {
  if (evidence.scenarios.length > evidence.requestBudget) context.addIssue({ code: "custom", path: ["scenarios"], message: "Exploratory scenarios exceed the request budget." });
  if (evidence.targetBoundary === "EXPLICIT_AUTHORIZED_STAGING" && !evidence.authorizationEvidence) context.addIssue({ code: "custom", path: ["authorizationEvidence"], message: "Explicitly authorized staging requires bounded authorization evidence." });
});
export type ExploratoryQAEvidence = z.infer<typeof ExploratoryQAEvidenceSchema>;

export const SEOImplementationEvidenceSchema = z.object({
  implementationChecksum: HashSchema,
  activated: z.boolean(),
  publicSite: z.boolean(),
  indexableRoutes: z.array(SafeRouteSchema).max(100),
  noindexRoutes: z.array(SafeRouteSchema).max(100),
  crawlerBlockedRoutes: z.array(SafeRouteSchema).max(100).default([]),
  metaDescriptionRoutes: z.array(SafeRouteSchema).max(100).default([]),
  headingHierarchyRoutes: z.array(SafeRouteSchema).max(100).default([]),
  internalLinkRoutes: z.array(SafeRouteSchema).max(100).default([]),
  imageAltRoutes: z.array(SafeRouteSchema).max(100).default([]),
  canonicalRoutes: z.array(SafeRouteSchema).max(100),
  sitemapPresent: z.boolean(),
  robotsPolicyPresent: z.boolean(),
  structuredDataApplicable: z.boolean(),
  structuredDataPresent: z.boolean(),
  localBusinessApplicable: z.boolean(),
  localFactsAuthoritative: z.boolean(),
  searchEssentialsAligned: z.boolean(),
  noRankingGuarantees: z.boolean(),
  doorwayPagePattern: z.boolean(),
}).strict();
export type SEOImplementationEvidence = z.infer<typeof SEOImplementationEvidenceSchema>;

const includesAny = (text: string, values: readonly string[]) => values.some((value) => text.includes(value));
const controlId = (surface: string, value: string) => `${surface}-${value}`;
const control = (id: string, title: string, owner: SecurityControlRequirement["owner"], evidenceRefs: string[]): SecurityControlRequirement => ({ id, title, mandatory: true, owner, evidenceRefs });
const threat = (id: string, surfaceId: string, category: SecurityThreatCategory, severity: SecurityThreatSeverity, summary: string, requiredControlIds: string[], mitigated: boolean, evidenceRefs: string[]): SecurityThreat => ({ id, surfaceId, category, severity, summary, requiredControlIds, mitigated, evidenceRefs });

export function runSecurityThreatModel(raw: ThreatModelInput): ThreatModelResult {
  const input = ThreatModelInputSchema.parse(raw);
  const allText = [input.briefText, input.planningText, ...input.dataFlows, ...input.authModel, ...input.roleModel, ...input.databaseBoundaries, ...input.thirdPartyIntegrations, ...input.externalApis, ...input.uploads, ...input.payments, ...input.userGeneratedContent, ...input.sensitiveDataClassification, ...input.securityControls].join(" ").toLowerCase();
  const surfaces: AttackSurface[] = [];
  const threats: SecurityThreat[] = [];
  const requiredControls: SecurityControlRequirement[] = [];
  const addSurface = (surface: AttackSurface) => { if (!surfaces.some((item) => item.id === surface.id)) surfaces.push(surface); };
  const addControl = (item: SecurityControlRequirement) => { if (!requiredControls.some((current) => current.id === item.id)) requiredControls.push(item); };
  const evidenceRefs = [`architecture:${input.architectureChecksum.slice(0, 16)}`];
  if (input.authModel.length || includesAny(allText, ["authentication", "login", "session", "account"])) addSurface({ id: "surface-auth", kind: "AUTH", boundary: "Authentication and session boundary", exposure: "PUBLIC", sensitiveData: false, evidenceRefs });
  if (input.roleModel.length || includesAny(allText, ["authorization", "role", "permission", "rls", "owner isolation"])) addSurface({ id: "surface-authorization", kind: "AUTHORIZATION", boundary: "Role and object authorization boundary", exposure: "AUTHENTICATED", sensitiveData: true, evidenceRefs });
  if (input.databaseBoundaries.length || includesAny(allText, ["database", "supabase", "postgres", "schema", "rls"])) addSurface({ id: "surface-database", kind: "DATABASE", boundary: "Server-to-database access boundary", exposure: "AUTHENTICATED", sensitiveData: true, evidenceRefs });
  if (input.uploads.length || includesAny(allText, ["upload", "file", "storage"])) addSurface({ id: "surface-upload", kind: "UPLOAD", boundary: "File upload and storage boundary", exposure: "AUTHENTICATED", sensitiveData: true, evidenceRefs });
  if (input.externalApis.length || input.thirdPartyIntegrations.length || includesAny(allText, ["external api", "third-party", "webhook", "provider"])) addSurface({ id: "surface-external-api", kind: "EXTERNAL_API", boundary: "External integration trust boundary", exposure: "PUBLIC", sensitiveData: false, evidenceRefs });
  if (input.payments.length || includesAny(allText, ["payment", "checkout", "subscription"])) addSurface({ id: "surface-payment", kind: "PAYMENT", boundary: "Payment and checkout boundary", exposure: "AUTHENTICATED", sensitiveData: true, evidenceRefs });
  if (input.userGeneratedContent.length || includesAny(allText, ["user-generated", "comment", "rich text", "markdown"])) addSurface({ id: "surface-user-content", kind: "USER_CONTENT", boundary: "User-generated content rendering boundary", exposure: "AUTHENTICATED", sensitiveData: false, evidenceRefs });
  if (input.sensitiveDataClassification.length || includesAny(allText, ["personal data", "sensitive data", "health data", "financial data"])) addSurface({ id: "surface-sensitive-data", kind: "SENSITIVE_DATA", boundary: "Sensitive-data processing boundary", exposure: "AUTHENTICATED", sensitiveData: true, evidenceRefs });
  const controlText = input.securityControls.join(" ").toLowerCase();
  const hasControl = (...terms: string[]) => terms.some((term) => controlText.includes(term));
  const addThreat = (item: SecurityThreat, controls: SecurityControlRequirement[]) => { controls.forEach(addControl); threats.push(item); };
  for (const surface of surfaces) {
    if (surface.kind === "AUTH") {
      const controls = [control(controlId(surface.id, "authn"), "Strong authentication and session handling", "IMPLEMENTATION", evidenceRefs), control(controlId(surface.id, "session"), "Session invalidation and secure cookie behavior", "IMPLEMENTATION", evidenceRefs)];
      addThreat(threat("threat-authentication", surface.id, "AUTHENTICATION", "HIGH", "Authentication and session threats require explicit controls at the approved boundary.", controls.map((item) => item.id), hasControl("authentication", "session", "cookie"), evidenceRefs), controls);
    }
    if (surface.kind === "AUTHORIZATION") {
      const controls = [control(controlId(surface.id, "idor"), "Server-owned object and role authorization", "IMPLEMENTATION", evidenceRefs), control(controlId(surface.id, "isolation"), "Cross-user and tenant isolation", "DATABASE", evidenceRefs)];
      addThreat(threat("threat-authorization", surface.id, "AUTHORIZATION", "CRITICAL", "Authorization and IDOR threats must be enforced from trusted server and data boundaries.", controls.map((item) => item.id), hasControl("authorization", "role", "permission", "rls", "owner", "isolation"), evidenceRefs), controls);
    }
    if (surface.kind === "DATABASE") {
      const controls = [control(controlId(surface.id, "validation"), "Server-side input validation and parameterized access", "DATABASE", evidenceRefs), control(controlId(surface.id, "ownership"), "User-scoped data ownership policy", "DATABASE", evidenceRefs)];
      addThreat(threat("threat-database-access", surface.id, "SENSITIVE_DATA", "HIGH", "Database boundaries require validated, owner-scoped access and safe failure behavior.", controls.map((item) => item.id), hasControl("validation", "parameter", "rls", "owner", "prepared"), evidenceRefs), controls);
    }
    if (surface.kind === "UPLOAD") {
      const controls = [control(controlId(surface.id, "file-validation"), "File type, size, content, and storage validation", "IMPLEMENTATION", evidenceRefs)];
      addThreat(threat("threat-file-upload", surface.id, "UPLOAD", "HIGH", "Uploads require bounded validation and non-executable storage behavior.", controls.map((item) => item.id), hasControl("upload", "file type", "mime", "size", "storage"), evidenceRefs), controls);
    }
    if (surface.kind === "EXTERNAL_API" || surface.kind === "PAYMENT") {
      const controls = [control(controlId(surface.id, "integration"), "Allowlisted, authenticated, timeout-bounded integration", "IMPLEMENTATION", evidenceRefs)];
      addThreat(threat(`threat-${surface.kind.toLowerCase()}`, surface.id, "THIRD_PARTY", "HIGH", "External integrations require explicit trust, timeout, validation, and secret boundaries.", controls.map((item) => item.id), hasControl("allowlist", "timeout", "webhook", "secret", "validation"), evidenceRefs), controls);
    }
    if (surface.kind === "USER_CONTENT") {
      const controls = [control(controlId(surface.id, "output-encoding"), "Safe output encoding and sanitization", "IMPLEMENTATION", evidenceRefs)];
      addThreat(threat("threat-user-content-xss", surface.id, "XSS", "HIGH", "User-generated content must not reach unsafe HTML or script execution paths.", controls.map((item) => item.id), hasControl("sanitize", "escape", "xss", "encoding"), evidenceRefs), controls);
    }
    if (surface.kind === "SENSITIVE_DATA") {
      const controls = [control(controlId(surface.id, "data-minimization"), "Data minimization, redaction, and safe error/log boundaries", "IMPLEMENTATION", evidenceRefs)];
      addThreat(threat("threat-sensitive-data", surface.id, "SENSITIVE_DATA", "HIGH", "Sensitive data requires minimization and safe handling across responses, logs, and integrations.", controls.map((item) => item.id), hasControl("minimization", "redact", "redaction", "safe log", "privacy"), evidenceRefs), controls);
    }
  }
  const surface = (kind: AttackSurface["kind"]) => surfaces.find((item) => item.kind === kind);
  const addContextThreat = (item: SecurityThreat, controls: SecurityControlRequirement[]) => addThreat(item, controls);
  const authSurface = surface("AUTH");
  if (authSurface && includesAny(allText, ["form", "mutation", "server action", "state-changing", "csrf"])) {
    const controls = [control("surface-auth-csrf-protection", "CSRF protection for state-changing browser actions", "IMPLEMENTATION", evidenceRefs)];
    addContextThreat(threat("threat-csrf", authSurface.id, "CSRF", "HIGH", "State-changing authenticated browser actions require a CSRF defense or an equivalent same-site request boundary.", controls.map((item) => item.id), hasControl("csrf", "same-site", "origin"), evidenceRefs), controls);
  }
  const externalSurface = surface("EXTERNAL_API");
  if (externalSurface && includesAny(allText, ["user-supplied url", "user supplied url", "fetch url", "url fetch", "proxy url", "callback url", "destination url"])) {
    const controls = [control("surface-external-api-ssrf", "Allowlist and validate user-influenced outbound destinations", "IMPLEMENTATION", evidenceRefs)];
    addContextThreat(threat("threat-ssrf", externalSurface.id, "SSRF", "HIGH", "User-influenced outbound requests require destination validation and an explicit network allowlist.", controls.map((item) => item.id), hasControl("ssrf", "outbound allowlist", "destination allowlist", "url validation"), evidenceRefs), controls);
  }
  const injectionSurface = surface("DATABASE") ?? surface("EXTERNAL_API") ?? surface("USER_CONTENT");
  if (injectionSurface && includesAny(allText, ["query", "search", "filter", "sql", "user input", "untrusted input", "injection"])) {
    const controls = [control(`${injectionSurface.id}-injection`, "Context-aware validation and parameterized output/input handling", "IMPLEMENTATION", evidenceRefs)];
    addContextThreat(threat("threat-injection", injectionSurface.id, "INJECTION", "HIGH", "Untrusted input reaches a query, filter, integration, or rendering boundary and requires context-aware handling.", controls.map((item) => item.id), hasControl("parameter", "validation", "sanitize", "escape", "encode"), evidenceRefs), controls);
  }
  const cryptographicSurface = surface("SENSITIVE_DATA") ?? surface("AUTH") ?? surface("PAYMENT");
  if (cryptographicSurface && includesAny(allText, ["password", "token", "encryption", "encrypt", "cryptograph", "hash", "secret"])) {
    const controls = [control(`${cryptographicSurface.id}-cryptography`, "Approved cryptography and secret lifecycle handling", "IMPLEMENTATION", evidenceRefs)];
    addContextThreat(threat("threat-cryptography", cryptographicSurface.id, "CRYPTOGRAPHY", "HIGH", "Credential, token, or sensitive-data handling requires approved cryptography and secret lifecycle controls.", controls.map((item) => item.id), hasControl("cryptograph", "encryption", "hash", "secret", "key management"), evidenceRefs), controls);
  }
  const abuseSurface = surface("AUTH") ?? surface("EXTERNAL_API") ?? surface("PAYMENT");
  if (abuseSurface && includesAny(allText, ["login", "contact form", "public endpoint", "repeated", "rate limit", "brute force"])) {
    const controls = [control(`${abuseSurface.id}-abuse-rate-limit`, "Abuse controls and bounded rate limiting where required", "OPERATIONS", evidenceRefs)];
    addContextThreat(threat("threat-abuse-rate-limit", abuseSurface.id, "ABUSE_RATE_LIMIT", "MEDIUM", "Public or repeatable operations require abuse controls proportionate to the approved capability.", controls.map((item) => item.id), hasControl("rate limit", "throttl", "abuse", "brute force", "captcha"), evidenceRefs), controls);
  }
  const monitoringSurface = surface("AUTH") ?? surface("DATABASE") ?? surface("SENSITIVE_DATA") ?? surface("EXTERNAL_API");
  if (monitoringSurface && includesAny(allText, ["log", "error", "exception", "monitor", "alert", "audit"])) {
    const controls = [control(`${monitoringSurface.id}-monitoring`, "Redacted security logging, monitoring, and alerting", "OPERATIONS", evidenceRefs)];
    addContextThreat(threat("threat-monitoring", monitoringSurface.id, "MONITORING", "MEDIUM", "Security-relevant failures require redacted logging and an appropriate monitoring or alerting boundary.", controls.map((item) => item.id), hasControl("redact", "logging", "monitor", "alert", "audit"), evidenceRefs), controls);
  }
  const supplyChainSurface = surface("THIRD_PARTY") ?? surface("EXTERNAL_API");
  if (supplyChainSurface && input.thirdPartyIntegrations.length > 0) {
    const controls = [control(`${supplyChainSurface.id}-supply-chain`, "Authorized dependency provenance and integrity evidence", "IMPLEMENTATION", evidenceRefs)];
    addContextThreat(threat("threat-supply-chain", supplyChainSurface.id, "SUPPLY_CHAIN", "HIGH", "Third-party and dependency boundaries require authorized provenance, integrity, and lifecycle evidence.", controls.map((item) => item.id), hasControl("integrity", "provenance", "dependency", "lockfile", "allowlist"), evidenceRefs), controls);
  }
  if (includesAny(allText, ["missing-auth", "unmitigated", "authorization bypass", "idor", "secret exposure"])) for (const item of threats) if (!item.mitigated) item.severity = item.severity === "MEDIUM" ? "HIGH" : item.severity;
  const blockingThreats = threats.filter((item) => !item.mitigated && ["HIGH", "CRITICAL"].includes(item.severity)).map((item) => item.id);
  return ThreatModelResultSchema.parse({ architectureChecksum: input.architectureChecksum, baselineVersion: SECURITY_BASELINE_VERSION, attackSurfaces: surfaces, threats, requiredControls, blockingThreats, verdict: blockingThreats.length ? "BLOCK" : threats.length ? "WARN" : "PASS" });
}

export function evaluateGermanCompliance(raw: GermanComplianceInput): GermanComplianceResult {
  const input = GermanComplianceInputSchema.parse(raw);
  const snapshots = input.authoritySnapshots;
  const currentness = snapshots.some((snapshot) => snapshot.currentness === "STALE") ? "STALE" : snapshots.some((snapshot) => snapshot.currentness === "UNKNOWN") ? "UNKNOWN" : "CURRENT";
  const applicableDomains: GermanLegalDomain[] = [];
  const findings: GermanComplianceFinding[] = [];
  const add = (item: GermanComplianceFinding) => findings.push(item);
  const refs = snapshots.map((snapshot) => snapshot.sourceId);
  if (!input.publicSite || !input.germanMarket) return GermanComplianceResultSchema.parse({ implementationChecksum: input.implementationChecksum, authoritySourceIds: refs, authoritySnapshots: snapshots, currentness, applicableDomains, processingInventory: input.processingInventory, findings: [], verdict: "NOT_APPLICABLE" });
  const commercialPublic = input.publicSite && input.commercial && input.siteType !== "PRIVATE_DASHBOARD";
  if (commercialPublic) {
    applicableDomains.push("DDG");
    if (!input.hasImpressumSurface) add({ id: "compliance-impressum-missing", domain: "DDG", severity: "BLOCKING", code: "IMPRINT_SURFACE_MISSING", summary: "A recognizable, directly reachable provider-identification surface is missing.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: refs });
    else if (!input.businessIdentityFactsComplete) add({ id: "compliance-impressum-facts", domain: "DDG", severity: "BLOCKING", code: "IMPRINT_FACTS_MISSING", summary: "Required business-identification facts are missing and must be supplied by the user.", required: true, status: "USER_INPUT_REQUIRED", evidenceRefs: refs });
  }
  const privacyRequired = input.processingInventory.length > 0 || input.publicSite;
  if (privacyRequired) {
    applicableDomains.push("DSGVO", "BDSG");
    if (!input.hasPrivacySurface) add({ id: "compliance-privacy-missing", domain: "DSGVO", severity: "BLOCKING", code: "PRIVACY_SURFACE_MISSING", summary: "The implementation has a privacy-relevant surface but no matching privacy disclosure is evidenced.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: refs });
    if (input.siteType === "CONTACT_FORM" && input.processingInventory.length === 0) add({ id: "compliance-contact-processing-inventory", domain: "DSGVO", severity: "BLOCKING", code: "CONTACT_PROCESSING_INVENTORY_MISSING", summary: "A contact form is present but its actual processing activity is not represented in the implementation-derived inventory.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: refs });
    if (input.processingInventory.some((entry) => entry.category === "NEEDS_LEGAL_REVIEW" || !entry.noticeRef)) add({ id: "compliance-privacy-inventory", domain: "DSGVO", severity: "BLOCKING", code: "PRIVACY_INVENTORY_INCOMPLETE", summary: "Implementation-derived processing inventory contains an unreviewed or unmapped processing activity.", required: true, status: "LEGAL_REVIEW_REQUIRED", evidenceRefs: refs });
  }
  const consentRequired = input.processingInventory.some((entry) => entry.category === "CONSENT_REQUIRED");
  if (consentRequired) {
    applicableDomains.push("TDDDG");
    const consent = input.consentExecution;
    if (!consent || consent.beforeConsentNonEssentialExecuted || consent.rejectNonEssentialExecuted || !consent.acceptNonEssentialMayExecute || !consent.withdrawStopsSubsequentProcessing) add({ id: "compliance-consent-gate", domain: "TDDDG", severity: "BLOCKING", code: "CONSENT_EXECUTION_MISMATCH", summary: "Consent evidence does not prove that non-essential technology is gated before consent, rejection, and withdrawal.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: consent?.evidenceRefs ?? refs });
  }
  if (input.siteType === "ECOMMERCE") {
    applicableDomains.push("BGB", "EGBGB", "PAngV", "E_COMMERCE", "VSBG");
    if (!input.checkoutInformationComplete) add({ id: "compliance-checkout-information", domain: "E_COMMERCE", severity: "BLOCKING", code: "CHECKOUT_INFORMATION_INCOMPLETE", summary: "Checkout evidence does not cover the required capability-specific consumer information.", required: true, status: "USER_INPUT_REQUIRED", evidenceRefs: refs });
  }
  if (input.newsletterPresent) {
    applicableDomains.push("UWG", "NEWSLETTER");
    if (!input.newsletterConsentSeparated) add({ id: "compliance-newsletter-consent", domain: "UWG", severity: "BLOCKING", code: "NEWSLETTER_CONSENT_NOT_SEPARATE", summary: "Marketing consent is not evidenced as separate from unrelated form submission.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: refs });
  }
  if (input.vsbgApplicable === "APPLICABLE") {
    if (!applicableDomains.includes("VSBG")) applicableDomains.push("VSBG");
    if (!input.vsbgInformationPresent) add({ id: "compliance-vsbg-information", domain: "VSBG", severity: "BLOCKING", code: "VSBG_INFORMATION_MISSING", summary: "Current dispute-information applicability requires an evidenced surface or professional review.", required: true, status: "LEGAL_REVIEW_REQUIRED", evidenceRefs: refs });
  } else if (input.vsbgApplicable === "UNKNOWN") add({ id: "compliance-vsbg-applicability", domain: "VSBG", severity: "WARNING", code: "VSBG_APPLICABILITY_UNKNOWN", summary: "VSBG applicability depends on current business facts and is not asserted automatically.", required: false, status: "LEGAL_REVIEW_REQUIRED", evidenceRefs: refs });
  if (input.bfsgStatus === "APPLICABLE") {
    applicableDomains.push("BFSG", "BFSGV");
    if (!input.accessibilityEvidenceComplete) add({ id: "compliance-bfsg-evidence", domain: "BFSG", severity: "BLOCKING", code: "BFSG_TECHNICAL_EVIDENCE_MISSING", summary: "BFSG applicability is asserted but technical accessibility evidence is incomplete.", required: true, status: "IMPLEMENTATION_MISMATCH", evidenceRefs: refs });
  } else if (input.bfsgStatus === "UNKNOWN" && input.siteType === "ECOMMERCE") add({ id: "compliance-bfsg-applicability", domain: "BFSG", severity: "WARNING", code: "BFSG_APPLICABILITY_REVIEW", summary: "BFSG applicability requires current service, business, and exemption facts; it is not assumed from commerce alone.", required: false, status: "LEGAL_REVIEW_REQUIRED", evidenceRefs: refs });
  if (currentness !== "CURRENT") add({ id: "compliance-authority-currentness", domain: "DSGVO", severity: "BLOCKING", code: "LEGAL_AUTHORITY_STALE", summary: "Current primary-source legal evidence is unavailable or stale for this compliance cycle.", required: true, status: "LEGAL_REVIEW_REQUIRED", evidenceRefs: refs });
  const blocking = findings.some((finding) => finding.severity === "BLOCKING");
  const missingFacts = findings.some((finding) => finding.status === "USER_INPUT_REQUIRED");
  const legalReview = findings.some((finding) => finding.status === "LEGAL_REVIEW_REQUIRED");
  const warnings = findings.some((finding) => finding.severity === "WARNING");
  const verdict = missingFacts ? "BLOCKED_MISSING_FACTS" : legalReview ? "LEGAL_REVIEW_REQUIRED" : blocking ? "BLOCKED_IMPLEMENTATION" : warnings ? "COMPLIANT_WITH_WARNINGS" : "COMPLIANT_EVIDENCE_COMPLETE";
  return GermanComplianceResultSchema.parse({ implementationChecksum: input.implementationChecksum, authoritySourceIds: refs, authoritySnapshots: snapshots, currentness, applicableDomains: [...new Set(applicableDomains)], processingInventory: input.processingInventory, findings, verdict });
}

export const SecurityProbeEvidenceSchema = z.object({
  probeId: SafeIdSchema,
  kind: z.enum(["PROTECTED_ROUTE", "HORIZONTAL_AUTHORIZATION", "VERTICAL_AUTHORIZATION", "OBJECT_ID", "ROLE_SPOOF", "MALFORMED_INPUT", "XSS", "UNSAFE_REDIRECT", "SECURITY_HEADERS", "COOKIE_FLAGS", "ERROR_LEAKAGE", "SENSITIVE_FIELDS", "RATE_CONTROL"]),
  route: SafeRouteSchema,
  expected: SafeTextSchema,
  actual: SafeTextSchema,
  status: z.enum(["PASS", "FAIL", "SKIPPED"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  safeEvidence: z.array(SafeIdSchema).min(1).max(20),
}).strict();
export type SecurityProbeEvidence = z.infer<typeof SecurityProbeEvidenceSchema>;
export const SecurityProbeRequestSchema = SecurityProbeEvidenceSchema.pick({ probeId: true, kind: true, route: true, expected: true, severity: true });
export type SecurityProbeRequest = z.infer<typeof SecurityProbeRequestSchema>;
export const SecurityTestEvidenceSchema = z.object({
  implementationChecksum: HashSchema,
  targetBoundary: z.enum(["LOCAL_TEST_APPLICATION", "DISPOSABLE_TEST_APPLICATION", "EXPLICIT_AUTHORIZED_STAGING"]),
  authorizationEvidence: SafeIdSchema.optional(),
  timeoutMs: z.number().int().positive().max(60_000),
  requestBudget: z.number().int().positive().max(100),
  nonDestructive: z.literal(true),
  probes: z.array(SecurityProbeEvidenceSchema).max(100),
  capturedAt: IsoDateTimeSchema,
}).strict().superRefine((evidence, context) => {
  if (evidence.probes.length > evidence.requestBudget) context.addIssue({ code: "custom", path: ["probes"], message: "Security probes exceed the request budget." });
  if (evidence.targetBoundary === "EXPLICIT_AUTHORIZED_STAGING" && !evidence.authorizationEvidence) context.addIssue({ code: "custom", path: ["authorizationEvidence"], message: "Explicitly authorized staging requires bounded authorization evidence." });
});
export type SecurityTestEvidence = z.infer<typeof SecurityTestEvidenceSchema>;
