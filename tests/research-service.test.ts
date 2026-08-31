import { describe, expect, it } from "vitest";
import { ResearchService, UpstreamError, type ResearchProvider } from "@oit-medical-research/core";

const pubmed: ResearchProvider = {
  name: "pubmed",
  async search() {
    return [
      {
        title: "A useful trial",
        identifiers: { pmid: "123", doi: "10.1000/trial" },
        url: "https://pubmed.ncbi.nlm.nih.gov/123/",
        providers: ["pubmed"]
      }
    ];
  },
  async fetch(identifier) {
    if (identifier.type !== "pmid" || identifier.value !== "123") return null;
    return {
      title: "A useful trial",
      abstract: "A structured abstract.",
      identifiers: { pmid: "123", pmcid: "PMC456", doi: "10.1000/trial" },
      providers: ["pubmed"]
    };
  }
};

const europePmc: ResearchProvider = {
  name: "europe-pmc",
  async search() {
    return [
      {
        title: "A useful trial",
        identifiers: { pmid: "123", pmcid: "PMC456", doi: "10.1000/trial" },
        providers: ["europe-pmc"]
      }
    ];
  },
  async fetch(identifier) {
    if (identifier.type !== "pmcid" || identifier.value !== "PMC456") return null;
    return {
      title: "A useful trial",
      fullText: "Lawfully available full text.",
      identifiers: { pmid: "123", pmcid: "PMC456", doi: "10.1000/trial" },
      isOpenAccess: true,
      license: "CC BY",
      providers: ["europe-pmc"]
    };
  }
};

describe("ResearchService", () => {
  it("deduplicates search results across providers", async () => {
    const service = new ResearchService({ providers: [pubmed, europePmc] });
    await expect(service.search("useful trial")).resolves.toEqual({
      results: [
        {
          id: "pmcid:PMC456",
          title: "A useful trial",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC456/",
          identifiers: { pmid: "123", pmcid: "PMC456", doi: "10.1000/trial" },
          providers: ["europe-pmc", "pubmed"],
          isPreprint: false,
          isRetracted: false,
          fullTextAvailable: true,
          fullTextStatus: "repository-indexed"
        }
      ],
      providerDiagnostics: {
        attempted: ["pubmed", "europe-pmc"],
        contributed: ["europe-pmc", "pubmed"],
        noRecord: [],
        failed: [],
        failures: [],
        partialFailure: false
      }
    });
  });

  it("applies structured date, journal, and repository-full-text filters", async () => {
    let receivedFilters: Parameters<ResearchProvider["search"]>[2];
    const provider: ResearchProvider = {
      name: "pubmed",
      async search(_query, _limit, filters) {
        receivedFilters = filters;
        return [
          {
            title: "Current Diabetes Care trial",
            journal: "Diabetes Care",
            publicationDate: "2024-06-01",
            identifiers: { pmid: "1", pmcid: "PMC1" },
            providers: ["pubmed"]
          },
          {
            title: "Older Diabetes Care trial",
            journal: "Diabetes Care",
            publicationDate: "2019",
            identifiers: { pmid: "2", pmcid: "PMC2" },
            providers: ["pubmed"]
          },
          {
            title: "Current Lancet trial",
            journal: "The Lancet",
            publicationDate: "2024",
            identifiers: { pmid: "3", pmcid: "PMC3" },
            providers: ["pubmed"]
          },
          {
            title: "Metadata-only Diabetes Care trial",
            journal: "Diabetes Care",
            publicationDate: "2024",
            identifiers: { pmid: "4" },
            providers: ["pubmed"]
          }
        ];
      },
      async fetch() {
        return null;
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.search("diabetes trial", 10, {
      fromYear: 2020,
      toYear: 2025,
      journals: ["Diabetes Care"],
      fullTextOnly: true
    });

    expect(receivedFilters).toEqual({
      fromYear: 2020,
      toYear: 2025,
      journals: ["Diabetes Care"],
      fullTextOnly: true
    });
    expect(result.results.map(({ id }) => id)).toEqual(["pmcid:PMC1"]);
    expect(result.results[0]).toMatchObject({
      journal: "Diabetes Care",
      publicationDate: "2024-06-01",
      fullTextAvailable: true
    });
  });

  it("rejects an inverted publication-year range", async () => {
    const service = new ResearchService({ providers: [pubmed] });
    await expect(service.search("year range", 10, { fromYear: 2025, toYear: 2020 })).rejects.toThrow(
      "fromYear must be less than or equal to toYear"
    );
  });

  it("rejects publication years outside the supported range", async () => {
    const service = new ResearchService({ providers: [pubmed] });
    await expect(service.search("year range", 10, { fromYear: 1799 })).rejects.toThrow(
      "fromYear must be a year between 1800 and 2100"
    );
    await expect(service.search("year range", 10, { toYear: 2101 })).rejects.toThrow(
      "toYear must be a year between 1800 and 2100"
    );
  });

  it("honors a requested result limit", async () => {
    const provider: ResearchProvider = {
      name: "pubmed",
      async search() {
        return Array.from({ length: 5 }, (_, index) => ({
          title: `Study ${index + 1}`,
          identifiers: { pmid: String(index + 1) },
          providers: ["pubmed"]
        }));
      },
      async fetch() {
        return null;
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.search("limited result test", 3);

    expect(result.results).toHaveLength(3);
  });

  it("returns a normalized citation network with stable follow-up IDs", async () => {
    const provider: ResearchProvider = {
      name: "europe-pmc",
      async search() {
        return [];
      },
      async fetch() {
        return null;
      },
      async citations(identifier, direction, limit) {
        expect(identifier).toEqual({ type: "pmid", value: "32678530" });
        expect(direction).toBe("references");
        expect(limit).toBe(2);
        return {
          article: {
            title: "Dexamethasone in Hospitalized Patients with Covid-19",
            identifiers: { pmid: "32678530", pmcid: "PMC7383595" },
            providers: ["europe-pmc"]
          },
          total: 36,
          records: [
            {
              title: "A Novel Coronavirus from Patients with Pneumonia in China, 2019.",
              journal: "N Engl J Med",
              publicationDate: "2020",
              identifiers: { pmid: "31978945" },
              providers: ["europe-pmc"]
            },
            {
              title: "On the use of corticosteroids for 2019-nCoV pneumonia.",
              identifiers: { pmid: "32122468" },
              providers: ["europe-pmc"]
            }
          ]
        };
      }
    };
    const service = new ResearchService({ providers: [provider], maxResults: 5 });

    const result = await service.citations("pmid:32678530", "references", 2);

    expect(result).toMatchObject({
      article: {
        id: "pmcid:PMC7383595",
        fullTextAvailable: true
      },
      direction: "references",
      total: 36
    });
    expect(result.results.map(({ id }) => id)).toEqual(["pmid:31978945", "pmid:32122468"]);
  });

  it("reports when configured providers do not support citation lookup", async () => {
    const service = new ResearchService({ providers: [pubmed] });
    await expect(service.citations("pmid:123", "citedBy")).rejects.toThrow(
      "Citation lookup is not supported"
    );
  });

  it("returns normalized article annotations with an explicit text-mining disclaimer", async () => {
    let receivedFilters: unknown;
    const provider: ResearchProvider = {
      name: "europe-pmc",
      async search() {
        return [];
      },
      async fetch() {
        return null;
      },
      async annotations(identifier, limit, filters) {
        expect(identifier).toEqual({ type: "pmid", value: "21494379" });
        expect(limit).toBe(1);
        receivedFilters = filters;
        return {
          article: {
            title: "Fluoride concentration in beverages",
            publicationTypes: ["Journal Article"],
            identifiers: { pmid: "21494379", pmcid: "PMC3075991" },
            providers: ["europe-pmc"]
          },
          total: 8,
          annotations: [
            {
              text: "fluoride",
              type: "Chemicals",
              section: "Abstract",
              tags: [{ name: "fluoride", uri: "http://purl.obolibrary.org/obo/CHEBI_17051" }]
            }
          ]
        };
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.annotations("pmid:21494379", 1, {
      types: [" Chemicals ", "Chemicals"],
      sections: ["Abstract"],
      providers: ["Europe PMC"]
    });

    expect(receivedFilters).toEqual({
      types: ["Chemicals"],
      sections: ["Abstract"],
      providers: ["Europe PMC"]
    });
    expect(result).toMatchObject({
      article: {
        id: "pmcid:PMC3075991",
        publicationTypes: ["Journal Article"],
        isPreprint: false,
        isRetracted: false
      },
      source: "europe-pmc",
      total: 8,
      annotations: [{ text: "fluoride", type: "Chemicals", section: "Abstract" }]
    });
    expect(result.disclaimer).toContain("may be incomplete or incorrect");
  });

  it("reports when configured providers do not support article annotations", async () => {
    const service = new ResearchService({ providers: [pubmed] });
    await expect(service.annotations("pmid:123")).rejects.toThrow(
      "Article annotation lookup is not supported"
    );
  });

  it("ranks title matches ahead of broad provider results", async () => {
    const provider: ResearchProvider = {
      name: "pubmed",
      async search() {
        return [
          {
            title: "Global perspectives in Qigong research",
            identifiers: { pmid: "100" },
            providers: ["pubmed"]
          },
          {
            title: "Randomized controlled trial of exercise for knee osteoarthritis",
            identifiers: { pmid: "200" },
            providers: ["pubmed"]
          },
          {
            title: "Inflammatory mechanisms in chronic musculoskeletal pain",
            identifiers: { pmid: "300" },
            providers: ["pubmed"]
          }
        ];
      },
      async fetch() {
        return null;
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.search(
      "randomised controlled trials of exercise for knee osteoarthritis published from 2020 onward",
      3
    );

    expect(result.results.map(({ id }) => id)).toEqual(["pmid:200", "pmid:100", "pmid:300"]);
  });

  it("follows a discovered PMCID to lawful full text", async () => {
    const service = new ResearchService({ providers: [pubmed, europePmc] });
    const result = await service.fetch("pmid:123");
    expect(result.id).toBe("pmcid:PMC456");
    expect(result.text).toBe("Lawfully available full text.");
    expect(Object.keys(result)).toEqual([
      "id",
      "title",
      "url",
      "metadata",
      "providerDiagnostics",
      "textInfo",
      "text"
    ]);
    expect(result.textInfo).toEqual({
      included: true,
      availableCharacters: 29,
      returnedCharacters: 29,
      truncated: false
    });
    expect(result.metadata).toMatchObject({
      isPreprint: false,
      isRetracted: false,
      isOpenAccess: true,
      license: "CC BY",
      textType: "lawful-full-text",
      providers: ["europe-pmc", "pubmed"]
    });
  });

  it("supports compact metadata-only and bounded-text article responses", async () => {
    const service = new ResearchService({ providers: [pubmed, europePmc] });

    const metadataOnly = await service.fetch("pmid:123", { includeText: false });
    expect(metadataOnly).not.toHaveProperty("text");
    expect(metadataOnly.metadata).toMatchObject({
      identifiers: { pmid: "123", pmcid: "PMC456", doi: "10.1000/trial" },
      textType: "lawful-full-text",
      fullTextStatus: "retrieved"
    });
    expect(metadataOnly.providerDiagnostics.contributed).toEqual(["europe-pmc", "pubmed"]);
    expect(metadataOnly.textInfo).toEqual({
      included: false,
      availableCharacters: 29,
      returnedCharacters: 0,
      truncated: false
    });

    const bounded = await service.fetch("pmid:123", { textLimit: 10 });
    expect(bounded.text).toBe("Lawfully a");
    expect(bounded.textInfo).toEqual({
      included: true,
      availableCharacters: 29,
      returnedCharacters: 10,
      truncated: true
    });
  });

  it("follows a DOI discovered from a PMID for Crossref and Unpaywall enrichment", async () => {
    const requested: string[] = [];
    const providers: ResearchProvider[] = [
      {
        name: "pubmed",
        async search() {
          return [];
        },
        async fetch(identifier) {
          requested.push(`pubmed:${identifier.type}`);
          if (identifier.type !== "pmid") return null;
          return {
            title: "Sleep and cognition",
            authors: ["Spencer R"],
            abstract: "A structured abstract.",
            identifiers: { pmid: "123", doi: "10.1000/sleep" },
            providers: ["pubmed"]
          };
        }
      },
      {
        name: "europe-pmc",
        async search() {
          return [];
        },
        async fetch(identifier) {
          requested.push(`europe-pmc:${identifier.type}`);
          return null;
        }
      },
      {
        name: "crossref",
        async search() {
          return [];
        },
        async fetch(identifier) {
          requested.push(`crossref:${identifier.type}`);
          if (identifier.type !== "doi") return null;
          return {
            title: "Sleep and cognition",
            authors: ["Rebecca Spencer"],
            license: "https://creativecommons.org/licenses/by/4.0/",
            citationCount: 12,
            identifiers: { doi: identifier.value },
            providers: ["crossref"]
          };
        }
      },
      {
        name: "unpaywall",
        async search() {
          return [];
        },
        async fetch(identifier) {
          requested.push(`unpaywall:${identifier.type}`);
          if (identifier.type !== "doi") return null;
          return {
            title: "Sleep and cognition",
            pdfUrl: "https://publisher.example/article.pdf",
            isOpenAccess: true,
            identifiers: { doi: identifier.value },
            providers: ["unpaywall"]
          };
        }
      }
    ];
    const service = new ResearchService({ providers });

    const result = await service.fetch("pmid:123");

    expect(requested).toContain("crossref:doi");
    expect(requested).toContain("unpaywall:doi");
    expect(result.metadata).toMatchObject({
      authors: ["Rebecca Spencer"],
      license: "https://creativecommons.org/licenses/by/4.0/",
      pdfUrl: "https://publisher.example/article.pdf",
      citationCount: 12,
      isOpenAccess: true,
      textType: "abstract",
      fullTextStatus: "open-access-location"
    });
    expect(result.providerDiagnostics).toMatchObject({
      attempted: ["pubmed", "europe-pmc", "crossref", "unpaywall"],
      failed: [],
      partialFailure: false
    });
    expect(result.providerDiagnostics.contributed).toEqual(
      expect.arrayContaining(["pubmed", "crossref", "unpaywall"])
    );
    expect(result.providerDiagnostics.noRecord).toEqual(["europe-pmc"]);
  });

  it("distinguishes indexed full text from text actually retrieved", async () => {
    const provider: ResearchProvider = {
      name: "pubmed",
      async search() {
        return [];
      },
      async fetch(identifier) {
        if (identifier.type !== "pmid") return null;
        return {
          title: "Repository-indexed article",
          abstract: "The abstract remains usable.",
          identifiers: { pmid: "321", pmcid: "PMC321" },
          providers: ["pubmed"]
        };
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.fetch("pmid:321");

    expect(result.metadata).toMatchObject({
      textType: "abstract",
      fullTextStatus: "repository-indexed"
    });
  });

  it("labels metadata-only DOI records without claiming full text", async () => {
    const provider: ResearchProvider = {
      name: "crossref",
      async search() {
        return [];
      },
      async fetch(identifier) {
        if (identifier.type !== "doi") return null;
        return {
          title: "Paywalled metadata record",
          identifiers: { doi: identifier.value },
          providers: ["crossref"]
        };
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const result = await service.fetch("doi:10.1000/paywalled");

    expect(result.metadata).toMatchObject({
      textType: "metadata",
      fullTextStatus: "not-indicated"
    });
    expect(result.metadata).not.toHaveProperty("pdfUrl");
    expect(result.metadata).not.toHaveProperty("fullTextUrl");
  });

  it("reports provider partial failures without exposing raw upstream errors", async () => {
    const healthy: ResearchProvider = {
      name: "pubmed",
      async search() {
        return [
          {
            title: "A resilient result",
            identifiers: { pmid: "555" },
            providers: ["pubmed"]
          }
        ];
      },
      async fetch() {
        return null;
      }
    };
    const unavailable: ResearchProvider = {
      name: "crossref",
      async search() {
        throw new UpstreamError(
          "crossref",
          "sensitive upstream diagnostic",
          429,
          "rate-limited",
          true
        );
      },
      async fetch() {
        return null;
      }
    };
    const service = new ResearchService({ providers: [healthy, unavailable] });

    const result = await service.search("resilient result");

    expect(result.providerDiagnostics).toEqual({
      attempted: ["pubmed", "crossref"],
      contributed: ["pubmed"],
      noRecord: [],
      failed: ["crossref"],
      failures: [{ provider: "crossref", reason: "rate-limited", status: 429 }],
      partialFailure: true
    });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream diagnostic");
  });

  it("returns a clear not-found error for an unresolvable DOI", async () => {
    const provider: ResearchProvider = {
      name: "crossref",
      async search() {
        return [];
      },
      async fetch() {
        return null;
      }
    };
    const service = new ResearchService({ providers: [provider] });

    await expect(service.fetch("doi:10.1000/missing")).rejects.toThrow(
      "No article was found for doi:10.1000/missing"
    );
  });

  it("returns explicit preprint and retraction warnings", async () => {
    const provider: ResearchProvider = {
      name: "pubmed",
      async search() {
        return [
          {
            title: "A preliminary treatment study",
            publicationTypes: ["Preprint"],
            isPreprint: true,
            identifiers: { pmid: "777" },
            providers: ["pubmed"]
          }
        ];
      },
      async fetch() {
        return {
          title: "RETRACTED: A preliminary treatment study",
          publicationTypes: ["Journal Article", "Retracted Publication"],
          isRetracted: true,
          abstract: "Withdrawn findings.",
          identifiers: { pmid: "777" },
          providers: ["pubmed"]
        };
      }
    };
    const service = new ResearchService({ providers: [provider] });

    const search = await service.search("preliminary treatment");
    expect(search.results[0]).toMatchObject({
      publicationTypes: ["Preprint"],
      isPreprint: true,
      isRetracted: false,
      statusWarnings: ["Preprint: this work may not have completed peer review."]
    });

    const article = await service.fetch("pmid:777");
    expect(article.metadata).toMatchObject({
      publicationTypes: ["Journal Article", "Retracted Publication"],
      isPreprint: false,
      isRetracted: true,
      statusWarnings: ["Retracted publication: do not treat this record as active evidence."]
    });
  });

  it("bounds concurrent provider operations", async () => {
    let active = 0;
    let maximumActive = 0;
    const providers = Array.from({ length: 6 }, (_, index): ResearchProvider => ({
      name: "pubmed",
      async search() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return [
          {
            title: `Study ${index}`,
            identifiers: { pmid: String(1_000 + index) },
            providers: ["pubmed"]
          }
        ];
      },
      async fetch() {
        return null;
      }
    }));

    const service = new ResearchService({ providers, maxProviderConcurrency: 2 });
    await service.search("bounded provider test");
    expect(maximumActive).toBe(2);
  });
});
