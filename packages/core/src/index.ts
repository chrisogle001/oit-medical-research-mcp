export { ResearchService } from "./research-service.js";
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
  FetchLike,
  FetchMetadata,
  FetchResponse,
  FullTextStatus,
  ProviderContext,
  ProviderDiagnostics,
  ProviderName,
  ResearchProvider,
  ResearchAnnotation,
  ResearchRecord,
  ResearchServiceOptions,
  SearchFilters,
  SearchResponse,
  SearchResult
} from "./types.js";
