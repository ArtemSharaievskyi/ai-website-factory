import { randomUUID } from "node:crypto";
import type { WorkflowEvent } from "./types";

export const newWorkflowEvent = (
  projectId: string,
  projectVersion: number,
  fromState: WorkflowEvent["fromState"],
  toState: WorkflowEvent["toState"],
  actor: string,
  reason: string,
  idempotencyKey?: string,
  revisionAttemptId?: string,
): WorkflowEvent => ({
  id: randomUUID(),
  projectId,
  projectVersion,
  fromState,
  toState,
  actor,
  reason,
  createdAt: new Date().toISOString(),
  ...(idempotencyKey ? { idempotencyKey } : {}),
  ...(revisionAttemptId ? { revisionAttemptId } : {}),
});
