import type { CanonicalIdentifier, ResearchRecord } from "./types.js";

export function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

export function parseIdentifier(input: string): CanonicalIdentifier {
  const value = input.trim();
  if (!value) throw new Error("An article identifier is required.");

  const pubmedUrl = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(value);
  if (pubmedUrl?.[1]) return { type: "pmid", value: pubmedUrl[1] };

  const pmcUrl = /(?:ncbi\.nlm\.nih\.gov\/pmc\/articles\/|europepmc\.org\/article\/PMC\/)(PMC\d+)/i.exec(value);
  if (pmcUrl?.[1]) return { type: "pmcid", value: pmcUrl[1].toUpperCase() };

  if (/^pmid:\d+$/i.test(value)) return { type: "pmid", value: value.slice(5) };
  if (/^pmcid:PMC\d+$/i.test(value)) return { type: "pmcid", value: value.slice(6).toUpperCase() };
  if (/^PMC\d+$/i.test(value)) return { type: "pmcid", value: value.toUpperCase() };
  if (/^\d+$/.test(value)) return { type: "pmid", value };

  if (/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/|10\.\d{4,9}\/)/i.test(value)) {
    const doi = normalizeDoi(value);
    if (!/^10\.\d{4,9}\/.+/.test(doi)) throw new Error("The DOI is not valid.");
    return { type: "doi", value: doi };
  }

  const epmc = /^epmc:([^:]+):(.+)$/i.exec(value);
  if (epmc?.[1] && epmc[2]) {
    return { type: "epmc", source: epmc[1].toUpperCase(), value: epmc[2] };
  }

  throw new Error("Use a PMID, PMCID, DOI, supported article URL, or an ID returned by search.");
}

export function canonicalId(record: ResearchRecord): string {
  const { identifiers } = record;
  if (identifiers.pmcid) return `pmcid:${identifiers.pmcid.toUpperCase()}`;
  if (identifiers.pmid) return `pmid:${identifiers.pmid}`;
  if (identifiers.doi) return `doi:${normalizeDoi(identifiers.doi)}`;
  if (identifiers.epmcSource && identifiers.epmcId) {
    return `epmc:${identifiers.epmcSource}:${identifiers.epmcId}`;
  }
  throw new Error("The result does not include a stable article identifier.");
}

export function canonicalUrl(record: ResearchRecord): string {
  const { identifiers } = record;
  if (identifiers.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${identifiers.pmcid}/`;
  if (identifiers.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${identifiers.pmid}/`;
  if (identifiers.doi) return `https://doi.org/${normalizeDoi(identifiers.doi)}`;
  if (identifiers.epmcSource && identifiers.epmcId) {
    return `https://europepmc.org/article/${identifiers.epmcSource}/${identifiers.epmcId}`;
  }
  return record.url ?? "https://europepmc.org/";
}
