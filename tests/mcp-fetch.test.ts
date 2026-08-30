import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { ResearchProvider } from "@oit-medical-research/core";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { describe, expect, it } from "vitest";

const articleProvider: ResearchProvider = {
  name: "pubmed",
  async search() {
    return [];
  },
  async fetch(identifier) {
    if (identifier.type !== "pmcid" || identifier.value !== "PMC9012068") return null;
    return {
      title: "A protocol-level fetch fixture",
      fullText: "Lawfully available full text that must be omitted on request.",
      identifiers: { pmid: "35428274", pmcid: "PMC9012068" },
      providers: ["pubmed"]
    };
  }
};

describe("MCP fetch tool", () => {
  it("preserves includeText false across the MCP protocol boundary", async () => {
    const server = createMedicalResearchMcpServer({ providers: [articleProvider] });
    const client = new Client({ name: "fetch-regression-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const catalog = await client.listTools();
      const fetchTool = catalog.tools.find((tool) => tool.name === "fetch");
      expect(fetchTool?.inputSchema).toMatchObject({
        properties: {
          includeText: { type: "boolean" }
        }
      });

      const result = await client.callTool({
        name: "fetch",
        arguments: { id: "pmcid:PMC9012068", includeText: false }
      });
      const structured = result.structuredContent as Record<string, unknown>;
      const compatibleText = result.content.find((item) => item.type === "text");
      const compatible = JSON.parse(compatibleText?.type === "text" ? compatibleText.text : "{}");

      expect(structured).toMatchObject({
        id: "pmcid:PMC9012068",
        textInfo: {
          included: false,
          availableCharacters: 61,
          returnedCharacters: 0,
          truncated: false
        }
      });
      expect(structured).not.toHaveProperty("text");
      expect(compatible).toEqual(structured);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
