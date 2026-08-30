export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ProviderName = "pubmed" | "europe-pmc" | "crossref" | "unpaywall";

export interface CanonicalIdentifier {
  type: "pmid" | "pmcid" | "doi" | "epmc";
  value: string;
  source?: string;
}

export interface ArticleIdentifiers {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  epmcSource?: string;
  epmcId?: string;
}

export interface ResearchRecord {
  title: string;
  authors?: string[];
  abstract?: string;
  fullText?: string;
  journal?: string;
  publicationDate?: string;
  identifiers: ArticleIdentifiers;
  url?: string;
  fullTextUrl?: string;
  pdfUrl?: string;
  license?: string;
  isOpenAccess?: boolean;
  citationCount?: number;
  providers: ProviderName[];
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  identifiers: ArticleIdentifiers;
  providers: ProviderName[];
  authors?: string[];
  journal?: string;
  publicationDate?: string;
  isOpenAccess?: boolean;
  fullTextAvailable: boolean;
  citationCount?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface FetchResponse {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, unknown>;
}

export interface ProviderContext {
  fetch: FetchLike;
  contactEmail: string;
  ncbiApiKey?: string;
}

export interface SearchFilters {
  fromYear?: number;
  toYear?: number;
  journals?: string[];
  fullTextOnly?: boolean;
}

export interface ResearchProvider {
  readonly name: ProviderName;
  search(query: string, limit: number, filters?: SearchFilters): Promise<ResearchRecord[]>;
  fetch(identifier: CanonicalIdentifier): Promise<ResearchRecord | null>;
}

export interface ResearchServiceOptions {
  fetch?: FetchLike;
  contactEmail?: string;
  ncbiApiKey?: string;
  providers?: ResearchProvider[];
  maxResults?: number;
  maxTextCharacters?: number;
  maxProviderConcurrency?: number;
}
