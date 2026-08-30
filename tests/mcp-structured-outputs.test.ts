import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { ResearchProvider } from "@oit-medical-research/core";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { describe, expect, it } from "vitest";

const article = {
  title: "Structured MCP result fixture",
  authors: ["Researcher A"],
  publicationTypes: ["Journal Article"],
  journal: "Trials",
  publicationDate: "2025-06-20",
  identifiers: { pmid: "12345678", pmcid: "PMC1234567" },
  fullTextUrl: "https://europepmc.org/articles/PMC1234567",
  isOpenAccess: true,
  providers: ["europe-pmc" as const]
};

const provider: ResearchProvider = {
  name: "europe-pmc",
  async search() {
    return [article];
  },
  async fetch() {
    return article;
  },
  async citations() {
    return {
      article,
      total: 1,
      records: [{ ...article, title: "Cited article", identifiers: { pmid: "87654321" } }]
    };
  },
  async annotations() {
    return {
      article,
      total: 1,
      annotations: [
        {
          text: "knee osteoarthritis",
          type: "Diseases",
          section: "Abstract",
          provider: "Europe PMC",
          tags: [{ name: "knee osteoarthritis", uri: "http://example.test/entity/1" }]
        }
      ]
    };
  }
};

describe("MCP structured tool outputs", () => {
  it("advertises and returns structured search, citation, and annotation results", async () => {
    const server = createMedicalResearchMcpServer({ providers: [provider] });
    const client = new Client({ name: "structured-output-regression-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const catalog = await client.listTools();
      for (const toolName of ["search", "citations", "annotations"] as const) {
        const tool = catalog.tools.find((candidate) => candidate.name === toolName);
        const outputProperties = (
          tool?.outputSchema as { properties?: Record<string, unknown> } | undefined
        )?.properties;
        expect(outputProperties, `${toolName} output schema`).toBeDefined();
        expect(outputProperties).toHaveProperty("providerDiagnostics");
      }

      const search = await client.callTool({
        name: "search",
        arguments: { query: "knee osteoarthritis", limit: 1 }
      });
      expectCompatibleStructuredResult(search);
      expect(search.structuredContent).toMatchObject({
        results: [
          {
            publicationDate: "2025-06-20",
            fullTextStatus: "repository-indexed",
            isPreprint: false,
            isRetracted: false
          }
        ],
        providerDiagnostics: {
          attempted: ["europe-pmc"],
          contributed: ["europe-pmc"],
          partialFailure: false
        }
      });

      const citations = await client.callTool({
        name: "citations",
        arguments: { id: "pmcid:PMC1234567", direction: "citedBy", limit: 1 }
      });
      expectCompatibleStructuredResult(citations);
      expect(citations.structuredContent).toMatchObject({
        direction: "citedBy",
        total: 1,
        providerDiagnostics: { contributed: ["europe-pmc"] }
      });

      const annotations = await client.callTool({
        name: "annotations",
        arguments: { id: "pmcid:PMC1234567", limit: 1 }
      });
      expectCompatibleStructuredResult(annotations);
      expect(annotations.structuredContent).toMatchObject({
        source: "europe-pmc",
        total: 1,
        annotations: [{ type: "Diseases", section: "Abstract" }],
        providerDiagnostics: { contributed: ["europe-pmc"] }
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function expectCompatibleStructuredResult(result: {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}): void {
  const text = result.content.find((item) => item.type === "text")?.text;
  expect(text).toBeDefined();
  expect(JSON.parse(text ?? "{}")).toEqual(result.structuredContent);
}
