import type { Context7Config } from "./config";
import type { Context7Transport } from "./contracts";
import { Context7Error } from "./errors";

const DEFAULT_MAX_RESPONSE_BYTES = 200_000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRecord = Record<string, unknown>;
export type Context7McpTransportOptions = Pick<Context7Config, "endpoint" | "apiKey"> & {
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
};

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes)
      throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 response exceeded the bounded transport limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 response exceeded the bounded transport limit.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function parseResponseBody(raw: string, contentType: string | null): unknown {
  const parseJson = () => {
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 returned invalid JSON.", error);
    }
  };
  if (contentType?.includes("application/json")) return parseJson();
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  try {
    return JSON.parse(data.at(-1) ?? raw) as unknown;
  } catch (error) {
    throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 returned an invalid event-stream response.", error);
  }
}

function textFromToolResult(value: unknown): string {
  const root = record(value);
  const result = record(root?.result) ?? root;
  if (record(result)?.isError === true)
    throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 rejected the read-only tool request.");
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((entry) => record(entry)?.text)
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n")
    .trim();
  if (!text) throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 returned no tool text.");
  return text;
}

function libraryCandidates(text: string) {
  return [...text.matchAll(/Context7-compatible library ID:\s*(\/[^\s]+)/gi)]
    .map((match) => match[1].replace(/[),.;]+$/, ""));
}

function selectLibraryId(text: string, requestedVersion?: string) {
  const candidates = libraryCandidates(text);
  const version = requestedVersion?.replace(/^v/i, "");
  return candidates.find((candidate) => version && candidate.endsWith(`/v${version}`)) ?? candidates[0];
}

function truncateUtf8(text: string, maxBytes: number) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const bounded = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  return bounded.endsWith("\uFFFD") ? bounded.slice(0, -1) : bounded;
}

function sourceReference(text: string, libraryId: string) {
  return text.match(/(?:Source|source):\s*(https?:\/\/\S+)/)?.[1]?.replace(/[),.;]+$/, "")
    ?? `https://context7.com${libraryId}`;
}

function documentedVersion(source: string) {
  return source.match(/\/blob\/([^/]+)\//)?.[1];
}

export function createContext7McpTransport(options: Context7McpTransportOptions): Context7Transport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let requestId = 0;
  const call = async (name: string, args: JsonRecord, signal: AbortSignal) => {
    const response = await fetchImpl(options.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal,
    });
    const raw = await readBoundedText(response, maxResponseBytes);
    if (!response.ok) {
      if (response.status === 429)
        throw new Context7Error("CONTEXT7_RATE_LIMITED", "Context7 rate-limited the read-only request.");
      throw new Context7Error("CONTEXT7_UNAVAILABLE", `Context7 request failed with status ${response.status}.`);
    }
    return parseResponseBody(raw, response.headers.get("content-type"));
  };

  return async ({ libraryId, packageName, version, topic, symbol, maxBytes, signal }) => {
    if (signal.aborted) throw new Context7Error("CONTEXT7_CANCELLED", "Context7 request was cancelled.");
    const resolvedText = libraryId.startsWith("/")
      ? ""
      : textFromToolResult(await call(
          "resolve-library-id",
          {
            libraryName: packageName,
            query: `${packageName}${version ? ` ${version}` : ""} ${topic}`,
          },
          signal,
        ));
    const resolvedLibraryId = libraryId.startsWith("/") ? libraryId : selectLibraryId(resolvedText, version);
    if (!resolvedLibraryId)
      throw new Context7Error("CONTEXT7_LIBRARY_RESOLUTION_FAILED", "Context7 did not return a compatible library ID.");
    const query = `${version ? `${packageName} ${version}: ` : ""}${topic}${symbol ? ` (${symbol})` : ""}`;
    const docsText = textFromToolResult(await call(
      "query-docs",
      { libraryId: resolvedLibraryId, query },
      signal,
    ));
    const source = sourceReference(docsText, resolvedLibraryId);
    const content = truncateUtf8(docsText, maxBytes ?? 12_000);
    if (!content.trim()) throw new Context7Error("CONTEXT7_UNAVAILABLE", "Context7 returned empty documentation.");
    return JSON.stringify([{
      title: `${packageName} documentation`,
      content,
      sourceReference: source,
      documentedVersion: documentedVersion(source),
      relevanceReason: `Live Context7 documentation matched the narrow topic: ${topic}.`,
    }]);
  };
}
