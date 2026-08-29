import { McpServer } from "@modelcontextprotocol/server";
import { ResearchService, type ResearchServiceOptions } from "@oit-medical-research/core";
import { z } from "zod";

const SearchInput = z.object({
  query: z.string().min(2).describe("A natural-language or keyword medical literature query.")
});

const FetchInput = z.object({
  id: z.string().min(1).describe("A search result ID, PMID, PMCID, DOI, or supported article URL.")
});

export function createMedicalResearchMcpServer(options: ResearchServiceOptions = {}): McpServer {
  const service = new ResearchService(options);
  const server = new McpServer({
    name: "OIT - Medical Research MCP",
    version: "0.1.0"
  });

  server.registerTool(
    "search",
    {
      title: "Search medical research",
      description:
        "Search PubMed, PubMed Central, Europe PMC, and Crossref for medical literature. Returns deduplicated stable IDs for use with fetch.",
      inputSchema: SearchInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query }) => toolResult(() => service.search(query))
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a medical research article",
      description:
        "Fetch normalized metadata, abstract, lawful open full text when available, identifiers, provenance, license, and access links for one article.",
      inputSchema: FetchInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ id }) => toolResult(() => service.fetch(id))
  );

  return server;
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const value = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The research request failed.";
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }]
    };
  }
}
