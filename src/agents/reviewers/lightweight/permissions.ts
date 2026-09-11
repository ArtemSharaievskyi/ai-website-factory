import { ReviewAgentIdSchema } from "@/domain/review/lightweight";

export const DOCUMENTATION_WRITE_SCOPES = ["README.md", "docs/**", ".env.example"] as const;
export type ReviewMutationOperation = "SOURCE_WRITE" | "CANONICAL_WRITE";
export type ReviewMutationDecision = { allowed: boolean; code: "ALLOWED" | "REVIEW_MUTATION_DENIED"; agent: string; operation: ReviewMutationOperation; path: string; reason: string };

export class ReviewMutationDeniedError extends Error {
  readonly code = "REVIEW_MUTATION_DENIED" as const;
  constructor(message = "Review agents cannot mutate the requested source or canonical artifact.") { super(message); this.name = "ReviewMutationDeniedError"; }
}

const normalized = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
function documentationPathAllowed(value: string) {
  const candidate = normalized(value);
  if (!candidate || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate) || candidate.split("/").includes("..")) return false;
  return candidate === "README.md" || candidate === ".env.example" || candidate === "docs" || candidate.startsWith("docs/");
}

export function reviewMutationDecision(input: { agent: string; operation: ReviewMutationOperation; path: string; documentationWriteAuthorized?: boolean }): ReviewMutationDecision {
  const agent = ReviewAgentIdSchema.parse(input.agent);
  const candidate = normalized(input.path);
  if (input.operation === "SOURCE_WRITE" && agent === "documentation" && input.documentationWriteAuthorized === true && documentationPathAllowed(candidate)) return { allowed: true, code: "ALLOWED", agent, operation: input.operation, path: candidate, reason: "DocumentationAgent is limited to the explicitly authorized documentation scope." };
  return { allowed: false, code: "REVIEW_MUTATION_DENIED", agent, operation: input.operation, path: candidate, reason: input.operation === "CANONICAL_WRITE" ? "Review mutation denied: reviewers never own canonical writes." : "Review mutation denied: only explicitly authorized DocumentationAgent documentation paths may be written." };
}

export function assertReviewMutationAllowed(input: Parameters<typeof reviewMutationDecision>[0]) {
  const decision = reviewMutationDecision(input);
  if (!decision.allowed) throw new ReviewMutationDeniedError(decision.reason);
  return decision;
}

export function isDocumentationPath(value: string) {
  return documentationPathAllowed(normalized(value));
}
