import { WorkbenchRequestSchema } from "@/runtime/workbench/contracts";
import type { WorkbenchRequest } from "@/runtime/workbench/contracts";

export type SerializedWorkbenchRequest = {
  method: "POST";
  headers: {
    "content-type": "application/json";
    "x-workbench-client-body-bytes": string;
    "x-workbench-client-body-sha256": string;
    "x-workbench-client-top-level-fields": string;
  };
  body: string;
};

const sha256Hex = async (value: string) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * Build the exact HTTP envelope used by the Workbench client.
 *
 * The request is validated before serialization and the bytes that will be
 * sent are parsed and validated again. This keeps browser and standalone
 * callers on the same strict production contract.
 */
export const createSerializedWorkbenchRequest = async (
  input: WorkbenchRequest,
): Promise<SerializedWorkbenchRequest> => {
  const request = WorkbenchRequestSchema.parse(input);
  const body = JSON.stringify(request);

  WorkbenchRequestSchema.parse(JSON.parse(body) as unknown);

  const bodySha256 = await sha256Hex(body);
  const bodyBytes = new TextEncoder().encode(body).byteLength;

  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workbench-client-body-bytes": String(bodyBytes),
      "x-workbench-client-body-sha256": bodySha256,
      "x-workbench-client-top-level-fields": Object.keys(request).sort().join(","),
    },
    body,
  };
};

export type WorkbenchRequestFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const postWorkbenchRequest = async (
  input: WorkbenchRequest,
  fetcher: WorkbenchRequestFetcher = fetch,
  endpoint = "/api/workbench",
) => fetcher(endpoint, await createSerializedWorkbenchRequest(input));
