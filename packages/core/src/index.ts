export { ResearchService } from "./research-service.js";
export { canonicalId, canonicalUrl, normalizeDoi, parseIdentifier } from "./identifiers.js";
export { deduplicateRecords, mergeRecords } from "./records.js";
export { decodeXml, firstTag, normalizeWhitespace, xmlToText } from "./xml.js";
export type {
  ArticleIdentifiers,
  CanonicalIdentifier,
  FetchLike,
  FetchResponse,
  ProviderContext,
  ProviderName,
  ResearchProvider,
  ResearchRecord,
  ResearchServiceOptions,
  SearchFilters,
  SearchResponse,
  SearchResult
} from "./types.js";
