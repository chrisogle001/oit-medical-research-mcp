import { canonicalId, canonicalUrl, parseIdentifier } from "./identifiers.js";
import { UpstreamError } from "./http.js";
import { deduplicateRecords, mergeRecords } from "./records.js";
import { CrossrefProvider } from "./providers/crossref.js";
import { EuropePmcProvider } from "./providers/europe-pmc.js";
import { PubMedProvider } from "./providers/pubmed.js";
import { UnpaywallProvider } from "./providers/unpaywall.js";
import { researchStatusWarnings } from "./publication-status.js";
import type {
  AnnotationFilters,
  AnnotationResponse,
  CitationDirection,
  CitationResponse,
  FetchResponse,
  FetchOptions,
  FullTextStatus,
  ProviderContext,
  ProviderDiagnostics,
  ProviderFailure,
  ProviderName,
  ResearchProvider,
  ResearchRecord,
  ResearchServiceOptions,
  SearchFilters,
  SearchResponse
} from "./types.js";

const DEFAULT_CONTACT_EMAIL = "research-api@ogleits.com";
const MIN_PUBLICATION_YEAR = 1800;
const MAX_PUBLICATION_YEAR = 2100;
const ANNOTATION_DISCLAIMER =
  "Europe PMC annotations are automated or contributed text-mining signals. They may be incomplete or incorrect and are not validated clinical findings.";

interface ProviderAttempt<T> {
  provider: ProviderName;
  result: PromiseSettledResult<T>;
}

export class ResearchService {
  private readonly providers: ResearchProvider[];
  private readonly maxResults: number;
  private readonly maxTextCharacters: number;
  private readonly maxProviderConcurrency: number;

  constructor(options: ResearchServiceOptions = {}) {
    this.maxResults = options.maxResults ?? 10;
    this.maxTextCharacters = options.maxTextCharacters ?? 120_000;
    this.maxProviderConcurrency = positiveInteger(options.maxProviderConcurrency, 3);
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

  async search(
    query: string,
    requestedLimit?: number,
    filters: SearchFilters = {}
  ): Promise<SearchResponse> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) throw new Error("Enter a more specific medical research query.");
    if (normalizedQuery.length > 1_000) {
      throw new Error("The medical research query is too long.");
    }
    const normalizedFilters = normalizeSearchFilters(filters);
    const resultLimit = Math.min(this.maxResults, positiveInteger(requestedLimit, this.maxResults));
    const perProvider = Math.max(4, Math.ceil(resultLimit / 2));
    const attempts = await settleProviderOperations(
      this.providers,
      this.maxProviderConcurrency,
      (provider) => provider.search(normalizedQuery, perProvider, normalizedFilters)
    );
    const records = attempts.flatMap(({ result }) =>
      result.status === "fulfilled" ? result.value : []
    );
    if (records.length === 0 && attempts.every(({ result }) => result.status === "rejected")) {
      throw new Error("The medical literature sources are temporarily unavailable.");
    }

    const results = rankSearchRecords(
      deduplicateRecords(records).filter((record) => matchesSearchFilters(record, normalizedFilters)),
      normalizedQuery
    )
      .filter(hasStableIdentifier)
      .slice(0, resultLimit)
      .map(toSearchResult);
    return {
      results,
      providerDiagnostics: buildProviderDiagnostics(
        attempts,
        results.flatMap((result) => result.providers)
      )
    };
  }

  async citations(
    id: string,
    direction: CitationDirection,
    requestedLimit?: number
  ): Promise<CitationResponse> {
    if (id.length > 2_048) throw new Error("The article identifier is too long.");
    if (direction !== "references" && direction !== "citedBy") {
      throw new Error('Citation direction must be either "references" or "citedBy".');
    }
    const identifier = parseIdentifier(id);
    const resultLimit = Math.min(this.maxResults, positiveInteger(requestedLimit, this.maxResults));
    const providers = this.providers.filter((provider) => typeof provider.citations === "function");
    if (providers.length === 0) {
      throw new Error("Citation lookup is not supported by the configured literature sources.");
    }

    const attempts = await settleProviderOperations(
      providers,
      this.maxProviderConcurrency,
      (provider) => provider.citations!(identifier, direction, resultLimit)
    );
    const responses = attempts.flatMap(({ result }) =>
      result.status === "fulfilled" && result.value ? [result.value] : []
    );
    if (responses.length === 0 && attempts.every(({ result }) => result.status === "rejected")) {
      throw new Error("The citation network is temporarily unavailable.");
    }
    if (responses.length === 0) throw new Error(`No article was found for ${id}.`);

    const article = mergeRecords(responses.map((response) => response.article));
    const results = deduplicateRecords(responses.flatMap((response) => response.records))
      .filter(hasStableIdentifier)
      .slice(0, resultLimit)
      .map(toSearchResult);
    return {
      article: toSearchResult(article),
      direction,
      total: Math.max(...responses.map((response) => response.total), results.length),
      results,
      providerDiagnostics: buildProviderDiagnostics(attempts, article.providers)
    };
  }

  async annotations(
    id: string,
    requestedLimit?: number,
    filters: AnnotationFilters = {}
  ): Promise<AnnotationResponse> {
    if (id.length > 2_048) throw new Error("The article identifier is too long.");
    const identifier = parseIdentifier(id);
    const resultLimit = Math.min(100, positiveInteger(requestedLimit, 50));
    const normalizedFilters = normalizeAnnotationFilters(filters);
    const providers = this.providers.filter((provider) => typeof provider.annotations === "function");
    if (providers.length === 0) {
      throw new Error("Article annotation lookup is not supported by the configured literature sources.");
    }

    const attempts = await settleProviderOperations(
      providers,
      this.maxProviderConcurrency,
      (provider) => provider.annotations!(identifier, resultLimit, normalizedFilters)
    );
    const responses = attempts.flatMap(({ result }) =>
      result.status === "fulfilled" && result.value ? [result.value] : []
    );
    if (responses.length === 0 && attempts.every(({ result }) => result.status === "rejected")) {
      throw new Error("The Europe PMC annotation service is temporarily unavailable.");
    }
    if (responses.length === 0) throw new Error(`No article was found for ${id}.`);

    const article = mergeRecords(responses.map((response) => response.article));
    const annotations = responses
      .flatMap((response) => response.annotations)
      .slice(0, resultLimit);
    return {
      article: toSearchResult(article),
      source: "europe-pmc",
      total: Math.max(...responses.map((response) => response.total), annotations.length),
      annotations,
      disclaimer: ANNOTATION_DISCLAIMER,
      providerDiagnostics: buildProviderDiagnostics(attempts, article.providers)
    };
  }

  async fetch(id: string, options: FetchOptions = {}): Promise<FetchResponse> {
    if (id.length > 2_048) throw new Error("The article identifier is too long.");
    const identifier = parseIdentifier(id);
    const records: ResearchRecord[] = [];
    const attempts: Array<ProviderAttempt<ResearchRecord | null>> = [];
    const fetchedIdentifiers = new Set<string>();
    const followIdentifier = async (nextIdentifier: typeof identifier): Promise<void> => {
      const key = identifierKey(nextIdentifier);
      if (fetchedIdentifiers.has(key)) return;
      fetchedIdentifiers.add(key);
      const pass = await this.fetchFromProviders(nextIdentifier);
      attempts.push(...pass);
      records.push(
        ...pass.flatMap(({ result }) =>
          result.status === "fulfilled" && result.value ? [result.value] : []
        )
      );
    };

    await followIdentifier(identifier);
    if (records.length === 0) {
      if (attempts.every(({ result }) => result.status === "rejected")) {
        throw new Error("The medical literature sources are temporarily unavailable.");
      }
      throw new Error(`No article was found for ${id}.`);
    }

    let merged = mergeRecords(records);
    if (merged.identifiers.pmcid && !merged.fullText) {
      await followIdentifier({ type: "pmcid", value: merged.identifiers.pmcid });
      merged = mergeRecords(records);
    }
    if (merged.identifiers.doi) {
      await followIdentifier({ type: "doi", value: merged.identifiers.doi });
      merged = mergeRecords(records);
    }
    if (merged.identifiers.pmcid && !merged.fullText) {
      await followIdentifier({ type: "pmcid", value: merged.identifiers.pmcid });
      merged = mergeRecords(records);
    }

    const availableText = merged.fullText ?? merged.abstract ?? metadataSummary(merged);
    const includeText = options.includeText !== false;
    const textLimit = normalizeTextLimit(options.textLimit, this.maxTextCharacters);
    const text = includeText ? availableText.slice(0, textLimit) : undefined;
    const resolvedId = canonicalId(merged);
    const url = canonicalUrl(merged);
    const statusWarnings = researchStatusWarnings(merged);

    return {
      id: resolvedId,
      title: merged.title,
      url,
      metadata: {
        identifiers: merged.identifiers,
        ...(merged.authors ? { authors: merged.authors } : {}),
        ...(merged.publicationTypes ? { publicationTypes: merged.publicationTypes } : {}),
        isPreprint: merged.isPreprint === true,
        isRetracted: merged.isRetracted === true,
        ...(statusWarnings.length ? { statusWarnings } : {}),
        ...(merged.journal ? { journal: merged.journal } : {}),
        ...(merged.publicationDate ? { publicationDate: merged.publicationDate } : {}),
        ...(merged.license ? { license: merged.license } : {}),
        ...(merged.isOpenAccess !== undefined ? { isOpenAccess: merged.isOpenAccess } : {}),
        ...(merged.fullTextUrl ? { fullTextUrl: merged.fullTextUrl } : {}),
        ...(merged.pdfUrl ? { pdfUrl: merged.pdfUrl } : {}),
        ...(merged.citationCount !== undefined ? { citationCount: merged.citationCount } : {}),
        providers: merged.providers,
        retrievedAt: new Date().toISOString(),
        textType: merged.fullText ? "lawful-full-text" : merged.abstract ? "abstract" : "metadata",
        fullTextStatus: fullTextStatus(merged)
      },
      providerDiagnostics: buildProviderDiagnostics(attempts, merged.providers),
      textInfo: {
        included: includeText,
        availableCharacters: availableText.length,
        returnedCharacters: text?.length ?? 0,
        truncated: includeText && availableText.length > textLimit
      },
      ...(text !== undefined ? { text } : {})
    };
  }

  private async fetchFromProviders(
    identifier: Parameters<ResearchProvider["fetch"]>[0]
  ): Promise<Array<ProviderAttempt<ResearchRecord | null>>> {
    return settleProviderOperations(
      this.providers,
      this.maxProviderConcurrency,
      (provider) => provider.fetch(identifier)
    );
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeTextLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("textLimit must be a positive integer.");
  }
  return Math.min(value, maximum);
}

function normalizeSearchFilters(filters: SearchFilters): SearchFilters {
  const fromYear = optionalYear(filters.fromYear, "fromYear");
  const toYear = optionalYear(filters.toYear, "toYear");
  if (fromYear !== undefined && toYear !== undefined && fromYear > toYear) {
    throw new Error("fromYear must be less than or equal to toYear.");
  }

  const journals = [...new Set((filters.journals ?? []).map((journal) => journal.trim()).filter(Boolean))];
  if (journals.length > 5) throw new Error("Search can filter by at most five journals at a time.");
  if (journals.some((journal) => journal.length > 200)) {
    throw new Error("A journal name is too long.");
  }
  if (journals.some((journal) => !/[a-z0-9]/i.test(journal))) {
    throw new Error("Enter a valid journal name.");
  }

  return {
    ...(fromYear !== undefined ? { fromYear } : {}),
    ...(toYear !== undefined ? { toYear } : {}),
    ...(journals.length ? { journals } : {}),
    ...(filters.fullTextOnly === true ? { fullTextOnly: true } : {})
  };
}

function normalizeAnnotationFilters(filters: AnnotationFilters): AnnotationFilters {
  return {
    ...normalizedAnnotationFilterList(filters.types, "types"),
    ...normalizedAnnotationFilterList(filters.sections, "sections"),
    ...normalizedAnnotationFilterList(filters.providers, "providers")
  };
}

function normalizedAnnotationFilterList(
  values: string[] | undefined,
  key: keyof AnnotationFilters
): Partial<AnnotationFilters> {
  if (!values) return {};
  const normalized = [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()))].filter(
    Boolean
  );
  if (normalized.length > 5) throw new Error(`Annotation ${key} can contain at most five values.`);
  if (normalized.some((value) => value.length > 100 || !/[a-z0-9]/i.test(value))) {
    throw new Error(`Enter valid annotation ${key}.`);
  }
  return normalized.length ? { [key]: normalized } : {};
}

function optionalYear(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < MIN_PUBLICATION_YEAR || value > MAX_PUBLICATION_YEAR) {
    throw new Error(
      `${field} must be a year between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}.`
    );
  }
  return value;
}

function matchesSearchFilters(record: ResearchRecord, filters: SearchFilters): boolean {
  if (filters.fullTextOnly && !hasRepositoryFullText(record)) return false;

  if (filters.fromYear !== undefined || filters.toYear !== undefined) {
    const publicationYear = parsePublicationYear(record.publicationDate);
    if (publicationYear === undefined) return false;
    if (filters.fromYear !== undefined && publicationYear < filters.fromYear) return false;
    if (filters.toYear !== undefined && publicationYear > filters.toYear) return false;
  }

  if (filters.journals?.length) {
    if (!record.journal) return false;
    const recordJournal = normalizeJournalName(record.journal);
    if (!filters.journals.some((journal) => journalsMatch(recordJournal, normalizeJournalName(journal)))) {
      return false;
    }
  }

  return true;
}

function parsePublicationYear(value: string | undefined): number | undefined {
  const match = value?.match(/(?:^|\D)(1[89]\d{2}|20\d{2}|21\d{2})(?:\D|$)/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function normalizeJournalName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
  return JOURNAL_ALIASES.get(normalized) ?? normalized;
}

function journalsMatch(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

function hasRepositoryFullText(record: ResearchRecord): boolean {
  const status = fullTextStatus(record);
  return status === "retrieved" || status === "repository-indexed";
}

function fullTextStatus(record: ResearchRecord): FullTextStatus {
  if (record.fullText) return "retrieved";
  if (
    record.identifiers.pmcid ||
    isRepositoryUrl(record.fullTextUrl) ||
    isRepositoryUrl(record.pdfUrl)
  ) {
    return "repository-indexed";
  }
  if (record.fullTextUrl || record.pdfUrl) return "open-access-location";
  return "not-indicated";
}

function isRepositoryUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "pmc.ncbi.nlm.nih.gov" ||
      hostname === "www.ncbi.nlm.nih.gov" ||
      hostname === "europepmc.org" ||
      hostname === "www.ebi.ac.uk"
    );
  } catch {
    return false;
  }
}

function toSearchResult(record: ResearchRecord) {
  const statusWarnings = researchStatusWarnings(record);
  const textStatus = fullTextStatus(record);
  return {
    id: canonicalId(record),
    title: record.title,
    url: canonicalUrl(record),
    identifiers: record.identifiers,
    providers: record.providers,
    ...(record.authors?.length ? { authors: record.authors.slice(0, 12) } : {}),
    ...(record.publicationTypes?.length ? { publicationTypes: record.publicationTypes } : {}),
    isPreprint: record.isPreprint === true,
    isRetracted: record.isRetracted === true,
    ...(statusWarnings.length ? { statusWarnings } : {}),
    ...(record.journal ? { journal: record.journal } : {}),
    ...(record.publicationDate ? { publicationDate: record.publicationDate } : {}),
    ...(record.isOpenAccess !== undefined ? { isOpenAccess: record.isOpenAccess } : {}),
    fullTextAvailable: textStatus !== "not-indicated",
    fullTextStatus: textStatus,
    ...(record.citationCount !== undefined ? { citationCount: record.citationCount } : {})
  };
}

const JOURNAL_ALIASES = new Map([
  ["nejm", "new england journal of medicine"],
  ["n engl j med", "new england journal of medicine"],
  ["jcem", "journal of clinical endocrinology and metabolism"],
  ["j clin endocrinol metab", "journal of clinical endocrinology and metabolism"],
  ["the bmj", "bmj"]
]);

async function settleWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item) => Promise<Result>
): Promise<PromiseSettledResult<Result>[]> {
  const results = new Array<PromiseSettledResult<Result>>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = { status: "fulfilled", value: await operation(items[index]!) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function settleProviderOperations<Result>(
  providers: readonly ResearchProvider[],
  concurrency: number,
  operation: (provider: ResearchProvider) => Promise<Result>
): Promise<Array<ProviderAttempt<Result>>> {
  const results = await settleWithConcurrency(providers, concurrency, operation);
  return providers.map((provider, index) => ({
    provider: provider.name,
    result: results[index]!
  }));
}

function buildProviderDiagnostics<T>(
  attempts: Array<ProviderAttempt<T>>,
  contributedProviders: ProviderName[]
): ProviderDiagnostics {
  const attempted = uniqueProviderNames(attempts.map((attempt) => attempt.provider));
  const contributed = uniqueProviderNames(contributedProviders);
  const failed = uniqueProviderNames(
    attempts.flatMap((attempt) => (attempt.result.status === "rejected" ? [attempt.provider] : []))
  );
  const failures = attempts.flatMap((attempt) => providerFailure(attempt));
  const noRecord = attempted.filter(
    (provider) => !contributed.includes(provider) && !failed.includes(provider)
  );
  return {
    attempted,
    contributed,
    noRecord,
    failed,
    failures,
    partialFailure: failed.length > 0
  };
}

function providerFailure<T>(attempt: ProviderAttempt<T>): ProviderFailure[] {
  if (attempt.result.status !== "rejected") return [];
  const error = attempt.result.reason;
  if (error instanceof UpstreamError) {
    return [
      {
        provider: attempt.provider,
        reason: error.reason,
        ...(error.status !== undefined ? { status: error.status } : {})
      }
    ];
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return [{ provider: attempt.provider, reason: "timeout" }];
  }
  if (error instanceof SyntaxError) {
    return [{ provider: attempt.provider, reason: "invalid-response" }];
  }
  if (error instanceof TypeError) {
    return [{ provider: attempt.provider, reason: "network-error" }];
  }
  return [{ provider: attempt.provider, reason: "unknown" }];
}

function uniqueProviderNames(values: ProviderName[]): ProviderName[] {
  return [...new Set(values)];
}

function identifierKey(identifier: {
  type: string;
  value: string;
  source?: string;
}): string {
  return `${identifier.type}:${identifier.source ?? ""}:${identifier.value}`.toLowerCase();
}

function hasStableIdentifier(record: ResearchRecord): boolean {
  const ids = record.identifiers;
  return Boolean(ids.pmcid || ids.pmid || ids.doi || (ids.epmcSource && ids.epmcId));
}

const SEARCH_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "into",
  "onward",
  "published",
  "research",
  "study",
  "studies",
  "the",
  "with"
]);

function rankSearchRecords(records: ResearchRecord[], query: string): ResearchRecord[] {
  const queryTerms = relevanceTerms(query);
  if (queryTerms.length === 0) return records;

  return records
    .map((record, index) => ({
      index,
      record,
      score: searchRecordScore(record, queryTerms)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ record }) => record);
}

function searchRecordScore(record: ResearchRecord, queryTerms: string[]): number {
  const titleTerms = new Set(relevanceTerms(record.title));
  const abstractTerms = new Set(relevanceTerms(record.abstract ?? ""));
  const lexicalScore = queryTerms.reduce((score, term) => {
    if (titleTerms.has(term)) return score + 12 + Math.min(term.length, 12);
    if (abstractTerms.has(term)) return score + 3;
    return score;
  }, 0);
  const providerAgreement = Math.max(0, new Set(record.providers).size - 1) * 2;
  return lexicalScore + providerAgreement;
}

function relevanceTerms(value: string): string[] {
  const terms = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(terms.map(normalizeSearchTerm).filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term)))];
}

function normalizeSearchTerm(term: string): string {
  if (term === "randomised") return "randomized";
  if (term.endsWith("ies") && term.length > 5) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && term.length > 4 && !term.endsWith("sis") && !term.endsWith("itis")) {
    return term.slice(0, -1);
  }
  return term;
}

function metadataSummary(record: ResearchRecord): string {
  return [
    record.title,
    ...researchStatusWarnings(record),
    record.authors?.length ? `Authors: ${record.authors.join(", ")}` : undefined,
    record.journal ? `Journal: ${record.journal}` : undefined,
    record.publicationDate ? `Published: ${record.publicationDate}` : undefined,
    record.fullTextUrl ? `Lawful full-text location: ${record.fullTextUrl}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
