import { CmsDataService, type FetchLike } from "@oit-medical-research/core";
import { describe, expect, it } from "vitest";

const DATASET_ID = "2457ea29-fc82-48b0-86ec-3b0755de7515";

describe("CmsDataService", () => {
  it("discovers the latest matching CMS public dataset", async () => {
    const service = new CmsDataService({ fetch: catalogFetch() });

    const result = await service.searchDatasets("provider enrollment", 5);

    expect(result).toEqual({
      source: "data.cms.gov",
      resultCount: 1,
      totalMatches: 1,
      totalCatalogDatasets: 2,
      results: [
        {
          datasetId: DATASET_ID,
          title: "Medicare Fee-For-Service Public Provider Enrollment",
          description: "Public provider enrollment information.",
          themes: ["Medicare"],
          keywords: ["Provider", "Enrollment"],
          modified: "2026-07-17",
          temporal: "2026-01-01/2026-07-17",
          landingPage: "https://data.cms.gov/provider-summary/provider-enrollment",
          license: "https://www.usa.gov/government-works",
          apiUrl: `https://data.cms.gov/data-api/v1/dataset/${DATASET_ID}/data`,
          resourcesUrl: `https://data.cms.gov/data-api/v1/dataset-resources/${DATASET_ID}`
        }
      ]
    });
  });

  it("queries bounded rows with encoded CMS filters", async () => {
    let requestedUrl: URL | undefined;
    const fetcher: FetchLike = async (input) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json([
        {
          NPI: "1003879883",
          PROVIDER_TYPE_DESC: "PRACTITIONER - ENDOCRINOLOGY",
          STATE_CD: "TX"
        }
      ]);
    };
    const service = new CmsDataService({ fetch: fetcher });

    const result = await service.queryDataset(DATASET_ID, 10, 20, [
      { field: "PROVIDER_TYPE_DESC", operator: "contains", value: "ENDOCRINOLOGY" },
      { field: "STATE_CD", operator: "equals", value: "TX" }
    ]);

    expect(requestedUrl?.hostname).toBe("data.cms.gov");
    expect(requestedUrl?.pathname).toBe(`/data-api/v1/dataset/${DATASET_ID}/data`);
    expect(requestedUrl?.searchParams.get("size")).toBe("10");
    expect(requestedUrl?.searchParams.get("offset")).toBe("20");
    expect(
      requestedUrl?.searchParams.get("filter[filter-1][condition][operator]")
    ).toBe("CONTAINS");
    expect(requestedUrl?.searchParams.get("filter[filter-2][condition][operator]")).toBe("=");
    expect(result).toMatchObject({
      source: "data.cms.gov",
      datasetId: DATASET_ID,
      offset: 20,
      limit: 10,
      returned: 1,
      columns: ["NPI", "PROVIDER_TYPE_DESC", "STATE_CD"],
      rows: [{ STATE_CD: "TX" }]
    });
    expect(result.note).toContain("not patient-specific clinical records");
  });

  it("rejects identifiers and filter fields that cannot be safely translated", async () => {
    const service = new CmsDataService({ fetch: async () => Response.json([]) });

    await expect(service.queryDataset("not-a-uuid")).rejects.toThrow(
      "Use a CMS dataset UUID returned by cms_search_datasets"
    );
    await expect(
      service.queryDataset(DATASET_ID, 10, 0, [
        { field: "unsafe[field]", operator: "equals", value: "test" }
      ])
    ).rejects.toThrow("A CMS filter field is invalid");
  });
});

function catalogFetch(): FetchLike {
  return async () =>
    Response.json({
      dataset: [
        {
          title: "Medicare Fee-For-Service Public Provider Enrollment",
          description: "<p>Public provider enrollment information.</p>",
          theme: ["Medicare"],
          keyword: ["Provider", "Enrollment"],
          modified: "2026-07-17",
          temporal: "2026-01-01/2026-07-17",
          landingPage: "https://data.cms.gov/provider-summary/provider-enrollment",
          license: "https://www.usa.gov/government-works",
          distribution: [
            {
              format: "API",
              description: "latest",
              modified: "2026-07-17",
              accessURL: `https://data.cms.gov/data-api/v1/dataset/${DATASET_ID}/data`,
              resourcesAPI: `https://data.cms.gov/data-api/v1/dataset-resources/${DATASET_ID}`
            }
          ]
        },
        {
          title: "Unrelated Marketplace Dataset",
          description: "Health insurance plans.",
          distribution: [
            {
              format: "API",
              description: "latest",
              accessURL:
                "https://data.cms.gov/data-api/v1/dataset/11111111-1111-4111-8111-111111111111/data"
            }
          ]
        }
      ]
    });
}
