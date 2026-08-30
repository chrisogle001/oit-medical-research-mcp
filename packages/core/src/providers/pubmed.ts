import { fetchJson, fetchText } from "../http.js";
import { attributeTagValue, firstTag, tagBlock, tagBlocks, xmlToText } from "../xml.js";
import {
  hasPublicationType,
  humanizePublicationType,
  normalizePublicationTypes,
  titleIndicatesRetraction
} from "../publication-status.js";
import type {
  CanonicalIdentifier,
  ProviderContext,
  ResearchProvider,
  ResearchRecord,
  SearchFilters
} from "../types.js";

interface PubMedSearchPayload {
  esearchresult?: { idlist?: string[] };
}

interface PubMedSummaryItem {
  uid?: string;
  title?: string;
  pubdate?: string;
  fulljournalname?: string;
  authors?: Array<{ name?: string }>;
  articleids?: Array<{ idtype?: string; value?: string }>;
  pubtype?: string[];
}

interface PubMedSummaryPayload {
  result?: Record<string, PubMedSummaryItem | string[]> & { uids?: string[] };
}

export class PubMedProvider implements ResearchProvider {
  readonly name = "pubmed" as const;

  constructor(private readonly context: ProviderContext) {}

  async search(query: string, limit: number, filters: SearchFilters = {}): Promise<ResearchRecord[]> {
    const searchParams: Record<string, string> = {
      db: "pubmed",
      retmode: "json",
      retmax: String(limit),
      sort: "relevance",
      term: pubMedSearchQuery(query, filters)
    };
    if (filters.fromYear !== undefined || filters.toYear !== undefined) {
      searchParams.datetype = "pdat";
      searchParams.mindate = String(filters.fromYear ?? 1800);
      searchParams.maxdate = String(filters.toYear ?? 2100);
    }
    const searchUrl = this.url("esearch.fcgi", searchParams);
    const search = await fetchJson<PubMedSearchPayload>(this.context.fetch, this.name, searchUrl);
    const ids = search.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = this.url("esummary.fcgi", {
      db: "pubmed",
      retmode: "json",
      id: ids.join(",")
    });
    const payload = await fetchJson<PubMedSummaryPayload>(this.context.fetch, this.name, summaryUrl);
    const result = payload.result ?? {};
    const orderedIds = result.uids ?? ids;

    return orderedIds.flatMap((id) => {
      const item = result[id];
      if (!item || Array.isArray(item)) return [];
      const articleIds = Object.fromEntries(
        (item.articleids ?? [])
          .filter((entry) => entry.idtype && entry.value)
          .map((entry) => [entry.idtype!.toLowerCase(), entry.value!])
      );
      const pmid = articleIds.pubmed ?? articleIds.pmid ?? item.uid ?? id;
      const publicationTypes = normalizePublicationTypes(item.pubtype ?? []);
      const title = xmlToText(item.title ?? "Untitled PubMed article");
      const isPreprint = hasPublicationType(publicationTypes, "Preprint");
      const isRetracted =
        hasPublicationType(publicationTypes, "Retracted Publication") ||
        titleIndicatesRetraction(title);
      return [
        {
          title,
          authors: (item.authors ?? []).flatMap((author) => (author.name ? [author.name] : [])),
          ...(publicationTypes.length ? { publicationTypes } : {}),
          ...(isPreprint ? { isPreprint: true } : {}),
          ...(isRetracted ? { isRetracted: true } : {}),
          identifiers: {
            pmid,
            ...(articleIds.pmc ? { pmcid: articleIds.pmc.toUpperCase() } : {}),
            ...(articleIds.doi ? { doi: articleIds.doi } : {})
          },
          ...(item.fulljournalname ? { journal: item.fulljournalname } : {}),
          ...(item.pubdate ? { publicationDate: item.pubdate } : {}),
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          providers: [this.name]
        }
      ];
    });
  }

  async fetch(identifier: CanonicalIdentifier): Promise<ResearchRecord | null> {
    if (identifier.type === "pmcid") return this.fetchPmc(identifier.value);
    if (identifier.type !== "pmid") return null;

    const url = this.url("efetch.fcgi", {
      db: "pubmed",
      id: identifier.value,
      rettype: "abstract",
      retmode: "xml"
    });
    const xml = await fetchText(this.context.fetch, this.name, url);
    const article = tagBlock(xml, "PubmedArticle");
    if (!article) return null;

    const authors = tagBlocks(article, "Author").flatMap((author) => {
      const collective = firstTag(author, "CollectiveName");
      if (collective) return [collective];
      const name = [firstTag(author, "ForeName"), firstTag(author, "LastName")].filter(Boolean).join(" ");
      return name ? [name] : [];
    });
    const abstract = tagBlocks(article, "AbstractText").map(xmlToText).filter(Boolean).join("\n\n");
    const doi = attributeTagValue(article, "ArticleId", "IdType", "doi");
    const pmcid = attributeTagValue(article, "ArticleId", "IdType", "pmc")?.toUpperCase();
    const year = firstTag(tagBlock(article, "PubDate") ?? "", "Year") ?? firstTag(article, "MedlineDate");
    const journal = firstTag(tagBlock(article, "Journal") ?? "", "Title");
    const publicationTypes = normalizePublicationTypes(
      tagBlocks(article, "PublicationType").map(xmlToText)
    );
    const title = firstTag(article, "ArticleTitle") ?? "Untitled PubMed article";
    const isPreprint = hasPublicationType(publicationTypes, "Preprint");
    const isRetracted =
      hasPublicationType(publicationTypes, "Retracted Publication") ||
      /<CommentsCorrections\b[^>]*\bRefType=["']RetractionIn["']/i.test(article) ||
      titleIndicatesRetraction(title);

    return {
      title,
      ...(authors.length ? { authors } : {}),
      ...(publicationTypes.length ? { publicationTypes } : {}),
      ...(isPreprint ? { isPreprint: true } : {}),
      ...(isRetracted ? { isRetracted: true } : {}),
      ...(abstract ? { abstract } : {}),
      ...(journal ? { journal } : {}),
      ...(year ? { publicationDate: year } : {}),
      identifiers: {
        pmid: identifier.value,
        ...(pmcid ? { pmcid } : {}),
        ...(doi ? { doi } : {})
      },
      url: `https://pubmed.ncbi.nlm.nih.gov/${identifier.value}/`,
      providers: [this.name]
    };
  }

  private async fetchPmc(pmcid: string): Promise<ResearchRecord | null> {
    const url = this.url("efetch.fcgi", {
      db: "pmc",
      id: pmcid,
      rettype: "full",
      retmode: "xml"
    });
    const xml = await fetchText(this.context.fetch, this.name, url);
    const article = tagBlock(xml, "article") ?? xml;
    const body = tagBlock(article, "body");
    if (!body) return null;

    const pmid = attributeTagValue(article, "article-id", "pub-id-type", "pmid");
    const doi = attributeTagValue(article, "article-id", "pub-id-type", "doi");
    const licenseUrl = /<license[^>]+(?:xlink:href|href)=["']([^"']+)/i.exec(article)?.[1];
    const abstract = firstTag(article, "abstract");
    const journal = firstTag(article, "journal-title");
    const authors = tagBlocks(article, "contrib")
      .map((contrib) => [firstTag(contrib, "given-names"), firstTag(contrib, "surname")].filter(Boolean).join(" "))
      .filter(Boolean);
    const articleType = /<article\b[^>]*\barticle-type=["']([^"']+)/i.exec(article)?.[1];
    const publicationTypes = normalizePublicationTypes(
      articleType ? [humanizePublicationType(articleType)] : []
    );
    const title = firstTag(article, "article-title") ?? "Untitled PMC article";
    const isPreprint =
      articleType?.trim().toLowerCase() === "preprint" ||
      hasPublicationType(publicationTypes, "Preprint");
    const isRetracted = titleIndicatesRetraction(title);

    return {
      title,
      ...(authors.length ? { authors } : {}),
      ...(publicationTypes.length ? { publicationTypes } : {}),
      ...(isPreprint ? { isPreprint: true } : {}),
      ...(isRetracted ? { isRetracted: true } : {}),
      ...(abstract ? { abstract } : {}),
      fullText: xmlToText(body),
      ...(journal ? { journal } : {}),
      identifiers: {
        pmcid: pmcid.toUpperCase(),
        ...(pmid ? { pmid } : {}),
        ...(doi ? { doi } : {})
      },
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid.toUpperCase()}/`,
      fullTextUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid.toUpperCase()}/`,
      ...(licenseUrl ? { license: licenseUrl } : {}),
      isOpenAccess: true,
      providers: [this.name]
    };
  }

  private url(path: string, params: Record<string, string>): URL {
    const url = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("tool", "oit-medical-research-mcp");
    url.searchParams.set("email", this.context.contactEmail);
    if (this.context.ncbiApiKey) url.searchParams.set("api_key", this.context.ncbiApiKey);
    return url;
  }
}

function pubMedSearchQuery(query: string, filters: SearchFilters): string {
  const clauses = [`(${query})`];
  if (filters.journals?.length) {
    clauses.push(
      `(${filters.journals.map((journal) => `"${fieldPhrase(journal)}"[Journal]`).join(" OR ")})`
    );
  }
  if (filters.fullTextOnly) clauses.push('"pubmed pmc"[sb]');
  return clauses.join(" AND ");
}

function fieldPhrase(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}
