import { describe, expect, it, vi } from "vitest";
import { CrossrefProvider } from "../packages/core/src/providers/crossref.js";
import { EuropePmcProvider } from "../packages/core/src/providers/europe-pmc.js";
import { PubMedProvider } from "../packages/core/src/providers/pubmed.js";
import type { FetchLike, SearchFilters } from "../packages/core/src/types.js";

const filters: SearchFilters = {
  fromYear: 2020,
  toYear: 2025,
  journals: ["Diabetes Care", "The Lancet"],
  fullTextOnly: true
};

describe("structured provider search filters", () => {
  it("translates filters into PubMed ESearch parameters", async () => {
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn<FetchLike>(async (input) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json({ esearchresult: { idlist: [] } });
    });
    const provider = new PubMedProvider({ fetch: fetcher, contactEmail: "research@example.test" });

    await provider.search("knee osteoarthritis", 5, filters);

    expect(requestedUrl?.searchParams.get("term")).toBe(
      '(knee osteoarthritis) AND ("Diabetes Care"[Journal] OR "The Lancet"[Journal]) AND "pubmed pmc"[sb]'
    );
    expect(requestedUrl?.searchParams.get("datetype")).toBe("pdat");
    expect(requestedUrl?.searchParams.get("mindate")).toBe("2020");
    expect(requestedUrl?.searchParams.get("maxdate")).toBe("2025");
  });

  it("translates filters into Europe PMC search syntax", async () => {
    let requestedUrl: URL | undefined;
    const fetcher = vi.fn<FetchLike>(async (input) => {
      requestedUrl = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json({ resultList: { result: [] } });
    });
    const provider = new EuropePmcProvider({ fetch: fetcher, contactEmail: "research@example.test" });

    await provider.search("knee osteoarthritis", 5, filters);

    expect(requestedUrl?.searchParams.get("query")).toBe(
      '(knee osteoarthritis) AND FIRST_PDATE:[2020-01-01 TO 2025-12-31] AND (JOURNAL:"Diabetes Care" OR JOURNAL:"The Lancet") AND IN_PMC:Y'
    );
  });

  it("uses exact Crossref journal and publication-date filters", async () => {
    const requestedUrls: URL[] = [];
    const fetcher = vi.fn<FetchLike>(async (input) => {
      requestedUrls.push(new URL(input instanceof Request ? input.url : input.toString()));
      return Response.json({ message: { items: [] } });
    });
    const provider = new CrossrefProvider({ fetch: fetcher, contactEmail: "research@example.test" });

    await provider.search("knee osteoarthritis", 5, { ...filters, fullTextOnly: false });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.map((url) => url.searchParams.get("filter"))).toEqual([
      "from-pub-date:2020-01-01,until-pub-date:2025-12-31,container-title:Diabetes Care",
      "from-pub-date:2020-01-01,until-pub-date:2025-12-31,container-title:The Lancet"
    ]);
  });

  it("keeps candidates from every requested Crossref journal", async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const journal = url.searchParams.get("filter")?.split("container-title:")[1] ?? "Unknown";
      return Response.json({
        message: {
          items: [
            {
              DOI: `10.1000/${journal.toLowerCase().replace(/\s+/g, "-")}`,
              title: [`Article from ${journal}`],
              "container-title": [journal],
              published: { "date-parts": [[2024]] }
            }
          ]
        }
      });
    });
    const provider = new CrossrefProvider({ fetch: fetcher, contactEmail: "research@example.test" });

    const records = await provider.search("diabetes", 2, {
      journals: ["Journal One", "Journal Two", "Journal Three"]
    });

    expect(records.map((record) => record.journal)).toEqual([
      "Journal One",
      "Journal Two",
      "Journal Three"
    ]);
  });

  it("does not claim repository full-text availability from Crossref metadata", async () => {
    const fetcher = vi.fn<FetchLike>();
    const provider = new CrossrefProvider({ fetch: fetcher, contactEmail: "research@example.test" });

    await expect(provider.search("knee osteoarthritis", 5, filters)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
