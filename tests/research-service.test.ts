import { describe, expect, it } from "vitest";
import { ResearchService, type ResearchProvider } from "@oit-medical-research/core";

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
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC456/"
        }
      ]
    });
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

  it("follows a discovered PMCID to lawful full text", async () => {
    const service = new ResearchService({ providers: [pubmed, europePmc] });
    const result = await service.fetch("pmid:123");
    expect(result.id).toBe("pmcid:PMC456");
    expect(result.text).toBe("Lawfully available full text.");
    expect(result.metadata).toMatchObject({
      isOpenAccess: true,
      license: "CC BY",
      textType: "lawful-full-text",
      providers: ["europe-pmc", "pubmed"]
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
