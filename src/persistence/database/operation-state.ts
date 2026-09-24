import type { OperationStatus } from "./types";

export const MAX_OPERATION_HISTORY = 8;

export type OperationHistoryEntry = {
  status: Exclude<OperationStatus, "IN_PROGRESS">;
  result?: unknown;
  recordedAt: string;
};

export type StoredOperationState = {
  status?: string;
  result?: unknown;
  history?: OperationHistoryEntry[];
};

function terminalHistory(state: StoredOperationState, recordedAt: string) {
  if (state.status !== "FAILED" && state.status !== "SUCCEEDED") return state.history ?? [];
  const status = state.status as Exclude<OperationStatus, "IN_PROGRESS">;
  return [
    ...(state.history ?? []),
    {
      status,
      ...(state.result === undefined ? {} : { result: state.result }),
      recordedAt,
    },
  ].slice(-MAX_OPERATION_HISTORY);
}

export function nextOperationState(input: { previous: StoredOperationState; status: OperationStatus; result?: unknown; now?: string }): StoredOperationState {
  const history = terminalHistory(input.previous, input.now ?? new Date().toISOString());
  return {
    status: input.status,
    ...(input.result === undefined ? {} : { result: input.result }),
    ...(history.length ? { history } : {}),
  };
}

export function operationHistory(state: StoredOperationState | undefined) {
  return state?.history?.slice(-MAX_OPERATION_HISTORY) ?? [];
}
