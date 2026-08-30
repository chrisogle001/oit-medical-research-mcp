import { describe, expect, it, vi } from "vitest";
import { EuropePmcProvider } from "../packages/core/src/providers/europe-pmc.js";
import type { FetchLike } from "../packages/core/src/types.js";

describe("EuropePmcProvider", () => {
  it("retrieves bounded article annotations with normalized context and linked tags", async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/search")) {
        return Response.json({
          resultList: {
            result: [
              {
                id: "21494379",
                source: "MED",
                pmid: "21494379",
                pmcid: "PMC3075991",
                title: "Fluoride concentration in beverages"
              }
            ]
          }
        });
      }

      expect(url.pathname).toBe("/europepmc/annotations_api/annotationsByArticleIds");
      expect(url.searchParams.get("articleIds")).toBe("MED:21494379");
      expect(url.searchParams.getAll("type")).toEqual(["Chemicals", "Diseases"]);
      expect(url.searchParams.getAll("section")).toEqual(["Abstract"]);
      expect(url.searchParams.getAll("provider")).toEqual(["Europe PMC"]);
      expect(url.searchParams.get("format")).toBe("JSON");
      return Response.json([
        {
          source: "MED",
          extId: "21494379",
          pmcid: "PMC3075991",
          annotations: [
            {
              prefix: "The concentration of",
              exact: "fluoride",
              postfix: "was measured.",
              tags: [
                { name: "fluoride", uri: "http://purl.obolibrary.org/obo/CHEBI_17051" },
                { name: "fluoride", uri: "http://purl.obolibrary.org/obo/CHEBI_17051" }
              ],
              id: "http://europepmc.org/article/MED/21494379#annotation-1",
              type: "Chemicals",
              section: "Abstract (http://purl.org/dc/terms/abstract)",
              provider: "Europe PMC"
            },
            {
              exact: "fluoride",
              id: "http://europepmc.org/article/MED/21494379#annotation-1",
              type: "Chemicals"
            },
            { type: "Chemicals" }
          ]
        }
      ]);
    });
    const provider = new EuropePmcProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const result = await provider.annotations(
      { type: "pmid", value: "21494379" },
      1,
      {
        types: ["Chemicals", "Diseases"],
        sections: ["Abstract"],
        providers: ["Europe PMC"]
      }
    );

    expect(result).toMatchObject({
      total: 1,
      article: { identifiers: { pmid: "21494379", pmcid: "PMC3075991" } },
      annotations: [
        {
          text: "fluoride",
          type: "Chemicals",
          section: "Abstract",
          sectionUri: "http://purl.org/dc/terms/abstract",
          provider: "Europe PMC",
          prefix: "The concentration of",
          postfix: "was measured.",
          tags: [
            { name: "fluoride", uri: "http://purl.obolibrary.org/obo/CHEBI_17051" }
          ],
          url: "http://europepmc.org/article/MED/21494379#annotation-1"
        }
      ]
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("labels preprints and retracted publications from core metadata", async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.searchParams.get("resultType")).toBe("core");
      return Response.json({
        resultList: {
          result: [
            {
              id: "PPR123456",
              source: "PPR",
              title: "An early clinical finding",
              pubTypeList: { pubType: ["Preprint"] }
            },
            {
              id: "32450107",
              source: "MED",
              pmid: "32450107",
              title: "RETRACTED: A clinical registry analysis",
              pubTypeList: {
                pubType: ["Retracted Publication", "research-article", "Journal Article"]
              },
              commentCorrectionList: {
                commentCorrection: [{ type: "Retraction in" }]
              }
            }
          ]
        }
      });
    });
    const provider = new EuropePmcProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const records = await provider.search("clinical", 2);

    expect(records[0]).toMatchObject({
      publicationTypes: ["Preprint"],
      isPreprint: true
    });
    expect(records[1]).toMatchObject({
      publicationTypes: ["Retracted Publication", "research-article", "Journal Article"],
      isRetracted: true
    });
  });

  it("identifies full-text requests and preserves metadata when the XML endpoint is unavailable", async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/search")) {
        return Response.json({
          resultList: {
            result: [
              {
                id: "32678530",
                source: "MED",
                pmid: "32678530",
                pmcid: "PMC7383595",
                doi: "10.1056/NEJMoa2021436",
                title: "Dexamethasone in Hospitalized Patients with Covid-19",
                abstractText: "A useful abstract.",
                isOpenAccess: "Y"
              }
            ]
          }
        });
      }
      expect(url.pathname).toMatch(/\/PMC7383595\/fullTextXML$/);
      expect(url.searchParams.get("email")).toBe("research-api@example.test");
      return new Response("temporarily unavailable", { status: 503 });
    });
    const provider = new EuropePmcProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const record = await provider.fetch({ type: "pmcid", value: "PMC7383595" });

    expect(record).toMatchObject({
      title: "Dexamethasone in Hospitalized Patients with Covid-19",
      abstract: "A useful abstract.",
      identifiers: { pmid: "32678530", pmcid: "PMC7383595", doi: "10.1056/nejmoa2021436" },
      providers: ["europe-pmc"]
    });
    expect(record?.fullText).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["references", "referenceList", "reference"],
    ["citedBy", "citationList", "citation"]
  ] as const)("retrieves and normalizes %s citation records", async (direction, listName, itemName) => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/search")) {
        expect(url.searchParams.get("resultType")).toBe("core");
        return Response.json({
          resultList: {
            result: [
              {
                id: "32678530",
                source: "MED",
                pmid: "32678530",
                title: "Dexamethasone in Hospitalized Patients with Covid-19"
              }
            ]
          }
        });
      }

      expect(url.pathname).toBe(`/europepmc/webservices/rest/MED/32678530/${
        direction === "references" ? "references" : "citations"
      }`);
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("pageSize")).toBe("2");
      expect(url.searchParams.get("email")).toBe("research-api@example.test");
      return Response.json({
        hitCount: 7,
        [listName]: {
          [itemName]: [
            {
              id: "31978945",
              source: "MED",
              title: "A Novel Coronavirus from Patients with Pneumonia in China, 2019.",
              authorString: "Zhu N, Zhang D.",
              journalAbbreviation: "N Engl J Med",
              pubYear: 2020,
              citedByCount: 15
            }
          ]
        }
      });
    });
    const provider = new EuropePmcProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const result = await provider.citations({ type: "pmid", value: "32678530" }, direction, 2);

    expect(result).toMatchObject({
      total: 7,
      article: { identifiers: { pmid: "32678530" } },
      records: [
        {
          title: "A Novel Coronavirus from Patients with Pneumonia in China, 2019.",
          journal: "N Engl J Med",
          publicationDate: "2020",
          identifiers: { pmid: "31978945", epmcSource: "MED", epmcId: "31978945" },
          citationCount: 15,
          providers: ["europe-pmc"]
        }
      ]
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
