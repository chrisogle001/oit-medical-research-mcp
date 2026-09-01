export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type ProviderName = "pubmed" | "europe-pmc" | "crossref" | "unpaywall";

export type ProviderFailureReason =
  | "rate-limited"
  | "timeout"
  | "network-error"
  | "invalid-response"
  | "upstream-error"
  | "unknown";

export interface ProviderFailure {
  provider: ProviderName;
  reason: ProviderFailureReason;
  status?: number;
}

export type FullTextStatus =
  | "retrieved"
  | "repository-indexed"
  | "open-access-location"
  | "not-indicated";

export interface ProviderDiagnostics {
  attempted: ProviderName[];
  contributed: ProviderName[];
  noRecord: ProviderName[];
  failed: ProviderName[];
  failures: ProviderFailure[];
  partialFailure: boolean;
}

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
  fullTextStatus: FullTextStatus;
  citationCount?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  providerDiagnostics: ProviderDiagnostics;
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
  providerDiagnostics: ProviderDiagnostics;
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
  providerDiagnostics: ProviderDiagnostics;
}

export interface FetchResponse {
  id: string;
  title: string;
  url: string;
  metadata: FetchMetadata;
  providerDiagnostics: ProviderDiagnostics;
  textInfo: FetchTextInfo;
  text?: string;
}

export interface FetchTextInfo {
  included: boolean;
  availableCharacters: number;
  returnedCharacters: number;
  truncated: boolean;
}

export interface FetchOptions {
  includeText?: boolean;
  textLimit?: number;
}

export interface FetchMetadata {
  identifiers: ArticleIdentifiers;
  authors?: string[];
  publicationTypes?: string[];
  isPreprint: boolean;
  isRetracted: boolean;
  statusWarnings?: string[];
  journal?: string;
  publicationDate?: string;
  license?: string;
  isOpenAccess?: boolean;
  fullTextUrl?: string;
  pdfUrl?: string;
  citationCount?: number;
  providers: ProviderName[];
  retrievedAt: string;
  textType: "lawful-full-text" | "abstract" | "metadata";
  fullTextStatus: FullTextStatus;
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

export type CmsFilterOperator = "equals" | "contains";

export interface CmsDatasetFilter {
  field: string;
  operator: CmsFilterOperator;
  value: string;
}

export interface CmsDatasetSummary {
  datasetId: string;
  title: string;
  description?: string;
  themes?: string[];
  keywords?: string[];
  modified?: string;
  temporal?: string;
  landingPage?: string;
  license?: string;
  apiUrl: string;
  resourcesUrl?: string;
}

export interface CmsDatasetSearchResponse {
  source: "data.cms.gov";
  resultCount: number;
  totalMatches: number;
  totalCatalogDatasets: number;
  results: CmsDatasetSummary[];
}

export type CmsDatasetValue = string | number | boolean | null;
export type CmsDatasetRow = Record<string, CmsDatasetValue>;

export interface CmsDatasetQueryResponse {
  source: "data.cms.gov";
  datasetId: string;
  apiUrl: string;
  offset: number;
  limit: number;
  returned: number;
  columns: string[];
  filters: CmsDatasetFilter[];
  rows: CmsDatasetRow[];
  note: string;
}

export interface CmsDataServiceOptions {
  fetch?: FetchLike;
  maxCatalogResponseBytes?: number;
  maxDatasetResponseBytes?: number;
}
