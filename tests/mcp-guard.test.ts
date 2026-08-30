import { describe, expect, it } from "vitest";
import { classifyMcpRequest } from "../apps/cloudflare/src/mcp-guard.js";

describe("Cloudflare MCP request classification", () => {
  it.each(["citations", "annotations"] as const)(
    "classifies %s calls for privacy-safe usage telemetry",
    async (toolName) => {
      const request = new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: { id: "pmid:32678530", direction: "references" }
          }
        })
      });

      await expect(classifyMcpRequest(request)).resolves.toEqual({
        kind: "tool_call",
        toolName
      });
    }
  );
});
