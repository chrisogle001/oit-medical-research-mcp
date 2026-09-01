import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { FetchLike, ResearchProvider } from "@oit-medical-research/core";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { describe, expect, it } from "vitest";

const DATASET_ID = "2457ea29-fc82-48b0-86ec-3b0755de7515";
const emptyProvider: ResearchProvider = {
  name: "pubmed",
  async search() {
    return [];
  },
  async fetch() {
    return null;
  }
};

describe("CMS MCP tools", () => {
  it("advertises structured dataset discovery and query tools", async () => {
    const fetcher: FetchLike = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/data.json") {
        return Response.json({
          dataset: [
            {
              title: "Medicare provider enrollment",
              description: "Public enrollment data",
              theme: ["Medicare"],
              distribution: [
                {
                  format: "API",
                  description: "latest",
                  accessURL: `https://data.cms.gov/data-api/v1/dataset/${DATASET_ID}/data`
                }
              ]
            }
          ]
        });
      }
      return Response.json([{ STATE_CD: "TX", PROVIDER_TYPE_DESC: "ENDOCRINOLOGY" }]);
    };
    const server = createMedicalResearchMcpServer({ providers: [emptyProvider], fetch: fetcher });
    const client = new Client({ name: "cms-tool-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const catalog = await client.listTools();
      expect(catalog.tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["cms_search_datasets", "cms_query_dataset"])
      );

      const search = await client.callTool({
        name: "cms_search_datasets",
        arguments: { query: "provider enrollment", limit: 1 }
      });
      expect(search.structuredContent).toMatchObject({
        source: "data.cms.gov",
        resultCount: 1,
        results: [{ datasetId: DATASET_ID }]
      });

      const query = await client.callTool({
        name: "cms_query_dataset",
        arguments: { datasetId: DATASET_ID, limit: 1 }
      });
      expect(query.structuredContent).toMatchObject({
        source: "data.cms.gov",
        datasetId: DATASET_ID,
        returned: 1,
        columns: ["STATE_CD", "PROVIDER_TYPE_DESC"]
      });
      const text = query.content.find((item) => item.type === "text")?.text ?? "";
      expect(JSON.parse(text)).toMatchObject({
        responseType: "cmsDatasetQuery",
        returned: 1,
        modelSummaryTruncated: false
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
