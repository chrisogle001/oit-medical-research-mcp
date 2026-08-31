import { describe, expect, it } from "vitest";
import worker, { mcpApiHandler } from "../apps/cloudflare/src/index.js";

const authProps = {
  userId: "42",
  login: "researcher",
  displayName: "Researcher",
  scopes: ["mcp:research"]
};
const context = {
  waitUntil() {},
  passThroughOnException() {},
  props: authProps
} as unknown as ExecutionContext;

const userData = new Map<string, string>();

type WorkerRequest = Parameters<typeof worker.fetch>[0];
type WorkerEnv = Parameters<typeof worker.fetch>[1];

function testEnv(values: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    USER_DATA_KV: {
      get: async (key: string) => userData.get(key) ?? null,
      put: async (key: string, value: string) => {
        userData.set(key, value);
      },
      delete: async (key: string) => {
        userData.delete(key);
      }
    } as unknown as KVNamespace,
    USER_DATA_ENCRYPTION_KEY:
      "worker-test-user-data-encryption-key-that-is-long-enough",
    MCP_ACCOUNT_RATE_LIMITER: {
      limit: async () => ({ success: true })
    } as RateLimit,
    USAGE_ANALYTICS: {
      writeDataPoint() {}
    },
    ...values
  } as WorkerEnv;
}

function fetchWorker(request: Request, env = testEnv()): Promise<Response> {
  return worker.fetch(request as WorkerRequest, env, context);
}

async function readMcpPayload(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  const payload = body.startsWith("event:")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length)
    : body;
  if (!payload) throw new Error("The MCP response did not contain a JSON payload.");
  return JSON.parse(payload) as Record<string, unknown>;
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
    expect(body).toContain("Manage hosted account");
    expect(body).toContain("Connection instructions");
    expect(body).toContain('href="/connect"');
    expect(body).toContain("https://example.workers.dev/mcp");
  });

  it("provides browser-friendly MCP connection instructions", async () => {
    const response = await fetchWorker(new Request("https://example.workers.dev/connect"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Connect your AI workspace");
    expect(body).toContain("https://example.workers.dev/mcp");
    expect(body).toContain("not a normal webpage");
  });

  it("shows connection instructions for a direct browser navigation to the MCP endpoint", async () => {
    const response = await fetchWorker(
      new Request("https://example.workers.dev/mcp", {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Sec-Fetch-Mode": "navigate"
        }
      })
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Connect your AI workspace");
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
    expect(response.status).toBe(200);
    const result = (await readMcpPayload(response)) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(result.result?.serverInfo?.name).toBe("OIT - Medical Research MCP");
  });

  it("returns a visible MCP tool error for a malformed article identifier", async () => {
    const response = await mcpApiHandler.fetch(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Host: "example.workers.dev",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "fetch", arguments: { id: "doi:not-a-valid-doi" } }
        })
      }) as WorkerRequest,
      testEnv({ ALLOWED_HOSTNAMES: "example.workers.dev" }),
      context
    );
    const payload = (await readMcpPayload(response)) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text).toContain("The DOI is not valid");
  });

  it("rejects an absurd publication year through the MCP input schema", async () => {
    const response = await mcpApiHandler.fetch(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Host: "example.workers.dev",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "search", arguments: { query: "clinical trial", fromYear: 1700 } }
        })
      }) as WorkerRequest,
      testEnv({ ALLOWED_HOSTNAMES: "example.workers.dev" }),
      context
    );
    const payload = await readMcpPayload(response);

    expect(response.status).toBe(200);
    expect(JSON.stringify(payload)).toContain("isError");
    expect(JSON.stringify(payload)).toContain("1800");
    expect(JSON.stringify(payload).toLowerCase()).toContain("too small");
  });

  it("rate limits a research tool call without recording its query", async () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const query = "private medical research phrase";
    const response = await mcpApiHandler.fetch(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search", arguments: { query } }
        })
      }) as WorkerRequest,
      testEnv({
        MCP_ACCOUNT_RATE_LIMITER: {
          limit: async () => ({ success: false })
        } as RateLimit,
        USAGE_ANALYTICS: {
          writeDataPoint(point) {
            if (point) points.push(point);
          }
        }
      }),
      context
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(points).toHaveLength(1);
    expect(JSON.stringify(points[0])).not.toContain(query);
    expect(points[0]?.blobs).toEqual(["mcp_tool_call", "search", "rate_limited"]);
  });

  it("rejects an OAuth token without the medical research scope", async () => {
    const unscopedContext = {
      waitUntil() {},
      passThroughOnException() {},
      props: { ...authProps, scopes: [] }
    } as unknown as ExecutionContext;
    const response = await mcpApiHandler.fetch(
      new Request("https://example.workers.dev/mcp", { method: "GET" }) as WorkerRequest,
      testEnv(),
      unscopedContext
    );
    expect(response.status).toBe(403);
  });
});
