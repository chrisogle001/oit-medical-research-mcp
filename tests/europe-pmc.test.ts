import { describe, expect, it, vi } from "vitest";
import { EuropePmcProvider } from "../packages/core/src/providers/europe-pmc.js";
import type { FetchLike } from "../packages/core/src/types.js";

describe("EuropePmcProvider", () => {
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
});
