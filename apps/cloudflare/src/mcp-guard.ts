const MAX_MCP_REQUEST_BYTES = 65_536;

export type McpRequestClassification =
  | { kind: "other" }
  | { kind: "too_large" }
  | { kind: "tool_call"; toolName: "search" | "fetch" | "other" };

export async function classifyMcpRequest(request: Request): Promise<McpRequestClassification> {
  if (request.method !== "POST") return { kind: "other" };

  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_REQUEST_BYTES) {
    return { kind: "too_large" };
  }

  const bytes = await readBoundedBody(request.clone().body, MAX_MCP_REQUEST_BYTES);
  if (!bytes) return { kind: "too_large" };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "other" };
  }
  const calls = Array.isArray(payload) ? payload : [payload];
  const toolCalls = calls.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.method === "tools/call"
  );
  if (toolCalls.length === 0) return { kind: "other" };
  if (toolCalls.length !== 1) return { kind: "tool_call", toolName: "other" };

  const params = toolCalls[0]!.params;
  const name = isRecord(params) && typeof params.name === "string" ? params.name : "other";
  return {
    kind: "tool_call",
    toolName: name === "search" || name === "fetch" ? name : "other"
  };
}

export function mcpErrorResponse(
  status: number,
  message: string,
  retryAfterSeconds?: number
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  if (retryAfterSeconds) headers.set("Retry-After", String(retryAfterSeconds));
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 429 ? -32029 : -32600, message },
      id: null
    }),
    { status, headers }
  );
}

export function writeUsageEvent(
  analytics: AnalyticsEngineDataset | undefined,
  event: {
    account: string;
    toolName: "search" | "fetch" | "other";
    outcome: "completed" | "rejected" | "rate_limited";
    durationMs: number;
    status: number;
  }
): void {
  try {
    analytics?.writeDataPoint({
      indexes: [event.account],
      blobs: ["mcp_tool_call", event.toolName, event.outcome],
      doubles: [1, event.durationMs, event.status]
    });
  } catch {
    console.error(JSON.stringify({ event: "usage_analytics_write_failed" }));
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
