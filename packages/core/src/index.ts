export { ResearchService } from "./research-service.js";
export { CmsDataService } from "./cms-service.js";
export { UpstreamError } from "./http.js";
export { canonicalId, canonicalUrl, normalizeDoi, parseIdentifier } from "./identifiers.js";
export { deduplicateRecords, mergeRecords, reconcileAuthors } from "./records.js";
export { decodeXml, firstTag, normalizeWhitespace, xmlToText } from "./xml.js";
export type {
  ArticleIdentifiers,
  AnnotationFilters,
  AnnotationProviderResponse,
  AnnotationResponse,
  AnnotationTag,
  CanonicalIdentifier,
  CitationDirection,
  CitationProviderResponse,
  CitationResponse,
  CmsDataServiceOptions,
  CmsDatasetFilter,
  CmsDatasetQueryResponse,
  CmsDatasetRow,
  CmsDatasetSearchResponse,
  CmsDatasetSummary,
  CmsDatasetValue,
  CmsFilterOperator,
  FetchLike,
  FetchMetadata,
  FetchOptions,
  FetchResponse,
  FetchTextInfo,
  FullTextStatus,
  ProviderContext,
  ProviderDiagnostics,
  ProviderFailure,
  ProviderFailureReason,
  ProviderName,
  ResearchProvider,
  ResearchAnnotation,
  ResearchRecord,
  ResearchServiceOptions,
  SearchFilters,
  SearchResponse,
  SearchResult
} from "./types.js";
