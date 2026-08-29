import { describe, expect, it } from "vitest";
import { normalizeDoi, parseIdentifier } from "@oit-medical-research/core";

describe("article identifiers", () => {
  it("normalizes DOI URLs", () => {
    expect(normalizeDoi("https://doi.org/10.1000/Example")).toBe("10.1000/example");
  });

  it("parses stable search IDs and supported URLs", () => {
    expect(parseIdentifier("pmid:12345")).toEqual({ type: "pmid", value: "12345" });
    expect(parseIdentifier("PMC12345")).toEqual({ type: "pmcid", value: "PMC12345" });
    expect(parseIdentifier("https://pubmed.ncbi.nlm.nih.gov/98765/")).toEqual({
      type: "pmid",
      value: "98765"
    });
  });

  it("rejects unrecognized IDs", () => {
    expect(() => parseIdentifier("not an article id")).toThrow(/PMID/);
  });
});
