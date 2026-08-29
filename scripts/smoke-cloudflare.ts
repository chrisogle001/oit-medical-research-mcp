const baseUrl = process.env.MCP_BASE_URL?.replace(/\/$/, "");
const bearerToken = process.env.MCP_BEARER_TOKEN;

if (!baseUrl || !bearerToken) {
  throw new Error("MCP_BASE_URL and MCP_BEARER_TOKEN are required for the Cloudflare smoke test.");
}

let requestId = 10;

const health = await fetch(`${baseUrl}/health`);
if (!health.ok) throw new Error(`Health check failed with HTTP ${health.status}.`);

const anonymous = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
});
if (anonymous.status !== 401) {
  throw new Error(`Anonymous MCP request returned HTTP ${anonymous.status}; expected 401.`);
}

const initialized = await callMcp("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "oit-cloudflare-smoke-test", version: "0.1.0" }
});
if (initialized.result?.serverInfo?.name !== "OIT - Medical Research MCP") {
  throw new Error("Remote MCP initialization returned an unexpected server identity.");
}

const catalog = await callMcp("tools/list", {});
const tools = ((catalog.result?.tools ?? []) as Array<{ name?: string }>)
  .flatMap((tool) => (tool.name ? [tool.name] : []))
  .sort();
if (tools.join(",") !== "fetch,search") {
  throw new Error(`Unexpected remote tool catalog: ${tools.join(", ")}`);
}

const searchCall = await callMcp("tools/call", {
  name: "search",
  arguments: { query: "semaglutide cardiovascular outcomes trial" }
});
const firstContent = (searchCall.result?.content as Array<{ type?: string; text?: string }> | undefined)?.[0];
if (firstContent?.type !== "text" || !firstContent.text) {
  throw new Error("Remote search did not return MCP text content.");
}
const search = JSON.parse(firstContent.text) as { results?: unknown[] };
if (!search.results?.length) throw new Error("Remote search returned no literature results.");

console.log(
  JSON.stringify(
    {
      endpoint: baseUrl,
      health: "ok",
      anonymousAccess: "rejected",
      protocol: "connected",
      tools,
      searchResultCount: search.results.length
    },
    null,
    2
  )
);

async function callMcp(method: string, params: Record<string, unknown>) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params });
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });
    const body = await response.text();
    if (response.ok) {
      return parseMcpBody(body) as {
        result?: {
          content?: unknown;
          serverInfo?: { name?: string };
          tools?: unknown;
        };
      };
    }
    if (response.status === 401 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }
    throw new Error(`MCP ${method} failed with HTTP ${response.status}: ${body}`);
  }
  throw new Error(`MCP ${method} did not become ready before the retry limit.`);
}

function parseMcpBody(body: string): unknown {
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  const payload = payloads.at(-1);
  return JSON.parse(payload ?? body);
}
