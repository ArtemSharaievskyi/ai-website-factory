import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkbenchGenerateDesignRequest,
} from "@/runtime/workbench/contracts";
import {
  createSerializedWorkbenchRequest,
  postWorkbenchRequest,
} from "@/runtime/workbench/http-client";

const projectId = "11111111-1111-4111-8111-111111111111";
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("Workbench HTTP request boundary", () => {
  it("serializes and validates the same strict Design bytes sent to a local endpoint", async () => {
    const request = createWorkbenchGenerateDesignRequest(projectId);
    const envelope = await createSerializedWorkbenchRequest(request);
    const received = new Promise<{
      method?: string;
      contentType?: string;
      clientBodyBytes?: string;
      clientBodySha256?: string;
      clientTopLevelFields?: string;
      body: string;
    }>((resolve) => {
      const server = createServer((incoming, response) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          resolve({
            method: incoming.method,
            contentType: incoming.headers["content-type"],
            clientBodyBytes: typeof incoming.headers["x-workbench-client-body-bytes"] === "string" ? incoming.headers["x-workbench-client-body-bytes"] : undefined,
            clientBodySha256: typeof incoming.headers["x-workbench-client-body-sha256"] === "string" ? incoming.headers["x-workbench-client-body-sha256"] : undefined,
            clientTopLevelFields: typeof incoming.headers["x-workbench-client-top-level-fields"] === "string" ? incoming.headers["x-workbench-client-top-level-fields"] : undefined,
            body: Buffer.concat(chunks).toString("utf8"),
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        });
      });
      servers.push(server);
      server.listen(0, "127.0.0.1");
    });

    const server = servers[0];
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic server did not bind.");

    const response = await postWorkbenchRequest(
      request,
      fetch,
      `http://127.0.0.1:${address.port}/api/workbench`,
    );
    const captured = await received;

    expect(response.status).toBe(200);
    expect(envelope.method).toBe("POST");
    expect(envelope.headers["content-type"]).toBe("application/json");
    expect(captured.method).toBe(envelope.method);
    expect(captured.contentType).toMatch(/^application\/json(?:;|$)/);
    expect(captured.body).toBe(envelope.body);
    expect(captured.clientBodyBytes).toBe(String(Buffer.byteLength(envelope.body, "utf8")));
    expect(captured.clientBodySha256).toBe(createHash("sha256").update(envelope.body, "utf8").digest("hex"));
    expect(captured.clientTopLevelFields).toBe("action,projectId");
    expect(JSON.parse(captured.body)).toEqual(request);
  });
});
