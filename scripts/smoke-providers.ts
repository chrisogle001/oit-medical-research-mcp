import { CrossrefProvider } from "../packages/core/src/providers/crossref.js";
import { EuropePmcProvider } from "../packages/core/src/providers/europe-pmc.js";
import { PubMedProvider } from "../packages/core/src/providers/pubmed.js";
import { UnpaywallProvider } from "../packages/core/src/providers/unpaywall.js";
import type { ProviderContext, ResearchRecord } from "../packages/core/src/types.js";

const fixture = {
  doi: "10.1056/nejmoa2021436",
  pmcid: "PMC7383595",
  pmid: "32678530",
  title: "Dexamethasone in Hospitalized Patients with Covid-19"
} as const;

const retractedFixture = {
  doi: "10.1016/s0140-6736(20)31180-6",
  pmid: "32450107"
} as const;

const context: ProviderContext = {
  fetch: globalThis.fetch.bind(globalThis),
  contactEmail: process.env.CONTACT_EMAIL?.trim() || "research-api@ogleits.com",
  ...(process.env.NCBI_API_KEY?.trim() ? { ncbiApiKey: process.env.NCBI_API_KEY.trim() } : {})
};

const pubmed = new PubMedProvider(context);
const europePmc = new EuropePmcProvider(context);
const crossref = new CrossrefProvider(context);
const unpaywall = new UnpaywallProvider(context);
const checks: CheckResult[] = [];

await check("pubmed.search", async () => {
  const records = await pubmed.search(`${fixture.pmid}[PMID]`, 3);
  const match = findByPmid(records);
  assert(match, "The fixture PMID was not returned.");
  assert((match.publicationTypes?.length ?? 0) > 0, "PubMed search omitted publication types.");
  return {
    results: records.length,
    matchedPmid: match.identifiers.pmid,
    matchedDoi: normalizeDoi(match.identifiers.doi),
    matchedPmcid: match.identifiers.pmcid
  };
});

await pause(500);

await check("pubmed.fetch", async () => {
  const record = await pubmed.fetch({ type: "pmid", value: fixture.pmid });
  assert(record, "The fixture PMID could not be fetched.");
  assert(record.identifiers.pmid === fixture.pmid, "The fetched PMID did not match.");
  assert(normalizeDoi(record.identifiers.doi) === fixture.doi, "The fetched DOI did not match.");
  assert(record.identifiers.pmcid === fixture.pmcid, "The fetched PMCID did not match.");
  assert((record.abstract?.length ?? 0) > 100, "The fetched PubMed record had no usable abstract.");
  assert((record.publicationTypes?.length ?? 0) > 0, "PubMed fetch omitted publication types.");
  return recordSummary(record);
});

await pause(500);

await check("pubmed.fetch-pmc", async () => {
  const record = await pubmed.fetch({ type: "pmcid", value: fixture.pmcid });
  assert(record, "The fixture PMCID could not be fetched through PubMed Central.");
  assert(record.identifiers.pmcid === fixture.pmcid, "The fetched PMCID did not match.");
  assert((record.fullText?.length ?? 0) > 1_000, "PubMed Central returned no usable full text.");
  assert(record.isOpenAccess === true, "The PubMed Central fixture was not marked open access.");
  assert(record.fullTextUrl, "The PubMed Central full-text location was missing.");
  return { ...recordSummary(record), capability: "europe-pmc-fallback" };
});

await check("europe-pmc.search", async () => {
  const records = await europePmc.search(`EXT_ID:${fixture.pmid} AND SRC:MED`, 3);
  const match = findByPmid(records);
  assert(match, "The fixture PMID was not returned.");
  assert((match.publicationTypes?.length ?? 0) > 0, "Europe PMC search omitted publication types.");
  return {
    results: records.length,
    matchedPmid: match.identifiers.pmid,
    matchedDoi: normalizeDoi(match.identifiers.doi),
    matchedPmcid: match.identifiers.pmcid
  };
});

await check("europe-pmc.fetch", async () => {
  const record = await europePmc.fetch({ type: "pmcid", value: fixture.pmcid });
  assert(record, "The fixture PMCID could not be fetched.");
  assert(record.identifiers.pmcid === fixture.pmcid, "The fetched PMCID did not match.");
  assert((record.fullText?.length ?? 0) > 1_000, "Europe PMC returned metadata but no usable full text.");
  assert(record.isOpenAccess === true, "The fixture was not marked open access.");
  assert(record.fullTextUrl, "The open full-text location was missing.");
  return recordSummary(record);
});

await check("europe-pmc.citations", async () => {
  const result = await europePmc.citations(
    { type: "pmid", value: fixture.pmid },
    "references",
    3
  );
  assert(result, "The fixture citation network could not be resolved.");
  assert(result.total >= 3, "Europe PMC returned an implausible reference count.");
  assert(result.records.length === 3, "Europe PMC did not return the requested reference records.");
  assert(
    result.records.every((record) => Boolean(record.identifiers.pmid || record.identifiers.epmcId)),
    "A reference record did not include a stable identifier."
  );
  return {
    direction: "references",
    total: result.total,
    returned: result.records.length,
    firstReferencePmid: result.records[0]?.identifiers.pmid
  };
});

await check("crossref.search", async () => {
  const records = await crossref.search(fixture.title, 5);
  assert(records.length > 0, "The title search returned no records.");
  const validRecords = records.filter(
    (record) =>
      Boolean(record.identifiers.doi) &&
      record.title.length > 10 &&
      record.providers.includes("crossref") &&
      Boolean(record.publicationTypes?.length)
  );
  assert(validRecords.length === records.length, "One or more search records lacked normalized Crossref metadata.");
  return {
    results: records.length,
    normalizedResults: validRecords.length,
    firstResultDoi: normalizeDoi(records[0]?.identifiers.doi)
  };
});

await check("crossref.fetch", async () => {
  const record = await crossref.fetch({ type: "doi", value: fixture.doi });
  assert(record, "The fixture DOI could not be fetched.");
  assert(normalizeDoi(record.identifiers.doi) === fixture.doi, "The fetched DOI did not match.");
  assert(record.title.length > 10, "The fetched Crossref record had no usable title.");
  assert((record.publicationTypes?.length ?? 0) > 0, "Crossref fetch omitted publication types.");
  return recordSummary(record);
});

await check("publication-status.retraction", async () => {
  const pubmedRecord = await pubmed.fetch({ type: "pmid", value: retractedFixture.pmid });
  assert(pubmedRecord?.isRetracted === true, "PubMed did not label the known retracted publication.");

  const europePmcRecords = await europePmc.search(
    `EXT_ID:${retractedFixture.pmid} AND SRC:MED`,
    1
  );
  assert(
    europePmcRecords[0]?.isRetracted === true,
    "Europe PMC did not label the known retracted publication."
  );

  const crossrefRecord = await crossref.fetch({ type: "doi", value: retractedFixture.doi });
  assert(
    crossrefRecord?.isRetracted === true,
    "Crossref did not label the known retracted publication."
  );
  return {
    pmid: retractedFixture.pmid,
    doi: retractedFixture.doi,
    pubmedPublicationTypes: pubmedRecord.publicationTypes,
    europePmcPublicationTypes: europePmcRecords[0]?.publicationTypes,
    crossrefPublicationTypes: crossrefRecord.publicationTypes
  };
});

await check("unpaywall.fetch", async () => {
  const record = await unpaywall.fetch({ type: "doi", value: fixture.doi });
  assert(record, "The fixture DOI could not be fetched.");
  assert(normalizeDoi(record.identifiers.doi) === fixture.doi, "The fetched DOI did not match.");
  assert(record.isOpenAccess === true, "The known open-access fixture was not marked open access.");
  assert(record.fullTextUrl, "The lawful open-access location was missing.");
  return {
    ...recordSummary(record),
    capability: "fetch-only"
  };
});

console.log(
  JSON.stringify(
    {
      fixture: { pmid: fixture.pmid, pmcid: fixture.pmcid, doi: fixture.doi },
      passed: checks.filter((result) => result.status === "passed").length,
      failed: checks.filter((result) => result.status === "failed").length,
      checks
    },
    null,
    2
  )
);

if (checks.some((result) => result.status === "failed")) process.exitCode = 1;

interface CheckResult {
  check: string;
  status: "passed" | "failed";
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

async function check(name: string, operation: () => Promise<Record<string, unknown>>): Promise<void> {
  const startedAt = performance.now();
  try {
    const details = await operation();
    checks.push({ check: name, status: "passed", durationMs: elapsed(startedAt), details });
  } catch (error) {
    checks.push({
      check: name,
      status: "failed",
      durationMs: elapsed(startedAt),
      error: error instanceof Error ? error.message : "Unknown provider error."
    });
  }
}

function recordSummary(record: ResearchRecord): Record<string, unknown> {
  return {
    titleCharacters: record.title.length,
    abstractCharacters: record.abstract?.length ?? 0,
    fullTextCharacters: record.fullText?.length ?? 0,
    pmid: record.identifiers.pmid,
    pmcid: record.identifiers.pmcid,
    doi: normalizeDoi(record.identifiers.doi),
    isOpenAccess: record.isOpenAccess,
    publicationTypes: record.publicationTypes,
    isPreprint: record.isPreprint === true,
    isRetracted: record.isRetracted === true,
    hasFullTextUrl: Boolean(record.fullTextUrl),
    hasPdfUrl: Boolean(record.pdfUrl),
    hasLicense: Boolean(record.license)
  };
}

function findByPmid(records: ResearchRecord[]): ResearchRecord | undefined {
  return records.find((record) => record.identifiers.pmid === fixture.pmid);
}

function normalizeDoi(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
}

function assert<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (!value) throw new Error(message);
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
