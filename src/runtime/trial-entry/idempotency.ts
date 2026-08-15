import type { ClarificationSession } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";

export const ANSWER_CLARIFICATIONS_OPERATION = "trial-entry:answer-lead-clarifications:v2";
export const REQUEST_BRIEF_CHANGES_OPERATION = "trial-entry:request-brief-changes:v2";

export type ClarificationAnswerRequest = {
  questionId: string;
  status?: "answered" | "not-applicable" | "deferred" | "unresolved";
  answer?: string;
};

/**
 * The browser may submit answers in any order and may omit the default status.
 * Only canonical mutation fields participate in the semantic request hash.
 */
export const normalizeClarificationAnswers = (answers: readonly ClarificationAnswerRequest[]) =>
  answers
    .map((answer) => ({
      questionId: answer.questionId,
      status: answer.status ?? "answered",
      answer: answer.answer ?? "",
    }))
    .sort((left, right) => left.questionId.localeCompare(right.questionId));

export const clarificationAnswerPayload = (input: {
  projectId: string;
  projectVersion: number;
  answers: readonly ClarificationAnswerRequest[];
}) => {
  const answers = normalizeClarificationAnswers(input.answers);
  return {
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    questionIds: answers.map((answer) => answer.questionId),
    answers,
  };
};

/**
 * The key identifies the answer round, not the answer text. The payload hash
 * still makes competing content for one round a conflict in the repository.
 */
export const clarificationRoundFingerprint = (input: {
  projectId: string;
  projectVersion: number;
  questionIds: readonly string[];
}) => checksumPersistedDocument({
  operation: ANSWER_CLARIFICATIONS_OPERATION,
  projectId: input.projectId,
  projectVersion: input.projectVersion,
  questionIds: [...input.questionIds].sort(),
});

export const clarificationAnswerOperationKey = (input: {
  projectId: string;
  projectVersion: number;
  answers: readonly ClarificationAnswerRequest[];
}) => {
  const payload = clarificationAnswerPayload(input);
  const fingerprint = clarificationRoundFingerprint({
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    questionIds: payload.questionIds,
  });
  return {
    key: `answer-clarifications:v2:${input.projectId}:${fingerprint}`,
    fingerprint,
    payload,
  };
};

export const briefRevisionOperationKey = (input: {
  projectId: string;
  projectVersion: number;
  briefChecksum: string;
  reason: string;
  requirementKeys: readonly string[];
}) => {
  const payload = {
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    briefChecksum: input.briefChecksum,
    reason: input.reason,
    requirementKeys: [...input.requirementKeys].sort(),
  };
  const fingerprint = checksumPersistedDocument({
    operation: REQUEST_BRIEF_CHANGES_OPERATION,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    briefChecksum: input.briefChecksum,
    requirementKeys: payload.requirementKeys,
  });
  return { key: `brief-revision:v2:${input.projectId}:${fingerprint}`, fingerprint, payload };
};

export const unresolvedQuestionIds = (session: ClarificationSession) =>
  session.questions
    .filter((question) => question.answerStatus === "unresolved")
    .map((question) => question.id)
    .sort();
