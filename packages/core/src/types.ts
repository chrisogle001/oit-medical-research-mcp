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
  publicationTypes?: string[];
  isPreprint?: boolean;
  isRetracted?: boolean;
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
  publicationTypes?: string[];
  isPreprint: boolean;
  isRetracted: boolean;
  statusWarnings?: string[];
  journal?: string;
  publicationDate?: string;
  isOpenAccess?: boolean;
  fullTextAvailable: boolean;
  citationCount?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export type CitationDirection = "references" | "citedBy";

export interface CitationProviderResponse {
  article: ResearchRecord;
  total: number;
  records: ResearchRecord[];
}

export interface CitationResponse {
  article: SearchResult;
  direction: CitationDirection;
  total: number;
  results: SearchResult[];
}

export interface AnnotationTag {
  name: string;
  uri?: string;
}

export interface ResearchAnnotation {
  text: string;
  type: string;
  section?: string;
  sectionUri?: string;
  provider?: string;
  prefix?: string;
  postfix?: string;
  tags: AnnotationTag[];
  url?: string;
}

export interface AnnotationFilters {
  types?: string[];
  sections?: string[];
  providers?: string[];
}

export interface AnnotationProviderResponse {
  article: ResearchRecord;
  total: number;
  annotations: ResearchAnnotation[];
}

export interface AnnotationResponse {
  article: SearchResult;
  source: "europe-pmc";
  total: number;
  annotations: ResearchAnnotation[];
  disclaimer: string;
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
  citations?(
    identifier: CanonicalIdentifier,
    direction: CitationDirection,
    limit: number
  ): Promise<CitationProviderResponse | null>;
  annotations?(
    identifier: CanonicalIdentifier,
    limit: number,
    filters?: AnnotationFilters
  ): Promise<AnnotationProviderResponse | null>;
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
