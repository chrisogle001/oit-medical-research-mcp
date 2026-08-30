import { fetchJson, fetchText } from "../http.js";
import { normalizeDoi } from "../identifiers.js";
import {
  hasPublicationType,
  normalizePublicationTypes,
  titleIndicatesRetraction
} from "../publication-status.js";
import { firstTag, tagBlock, tagBlocks, xmlToText } from "../xml.js";
import type {
  CanonicalIdentifier,
  CitationDirection,
  CitationProviderResponse,
  ProviderContext,
  ResearchProvider,
  ResearchRecord,
  SearchFilters
} from "../types.js";

interface EuropePmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: Array<{ fullName?: string }> };
  journalTitle?: string;
  journalAbbreviation?: string;
  firstPublicationDate?: string;
  pubYear?: string | number;
  abstractText?: string;
  pubTypeList?: { pubType?: string[] };
  commentCorrectionList?: {
    commentCorrection?: Array<{ type?: string }>;
  };
  citedByCount?: number;
  isOpenAccess?: string | boolean;
  fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; availability?: string; documentStyle?: string }> };
}

interface EuropePmcPayload {
  resultList?: { result?: EuropePmcResult[] };
}

interface EuropePmcCitationPayload {
  hitCount?: number;
  referenceList?: { reference?: EuropePmcResult[] };
  citationList?: { citation?: EuropePmcResult[] };
}

export class EuropePmcProvider implements ResearchProvider {
  readonly name = "europe-pmc" as const;

  constructor(private readonly context: ProviderContext) {}

  async search(query: string, limit: number, filters: SearchFilters = {}): Promise<ResearchRecord[]> {
    const payload = await this.searchApi(europePmcSearchQuery(query, filters), limit, "core");
    return (payload.resultList?.result ?? []).map((result) => this.toRecord(result));
  }

  async fetch(identifier: CanonicalIdentifier): Promise<ResearchRecord | null> {
    const query = this.identifierQuery(identifier);
    if (!query) return null;
    const payload = await this.searchApi(query, 3, "core");
    const result = payload.resultList?.result?.[0];
    if (!result) return null;

    const record = this.toRecord(result);
    const pmcid = record.identifiers.pmcid;
    if (!pmcid) return record;

    try {
      const fullTextUrl = new URL(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`
      );
      fullTextUrl.searchParams.set("email", this.context.contactEmail);
      const xml = await fetchText(this.context.fetch, this.name, fullTextUrl, {
        timeoutMs: 10_000,
        maxAttempts: 1
      });
      const body = tagBlock(xml, "body");
      if (body) {
        record.fullText = xmlToText(body);
        const abstract = firstTag(xml, "abstract");
        if (!record.abstract && abstract) record.abstract = abstract;
        record.fullTextUrl = `https://europepmc.org/articles/${pmcid}`;
        record.isOpenAccess = true;
        const license = firstTag(tagBlock(xml, "license") ?? "", "license-p");
        if (license) record.license = license;
      }
    } catch {
      // Metadata remains useful when a record is indexed but full text is unavailable.
    }
    return record;
  }

  async citations(
    identifier: CanonicalIdentifier,
    direction: CitationDirection,
    limit: number
  ): Promise<CitationProviderResponse | null> {
    const query = this.identifierQuery(identifier);
    if (!query) return null;
    const resolved = (await this.searchApi(query, 1, "core")).resultList?.result?.[0];
    if (!resolved?.source || !resolved.id) return null;

    const endpoint = direction === "references" ? "references" : "citations";
    const url = new URL(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(
        resolved.source.toUpperCase()
      )}/${encodeURIComponent(resolved.id)}/${endpoint}`
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("pageSize", String(limit));
    url.searchParams.set("email", this.context.contactEmail);
    const payload = await fetchJson<EuropePmcCitationPayload>(this.context.fetch, this.name, url, {
      timeoutMs: 10_000,
      maxAttempts: 1
    });
    const results =
      direction === "references"
        ? payload.referenceList?.reference ?? []
        : payload.citationList?.citation ?? [];

    return {
      article: this.toRecord(resolved),
      total: payload.hitCount ?? results.length,
      records: results.map((result) => this.toRecord(result))
    };
  }

  private async searchApi(query: string, pageSize: number, resultType: "lite" | "core"): Promise<EuropePmcPayload> {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.searchParams.set("query", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("resultType", resultType);
    url.searchParams.set("email", this.context.contactEmail);
    return fetchJson<EuropePmcPayload>(this.context.fetch, this.name, url, {
      timeoutMs: 10_000,
      maxAttempts: 1
    });
  }

  private identifierQuery(identifier: CanonicalIdentifier): string | null {
    switch (identifier.type) {
      case "pmid":
        return `EXT_ID:${identifier.value} AND SRC:MED`;
      case "pmcid":
        return `PMCID:${identifier.value}`;
      case "doi":
        return `DOI:\"${normalizeDoi(identifier.value)}\"`;
      case "epmc":
        return `EXT_ID:${identifier.value}${identifier.source ? ` AND SRC:${identifier.source}` : ""}`;
    }
  }

  private toRecord(result: EuropePmcResult): ResearchRecord {
    const source = result.source?.toUpperCase();
    const id = result.id;
    const urls = result.fullTextUrlList?.fullTextUrl ?? [];
    const pdf = urls.find((entry) => entry.documentStyle?.toLowerCase() === "pdf")?.url;
    const fullText = urls.find((entry) => entry.availability?.toLowerCase().includes("free"))?.url;
    const authors =
      result.authorList?.author?.flatMap((author) => (author.fullName ? [author.fullName] : [])) ??
      result.authorString?.split(/,\s*/).filter(Boolean);
    const pmid = result.pmid ?? (source === "MED" ? id : undefined);
    const pmcid = result.pmcid ?? (source === "PMC" && id ? id : undefined);
    const publicationTypes = normalizePublicationTypes(result.pubTypeList?.pubType ?? []);
    const isPreprint = source === "PPR" || hasPublicationType(publicationTypes, "Preprint");
    const isRetracted =
      hasPublicationType(publicationTypes, "Retracted Publication") ||
      (result.commentCorrectionList?.commentCorrection ?? []).some(
        (correction) => correction.type?.trim().toLowerCase() === "retraction in"
      ) ||
      titleIndicatesRetraction(result.title);

    return {
      title: xmlToText(result.title ?? "Untitled Europe PMC article"),
      ...(authors?.length ? { authors } : {}),
      ...(publicationTypes.length ? { publicationTypes } : {}),
      ...(isPreprint ? { isPreprint: true } : {}),
      ...(isRetracted ? { isRetracted: true } : {}),
      ...(result.abstractText ? { abstract: xmlToText(result.abstractText) } : {}),
      ...(result.journalTitle || result.journalAbbreviation
        ? { journal: result.journalTitle ?? result.journalAbbreviation }
        : {}),
      ...(result.firstPublicationDate || result.pubYear
        ? { publicationDate: String(result.firstPublicationDate ?? result.pubYear) }
        : {}),
      identifiers: {
        ...(pmid ? { pmid } : {}),
        ...(pmcid ? { pmcid: pmcid.toUpperCase() } : {}),
        ...(result.doi ? { doi: normalizeDoi(result.doi) } : {}),
        ...(source ? { epmcSource: source } : {}),
        ...(id ? { epmcId: id } : {})
      },
      ...(source && id ? { url: `https://europepmc.org/article/${source}/${id}` } : {}),
      ...(fullText ? { fullTextUrl: fullText } : {}),
      ...(pdf ? { pdfUrl: pdf } : {}),
      ...(result.isOpenAccess === "Y" || result.isOpenAccess === true ? { isOpenAccess: true } : {}),
      ...(result.citedByCount !== undefined ? { citationCount: result.citedByCount } : {}),
      providers: [this.name]
    };
  }
}

function europePmcSearchQuery(query: string, filters: SearchFilters): string {
  const clauses = [`(${query})`];
  if (filters.fromYear !== undefined || filters.toYear !== undefined) {
    const fromDate = `${filters.fromYear ?? 1800}-01-01`;
    const toDate = `${filters.toYear ?? 2100}-12-31`;
    clauses.push(`FIRST_PDATE:[${fromDate} TO ${toDate}]`);
  }
  if (filters.journals?.length) {
    clauses.push(
      `(${filters.journals.map((journal) => `JOURNAL:"${fieldPhrase(journal)}"`).join(" OR ")})`
    );
  }
  if (filters.fullTextOnly) clauses.push("IN_PMC:Y");
  return clauses.join(" AND ");
}

function fieldPhrase(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}
