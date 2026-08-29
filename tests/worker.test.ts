import { describe, expect, it } from "vitest";
import worker from "../apps/cloudflare/src/index.js";

const context = {
  waitUntil() {},
  passThroughOnException() {},
  props: {}
} as unknown as ExecutionContext;

type WorkerRequest = Parameters<typeof worker.fetch>[0];
type WorkerEnv = Parameters<typeof worker.fetch>[1];

function fetchWorker(request: Request, env: WorkerEnv = {}): Promise<Response> {
  return worker.fetch(request as WorkerRequest, env, context);
}

describe("Cloudflare Worker boundary", () => {
  it("exposes a minimal health check", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("fails closed when authentication is not configured", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/mcp"));
    expect(response.status).toBe(503);
  });

  it("rejects an incorrect bearer token", async () => {
    const request = new Request("https://example.workers.dev/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer incorrect" }
    });
    const response = await fetchWorker(request, { MCP_BEARER_TOKEN: "correct" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("serves an authenticated MCP initialization request", async () => {
    const request = new Request("https://example.workers.dev/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer correct",
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
    const response = await fetchWorker(request, {
      MCP_BEARER_TOKEN: "correct",
      ALLOWED_HOSTNAMES: "example.workers.dev"
    });
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
