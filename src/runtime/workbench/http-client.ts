import { WorkbenchRequestSchema } from "@/runtime/workbench/contracts";
import type { WorkbenchRequest } from "@/runtime/workbench/contracts";

export type SerializedWorkbenchRequest = {
  method: "POST";
  headers: { "content-type": "application/json" };
  body: string;
};

/**
 * Build the exact HTTP envelope used by the Workbench client.
 *
 * The request is validated before serialization and the bytes that will be
 * sent are parsed and validated again. This keeps browser and standalone
 * callers on the same strict production contract.
 */
export const createSerializedWorkbenchRequest = (
  input: WorkbenchRequest,
): SerializedWorkbenchRequest => {
  const request = WorkbenchRequestSchema.parse(input);
  const body = JSON.stringify(request);

  WorkbenchRequestSchema.parse(JSON.parse(body) as unknown);

  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
};

export type WorkbenchRequestFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const postWorkbenchRequest = (
  input: WorkbenchRequest,
  fetcher: WorkbenchRequestFetcher = fetch,
  endpoint = "/api/workbench",
) => fetcher(endpoint, createSerializedWorkbenchRequest(input));
