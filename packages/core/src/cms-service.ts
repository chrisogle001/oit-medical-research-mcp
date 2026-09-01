import { fetchJson } from "./http.js";
import type {
  CmsDataServiceOptions,
  CmsDatasetFilter,
  CmsDatasetQueryResponse,
  CmsDatasetRow,
  CmsDatasetSearchResponse,
  CmsDatasetSummary,
  CmsDatasetValue,
  FetchLike
} from "./types.js";

const CMS_CATALOG_URL = "https://data.cms.gov/data.json";
const CMS_DATASET_BASE_URL = "https://data.cms.gov/data-api/v1/dataset/";
const CMS_DATASET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CMS_FILTER_FIELD = /^[^\[\]\u0000-\u001f\u007f]{1,100}$/;
const DEFAULT_CATALOG_BYTES = 6_000_000;
const DEFAULT_DATASET_BYTES = 5_000_000;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_QUERY_LIMIT = 25;
const MAX_QUERY_LIMIT = 100;
const MAX_OFFSET = 1_000_000;
const CMS_DATA_NOTE =
  "CMS public-use datasets are not patient-specific clinical records. Column meanings and suppression rules vary by dataset; consult the linked CMS landing page and data dictionary before interpreting results.";

interface CmsCatalog {
  dataset?: unknown;
}

interface CmsCatalogDataset {
  title?: unknown;
  description?: unknown;
  theme?: unknown;
  keyword?: unknown;
  modified?: unknown;
  temporal?: unknown;
  landingPage?: unknown;
  license?: unknown;
  distribution?: unknown;
}

interface CmsDistribution {
  format?: unknown;
  accessURL?: unknown;
  resourcesAPI?: unknown;
  description?: unknown;
  modified?: unknown;
}

export class CmsDataService {
  private readonly fetcher: FetchLike;
  private readonly maxCatalogResponseBytes: number;
  private readonly maxDatasetResponseBytes: number;

  constructor(options: CmsDataServiceOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxCatalogResponseBytes = options.maxCatalogResponseBytes ?? DEFAULT_CATALOG_BYTES;
    this.maxDatasetResponseBytes = options.maxDatasetResponseBytes ?? DEFAULT_DATASET_BYTES;
  }

  async searchDatasets(query: string, requestedLimit?: number): Promise<CmsDatasetSearchResponse> {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < 2) throw new Error("Enter a more specific CMS dataset query.");
    if (normalizedQuery.length > 500) throw new Error("The CMS dataset query is too long.");
    const limit = boundedInteger(requestedLimit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
    const catalog = await fetchJson<CmsCatalog>(
      this.fetcher,
      "cms",
      new URL(CMS_CATALOG_URL),
      { maxResponseBytes: this.maxCatalogResponseBytes }
    );
    const catalogDatasets = Array.isArray(catalog.dataset) ? catalog.dataset : [];
    const matches = catalogDatasets
      .flatMap((value) => normalizeDataset(value))
      .map((dataset) => ({ dataset, score: datasetScore(dataset, normalizedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.dataset.title.localeCompare(right.dataset.title));

    return {
      source: "data.cms.gov",
      resultCount: Math.min(limit, matches.length),
      totalMatches: matches.length,
      totalCatalogDatasets: catalogDatasets.length,
      results: matches.slice(0, limit).map(({ dataset }) => dataset)
    };
  }

  async queryDataset(
    datasetId: string,
    requestedLimit?: number,
    requestedOffset?: number,
    filters: CmsDatasetFilter[] = []
  ): Promise<CmsDatasetQueryResponse> {
    const normalizedDatasetId = datasetId.trim().toLowerCase();
    if (!CMS_DATASET_ID.test(normalizedDatasetId)) {
      throw new Error("Use a CMS dataset UUID returned by cms_search_datasets.");
    }
    const limit = boundedInteger(requestedLimit, DEFAULT_QUERY_LIMIT, 1, MAX_QUERY_LIMIT);
    const offset = boundedInteger(requestedOffset, 0, 0, MAX_OFFSET);
    const normalizedFilters = normalizeFilters(filters);
    const url = new URL(`${CMS_DATASET_BASE_URL}${normalizedDatasetId}/data`);
    url.searchParams.set("size", String(limit));
    url.searchParams.set("offset", String(offset));
    normalizedFilters.forEach((filter, index) => {
      const group = `filter-${index + 1}`;
      url.searchParams.set(`filter[${group}][condition][path]`, filter.field);
      url.searchParams.set(
        `filter[${group}][condition][operator]`,
        filter.operator === "contains" ? "CONTAINS" : "="
      );
      url.searchParams.set(`filter[${group}][condition][value]`, filter.value);
    });

    const response = await fetchJson<unknown>(this.fetcher, "cms", url, {
      maxResponseBytes: this.maxDatasetResponseBytes
    });
    if (!Array.isArray(response)) throw new Error("CMS returned an invalid dataset response.");
    const rows = response.map(normalizeRow);

    return {
      source: "data.cms.gov",
      datasetId: normalizedDatasetId,
      apiUrl: url.toString(),
      offset,
      limit,
      returned: rows.length,
      columns: unique(rows.flatMap((row) => Object.keys(row))),
      filters: normalizedFilters,
      rows,
      note: CMS_DATA_NOTE
    };
  }
}

function normalizeDataset(value: unknown): CmsDatasetSummary[] {
  if (!isRecord(value)) return [];
  const dataset = value as CmsCatalogDataset;
  const title = stringValue(dataset.title);
  if (!title) return [];
  const distributions = Array.isArray(dataset.distribution)
    ? dataset.distribution.filter(isRecord).map((entry) => entry as CmsDistribution)
    : [];
  const apiDistributions = distributions.filter(
    (distribution) => stringValue(distribution.format)?.toUpperCase() === "API" &&
      stringValue(distribution.accessURL)
  );
  const latest =
    apiDistributions.find(
      (distribution) => stringValue(distribution.description)?.toLowerCase() === "latest"
    ) ??
    apiDistributions.sort((left, right) =>
      (stringValue(right.modified) ?? "").localeCompare(stringValue(left.modified) ?? "")
    )[0];
  const apiUrl = stringValue(latest?.accessURL);
  const datasetId = apiUrl ? datasetIdFromUrl(apiUrl) : undefined;
  if (!apiUrl || !datasetId) return [];

  return [
    {
      datasetId,
      title,
      ...optionalString("description", compactDescription(dataset.description)),
      ...optionalStrings("themes", dataset.theme),
      ...optionalStrings("keywords", dataset.keyword),
      ...optionalString("modified", stringValue(latest?.modified) ?? stringValue(dataset.modified)),
      ...optionalString("temporal", stringValue(dataset.temporal)),
      ...optionalString("landingPage", stringValue(dataset.landingPage)),
      ...optionalString("license", stringValue(dataset.license)),
      apiUrl,
      ...optionalString("resourcesUrl", stringValue(latest?.resourcesAPI))
    }
  ];
}

function normalizeFilters(filters: CmsDatasetFilter[]): CmsDatasetFilter[] {
  if (filters.length > 5) throw new Error("Use no more than five CMS dataset filters.");
  return filters.map((filter) => {
    const field = filter.field.trim();
    const value = filter.value.trim();
    if (!CMS_FILTER_FIELD.test(field)) throw new Error("A CMS filter field is invalid.");
    if (!value || value.length > 500) throw new Error("A CMS filter value is invalid.");
    if (filter.operator !== "equals" && filter.operator !== "contains") {
      throw new Error('A CMS filter operator must be "equals" or "contains".');
    }
    return { field, operator: filter.operator, value };
  });
}

function normalizeRow(value: unknown): CmsDatasetRow {
  if (!isRecord(value)) throw new Error("CMS returned an invalid dataset row.");
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, primitiveValue(item)])
  );
}

function primitiveValue(value: unknown): CmsDatasetValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function datasetScore(dataset: CmsDatasetSummary, normalizedQuery: string): number {
  const title = normalizeText(dataset.title);
  const keywords = normalizeText(dataset.keywords?.join(" ") ?? "");
  const themes = normalizeText(dataset.themes?.join(" ") ?? "");
  const description = normalizeText(dataset.description ?? "");
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  let score = title.includes(normalizedQuery) ? 100 : 0;
  if (keywords.includes(normalizedQuery)) score += 40;
  if (themes.includes(normalizedQuery)) score += 40;
  if (description.includes(normalizedQuery)) score += 20;
  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    if (keywords.includes(token)) score += 7;
    if (themes.includes(token)) score += 7;
    if (description.includes(token)) score += 2;
  }
  return score;
}

function compactDescription(value: unknown): string | undefined {
  const description = stringValue(value)
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!description) return undefined;
  return description.length <= 1_000 ? description : `${description.slice(0, 997)}...`;
}

function datasetIdFromUrl(value: string): string | undefined {
  const match = value.match(/\/dataset\/([0-9a-f-]{36})\/data(?:$|[/?#])/i);
  const datasetId = match?.[1];
  return datasetId && CMS_DATASET_ID.test(datasetId) ? datasetId.toLowerCase() : undefined;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalString<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : { [key]: value } as Record<K, string>;
}

function optionalStrings<K extends string>(key: K, value: unknown): Partial<Record<K, string[]>> {
  const values = Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
  return values.length ? ({ [key]: values } as Record<K, string[]>) : {};
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Use an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
