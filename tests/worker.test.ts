import { describe, expect, it } from "vitest";
import worker, { mcpApiHandler } from "../apps/cloudflare/src/index.js";

const context = {
  waitUntil() {},
  passThroughOnException() {},
  props: {}
} as unknown as ExecutionContext;

type WorkerRequest = Parameters<typeof worker.fetch>[0];
type WorkerEnv = Parameters<typeof worker.fetch>[1];

function testEnv(values: Partial<WorkerEnv> = {}): WorkerEnv {
  return values as WorkerEnv;
}

function fetchWorker(request: Request, env = testEnv()): Promise<Response> {
  return worker.fetch(request as WorkerRequest, env, context);
}

describe("Cloudflare Worker boundary", () => {
  it("exposes a minimal health check", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("describes the OAuth-protected service", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Sign in with GitHub");
    expect(body).toContain("https://example.workers.dev/mcp");
  });

  it("rejects anonymous MCP requests with OAuth discovery", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/mcp"));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  });

  it("publishes protected-resource metadata", async () => {
    const response = await fetchWorker(
      new Request("https://example.workers.dev/.well-known/oauth-protected-resource/mcp")
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: "https://example.workers.dev/mcp",
      authorization_servers: ["https://example.workers.dev"]
    });
  });

  it("serves MCP initialization after the OAuth layer authorizes a request", async () => {
    const request = new Request("https://example.workers.dev/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Host: "example.workers.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "worker-test", version: "0.1.0" }
        }
      })
    });
    const response = await mcpApiHandler.fetch(
      request as WorkerRequest,
      testEnv({ ALLOWED_HOSTNAMES: "example.workers.dev" }),
      context
    );
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const payload = body.startsWith("event:")
      ? body
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice("data: ".length)
      : body;
    expect(payload).toBeTruthy();
    const result = JSON.parse(payload!) as { result?: { serverInfo?: { name?: string } } };
    expect(result.result?.serverInfo?.name).toBe("OIT - Medical Research MCP");
  });
});
