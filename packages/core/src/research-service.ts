import { canonicalId, canonicalUrl, parseIdentifier } from "./identifiers.js";
import { deduplicateRecords, mergeRecords } from "./records.js";
import { CrossrefProvider } from "./providers/crossref.js";
import { EuropePmcProvider } from "./providers/europe-pmc.js";
import { PubMedProvider } from "./providers/pubmed.js";
import { UnpaywallProvider } from "./providers/unpaywall.js";
import type {
  FetchResponse,
  ProviderContext,
  ResearchProvider,
  ResearchRecord,
  ResearchServiceOptions,
  SearchResponse
} from "./types.js";

const DEFAULT_CONTACT_EMAIL = "research-api@ogleits.com";

export class ResearchService {
  private readonly providers: ResearchProvider[];
  private readonly maxResults: number;
  private readonly maxTextCharacters: number;

  constructor(options: ResearchServiceOptions = {}) {
    this.maxResults = options.maxResults ?? 10;
    this.maxTextCharacters = options.maxTextCharacters ?? 120_000;
    if (options.providers) {
      this.providers = options.providers;
      return;
    }
    const context: ProviderContext = {
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      contactEmail: options.contactEmail ?? DEFAULT_CONTACT_EMAIL,
      ...(options.ncbiApiKey ? { ncbiApiKey: options.ncbiApiKey } : {})
    };
    this.providers = [
      new PubMedProvider(context),
      new EuropePmcProvider(context),
      new CrossrefProvider(context),
      new UnpaywallProvider(context)
    ];
  }

  async search(query: string): Promise<SearchResponse> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) throw new Error("Enter a more specific medical research query.");
    const perProvider = Math.max(4, Math.ceil(this.maxResults / 2));
    const settled = await Promise.allSettled(
      this.providers.map((provider) => provider.search(normalizedQuery, perProvider))
    );
    const records = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (records.length === 0 && settled.every((result) => result.status === "rejected")) {
      throw new Error("The medical literature sources are temporarily unavailable.");
    }

    const results = deduplicateRecords(records)
      .filter(hasStableIdentifier)
      .slice(0, this.maxResults)
      .map((record) => ({
        id: canonicalId(record),
        title: record.title,
        url: canonicalUrl(record)
      }));
    return { results };
  }

  async fetch(id: string): Promise<FetchResponse> {
    const identifier = parseIdentifier(id);
    const firstPass = await this.fetchFromProviders(identifier);
    if (firstPass.length === 0) throw new Error(`No article was found for ${id}.`);

    let merged = mergeRecords(firstPass);
    if (merged.identifiers.pmcid && !merged.fullText) {
      const pmcPass = await this.fetchFromProviders({ type: "pmcid", value: merged.identifiers.pmcid });
      if (pmcPass.length) merged = mergeRecords([...firstPass, ...pmcPass]);
    }

    const text = (merged.fullText ?? merged.abstract ?? metadataSummary(merged)).slice(
      0,
      this.maxTextCharacters
    );
    const resolvedId = canonicalId(merged);
    const url = canonicalUrl(merged);

    return {
      id: resolvedId,
      title: merged.title,
      text,
      url,
      metadata: {
        identifiers: merged.identifiers,
        ...(merged.authors ? { authors: merged.authors } : {}),
        ...(merged.journal ? { journal: merged.journal } : {}),
        ...(merged.publicationDate ? { publicationDate: merged.publicationDate } : {}),
        ...(merged.license ? { license: merged.license } : {}),
        ...(merged.isOpenAccess !== undefined ? { isOpenAccess: merged.isOpenAccess } : {}),
        ...(merged.fullTextUrl ? { fullTextUrl: merged.fullTextUrl } : {}),
        ...(merged.pdfUrl ? { pdfUrl: merged.pdfUrl } : {}),
        ...(merged.citationCount !== undefined ? { citationCount: merged.citationCount } : {}),
        providers: merged.providers,
        retrievedAt: new Date().toISOString(),
        textType: merged.fullText ? "lawful-full-text" : merged.abstract ? "abstract" : "metadata"
      }
    };
  }

  private async fetchFromProviders(identifier: Parameters<ResearchProvider["fetch"]>[0]): Promise<ResearchRecord[]> {
    const settled = await Promise.allSettled(this.providers.map((provider) => provider.fetch(identifier)));
    return settled.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : []
    );
  }
}

function hasStableIdentifier(record: ResearchRecord): boolean {
  const ids = record.identifiers;
  return Boolean(ids.pmcid || ids.pmid || ids.doi || (ids.epmcSource && ids.epmcId));
}

function metadataSummary(record: ResearchRecord): string {
  return [
    record.title,
    record.authors?.length ? `Authors: ${record.authors.join(", ")}` : undefined,
    record.journal ? `Journal: ${record.journal}` : undefined,
    record.publicationDate ? `Published: ${record.publicationDate}` : undefined,
    record.fullTextUrl ? `Lawful full-text location: ${record.fullTextUrl}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
