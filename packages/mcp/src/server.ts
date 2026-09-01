import { McpServer } from "@modelcontextprotocol/server";
import {
  CmsDataService,
  ResearchService,
  type AnnotationResponse,
  type CmsDatasetQueryResponse,
  type CmsDatasetSearchResponse,
  type CitationResponse,
  type ResearchServiceOptions,
  type SearchResponse,
  type SearchResult
} from "@oit-medical-research/core";
import { z } from "zod";

const MAX_FETCH_TEXT_CHARACTERS = 120_000;
const MAX_MODEL_SEARCH_RESULTS = 10;
const MAX_MODEL_CMS_ROWS = 25;

const SearchInput = z.object({
  query: z
    .string()
    .min(2)
    .max(1_000)
    .describe("A natural-language or keyword medical literature query."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of deduplicated results to return. Defaults to the server limit."),
  fromYear: z
    .number()
    .int()
    .min(1800)
    .max(2100)
    .optional()
    .describe("Earliest publication year to include."),
  toYear: z
    .number()
    .int()
    .min(1800)
    .max(2100)
    .optional()
    .describe("Latest publication year to include."),
  journals: z
    .array(z.string().min(1).max(200))
    .max(5)
    .optional()
    .describe("Optional journal titles or common journal abbreviations to include."),
  fullTextOnly: z
    .boolean()
    .optional()
    .describe("When true, return only articles with repository full text available through PMC or Europe PMC.")
});

const FetchInput = z.object({
  id: z
    .string()
    .min(1)
    .max(2_048)
    .describe("A search result ID, PMID, PMCID, DOI, or supported article URL."),
  includeText: z
    .boolean()
    .optional()
    .describe(
      "Whether to include article text. Defaults to true. Set false for a compact metadata-only response."
    ),
  textLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_FETCH_TEXT_CHARACTERS)
    .optional()
    .describe(
      "Maximum article-text characters to return when includeText is true. Defaults to the server limit."
    )
});

const CmsDatasetSearchInput = z.object({
  query: z
    .string()
    .min(2)
    .max(500)
    .describe(
      "Keywords describing a CMS public dataset, such as Medicare spending, hospital quality, Medicaid enrollment, or provider utilization."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Maximum number of matching CMS datasets to return. Defaults to 10.")
});

const CmsDatasetFilterSchema = z.object({
  field: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("Exact CMS dataset column name, obtainable from an initial query response."),
  operator: z
    .enum(["equals", "contains"])
    .describe('Use "equals" for an exact value or "contains" for a substring match.'),
  value: z.string().trim().min(1).max(500).describe("Value to match in the selected column.")
});

const CmsDatasetQueryInput = z.object({
  datasetId: z
    .string()
    .uuid()
    .describe("A CMS dataset UUID returned by cms_search_datasets."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum rows to return. Defaults to 25."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .optional()
    .describe("Zero-based row offset for bounded pagination. Defaults to 0."),
  filters: z
    .array(CmsDatasetFilterSchema)
    .max(5)
    .optional()
    .describe("Optional CMS column filters. Use exact column names returned in the columns field.")
});

const ProviderNameOutput = z.enum(["pubmed", "europe-pmc", "crossref", "unpaywall"]);
const FullTextStatusOutput = z.enum([
  "retrieved",
  "repository-indexed",
  "open-access-location",
  "not-indicated"
]);
const ArticleIdentifiersOutput = z.object({
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  doi: z.string().optional(),
  epmcSource: z.string().optional(),
  epmcId: z.string().optional()
});
const ProviderDiagnosticsOutput = z.object({
  attempted: z.array(ProviderNameOutput),
  contributed: z.array(ProviderNameOutput),
  noRecord: z.array(ProviderNameOutput),
  failed: z.array(ProviderNameOutput),
  failures: z.array(
    z.object({
      provider: ProviderNameOutput,
      reason: z.enum([
        "rate-limited",
        "timeout",
        "network-error",
        "invalid-response",
        "upstream-error",
        "unknown"
      ]),
      status: z.number().int().min(100).max(599).optional()
    })
  ),
  partialFailure: z.boolean()
});
const SearchResultOutput = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  identifiers: ArticleIdentifiersOutput,
  providers: z.array(ProviderNameOutput),
  authors: z.array(z.string()).optional(),
  publicationTypes: z.array(z.string()).optional(),
  isPreprint: z.boolean(),
  isRetracted: z.boolean(),
  statusWarnings: z.array(z.string()).optional(),
  journal: z.string().optional(),
  publicationDate: z.string().optional(),
  isOpenAccess: z.boolean().optional(),
  fullTextAvailable: z.boolean(),
  fullTextStatus: FullTextStatusOutput,
  citationCount: z.number().optional()
});
const SearchOutput = z.object({
  results: z.array(SearchResultOutput),
  providerDiagnostics: ProviderDiagnosticsOutput
});
const FetchMetadataOutput = z.object({
  identifiers: ArticleIdentifiersOutput,
  authors: z.array(z.string()).optional(),
  publicationTypes: z.array(z.string()).optional(),
  isPreprint: z.boolean(),
  isRetracted: z.boolean(),
  statusWarnings: z.array(z.string()).optional(),
  journal: z.string().optional(),
  publicationDate: z.string().optional(),
  license: z.string().optional(),
  isOpenAccess: z.boolean().optional(),
  fullTextUrl: z.string().optional(),
  pdfUrl: z.string().optional(),
  citationCount: z.number().optional(),
  providers: z.array(ProviderNameOutput),
  retrievedAt: z.string(),
  textType: z.enum(["lawful-full-text", "abstract", "metadata"]),
  fullTextStatus: FullTextStatusOutput
});
const FetchOutput = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  metadata: FetchMetadataOutput,
  providerDiagnostics: ProviderDiagnosticsOutput,
  textInfo: z.object({
    included: z.boolean(),
    availableCharacters: z.number().int().nonnegative(),
    returnedCharacters: z.number().int().nonnegative(),
    truncated: z.boolean()
  }),
  text: z.string().optional()
});

const CmsDatasetSummaryOutput = z.object({
  datasetId: z.string().uuid(),
  title: z.string(),
  description: z.string().optional(),
  themes: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  modified: z.string().optional(),
  temporal: z.string().optional(),
  landingPage: z.string().optional(),
  license: z.string().optional(),
  apiUrl: z.string(),
  resourcesUrl: z.string().optional()
});
const CmsDatasetSearchOutput = z.object({
  source: z.literal("data.cms.gov"),
  resultCount: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  totalCatalogDatasets: z.number().int().nonnegative(),
  results: z.array(CmsDatasetSummaryOutput)
});
const CmsDatasetValueOutput = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const CmsDatasetQueryOutput = z.object({
  source: z.literal("data.cms.gov"),
  datasetId: z.string().uuid(),
  apiUrl: z.string(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  filters: z.array(CmsDatasetFilterSchema),
  rows: z.array(z.record(z.string(), CmsDatasetValueOutput)),
  note: z.string()
});

const CitationsInput = z.object({
  id: z
    .string()
    .min(1)
    .max(2_048)
    .describe("A search result ID, PMID, PMCID, DOI, or supported article URL."),
  direction: z
    .enum(["references", "citedBy"])
    .describe('Use "references" for papers cited by the article or "citedBy" for papers that cite it.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of normalized citation records to return. Defaults to the server limit.")
});
const CitationsOutput = z.object({
  article: SearchResultOutput,
  direction: z.enum(["references", "citedBy"]),
  total: z.number().int().nonnegative(),
  results: z.array(SearchResultOutput),
  providerDiagnostics: ProviderDiagnosticsOutput
});

const AnnotationFilter = z
  .array(z.string().trim().min(1).max(100))
  .max(5)
  .optional();

const AnnotationsInput = z.object({
  id: z
    .string()
    .min(1)
    .max(2_048)
    .describe("A search result ID, PMID, PMCID, DOI, or supported article URL."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum annotation mentions to return. Defaults to 50."),
  types: AnnotationFilter.describe(
    "Optional annotation types, such as Chemicals, Diseases, Gene_Proteins, Organisms, or Experimental Methods."
  ),
  sections: AnnotationFilter.describe(
    "Optional article sections, such as Title, Abstract, Methods, Results, Discussion, or Data Availability."
  ),
  providers: AnnotationFilter.describe(
    "Optional text-mining providers, such as Europe PMC, OpenTargets, DisGeNET, or PubTator_NCBI."
  )
});
const AnnotationTagOutput = z.object({
  name: z.string(),
  uri: z.string().optional()
});
const ResearchAnnotationOutput = z.object({
  text: z.string(),
  type: z.string(),
  section: z.string().optional(),
  sectionUri: z.string().optional(),
  provider: z.string().optional(),
  prefix: z.string().optional(),
  postfix: z.string().optional(),
  tags: z.array(AnnotationTagOutput),
  url: z.string().optional()
});
const AnnotationsOutput = z.object({
  article: SearchResultOutput,
  source: z.literal("europe-pmc"),
  total: z.number().int().nonnegative(),
  annotations: z.array(ResearchAnnotationOutput),
  disclaimer: z.string(),
  providerDiagnostics: ProviderDiagnosticsOutput
});

export function createMedicalResearchMcpServer(options: ResearchServiceOptions = {}): McpServer {
  const service = new ResearchService(options);
  const cms = new CmsDataService({ ...(options.fetch ? { fetch: options.fetch } : {}) });
  const server = new McpServer({
    name: "OIT - Medical Research MCP",
    version: "0.8.0"
  });

  server.registerTool(
    "search",
    {
      title: "Search medical research",
      description:
        "Search PubMed, PubMed Central, Europe PMC, and Crossref for medical literature. Supports publication-year, journal, and repository-full-text filters and returns deduplicated records with reconciled authors, explicit full-text status, provider contribution diagnostics, publication types, preprint and retraction warnings, and stable IDs for use with fetch.",
      inputSchema: SearchInput,
      outputSchema: SearchOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query, limit, fromYear, toYear, journals, fullTextOnly }) =>
      toolResult(
        () =>
          service.search(query, limit, {
            ...(fromYear !== undefined ? { fromYear } : {}),
            ...(toYear !== undefined ? { toYear } : {}),
            ...(journals !== undefined ? { journals } : {}),
            ...(fullTextOnly !== undefined ? { fullTextOnly } : {})
          }),
        formatSearchForModel
      )
  );

  server.registerTool(
    "citations",
    {
      title: "Explore an article's citation network",
      description:
        "Retrieve papers referenced by an article or papers that cite it through Europe PMC's open citation network. Returns normalized, stable article IDs, provider diagnostics, publication types, and preprint or retraction warnings for follow-up fetch or citation calls.",
      inputSchema: CitationsInput,
      outputSchema: CitationsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ id, direction, limit }) =>
      toolResult(() => service.citations(id, direction, limit), formatCitationsForModel)
  );

  server.registerTool(
    "cms_search_datasets",
    {
      title: "Find CMS public datasets",
      description:
        "Search the official data.cms.gov public catalog for Medicare, Medicaid, provider, quality, spending, utilization, and program datasets. Returns the latest public API dataset UUID, provenance, update date, license, and CMS landing page for follow-up with cms_query_dataset. This searches public-use datasets, not patient-specific claims.",
      inputSchema: CmsDatasetSearchInput,
      outputSchema: CmsDatasetSearchOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query, limit }) =>
      toolResult(() => cms.searchDatasets(query, limit), formatCmsDatasetSearchForModel)
  );

  server.registerTool(
    "cms_query_dataset",
    {
      title: "Query a CMS public dataset",
      description:
        "Query a bounded page from an official data.cms.gov public-use dataset by UUID. Supports up to five exact or contains filters and returns the available column names with the rows. Dataset schemas vary, so use cms_search_datasets first and consult the returned CMS landing page or data dictionary before interpreting values.",
      inputSchema: CmsDatasetQueryInput,
      outputSchema: CmsDatasetQueryOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ datasetId, limit, offset, filters }) =>
      toolResult(
        () => cms.queryDataset(datasetId, limit, offset, filters),
        formatCmsDatasetQueryForModel
      )
  );

  server.registerTool(
    "annotations",
    {
      title: "Get biomedical annotations for an article",
      description:
        "Retrieve bounded, text-mined biomedical mentions for one article from Europe PMC, optionally filtered by annotation type, article section, or provider. Results include provider diagnostics, surrounding context and linked database entities, plus a warning that annotations may be incomplete or incorrect.",
      inputSchema: AnnotationsInput,
      outputSchema: AnnotationsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ id, limit, types, sections, providers }) =>
      toolResult(
        () =>
          service.annotations(id, limit, {
            ...(types !== undefined ? { types } : {}),
            ...(sections !== undefined ? { sections } : {}),
            ...(providers !== undefined ? { providers } : {})
          }),
        formatAnnotationsForModel
      )
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a medical research article",
      description:
        "Fetch one medical research article with metadata and provider diagnostics before optional article text. Returns normalized identifiers, reconciled authors, DOI-based Crossref and Unpaywall enrichment, license, access links, explicit full-text retrieval status, publication types, and preprint or retraction warnings. Set includeText to false for a compact metadata-only response, or textLimit to bound the returned abstract or lawful open full text.",
      inputSchema: FetchInput,
      outputSchema: FetchOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ id, includeText, textLimit }) =>
      toolResult(() =>
        service.fetch(id, {
          ...(includeText !== undefined ? { includeText } : {}),
          ...(textLimit !== undefined ? { textLimit } : {})
        })
      )
  );

  return server;
}

async function toolResult<T>(
  operation: () => Promise<T>,
  formatContent: (value: T) => string = (value) => JSON.stringify(value)
) {
  try {
    const value = await operation();
    if (!isRecord(value)) throw new Error("The research tool returned an invalid result.");
    return {
      content: [{ type: "text" as const, text: formatContent(value) }],
      structuredContent: value
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The research request failed.";
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }]
    };
  }
}

function formatSearchForModel(response: SearchResponse): string {
  const includedResults = response.results.slice(0, MAX_MODEL_SEARCH_RESULTS);
  return JSON.stringify({
    resultCount: response.results.length,
    modelSummaryCount: includedResults.length,
    modelSummaryTruncated: includedResults.length < response.results.length,
    results: includedResults.map((result) => ({
      id: result.id,
      title: result.title,
      ...(result.journal !== undefined ? { journal: result.journal } : {}),
      ...(result.publicationDate !== undefined
        ? { publicationDate: result.publicationDate }
        : {}),
      ...(result.authors !== undefined ? { authors: result.authors } : {}),
      providers: result.providers,
      fullTextAvailable: result.fullTextAvailable,
      fullTextStatus: result.fullTextStatus,
      ...(result.isOpenAccess !== undefined ? { isOpenAccess: result.isOpenAccess } : {}),
      isPreprint: result.isPreprint,
      isRetracted: result.isRetracted,
      ...(result.citationCount !== undefined ? { citationCount: result.citationCount } : {})
    })),
    providerDiagnostics: response.providerDiagnostics
  });
}

function formatCmsDatasetSearchForModel(response: CmsDatasetSearchResponse): string {
  return JSON.stringify(response);
}

function formatCmsDatasetQueryForModel(response: CmsDatasetQueryResponse): string {
  const rows = response.rows.slice(0, MAX_MODEL_CMS_ROWS);
  return JSON.stringify({
    responseType: "cmsDatasetQuery",
    source: response.source,
    datasetId: response.datasetId,
    apiUrl: response.apiUrl,
    offset: response.offset,
    limit: response.limit,
    returned: response.returned,
    modelSummaryRows: rows.length,
    modelSummaryTruncated: rows.length < response.rows.length,
    columns: response.columns,
    filters: response.filters,
    rows,
    note: response.note
  });
}

function formatCitationsForModel(response: CitationResponse): string {
  return [
    "citationResponse",
    `direction=${response.direction}`,
    `total=${response.total}`,
    `returned=${response.results.length}`,
    `providerDiagnostics=${JSON.stringify(response.providerDiagnostics)}`,
    formatCitationRecordForModel("article", response.article),
    ...response.results.map((result, index) =>
      formatCitationRecordForModel(`citation ${index + 1}`, result)
    )
  ].join("\n");
}

function formatAnnotationsForModel(response: AnnotationResponse): string {
  return JSON.stringify({
    responseType: "annotationResponse",
    articleId: response.article.id,
    article: response.article,
    source: response.source,
    total: response.total,
    returned: response.annotations.length,
    annotations: response.annotations,
    disclaimer: response.disclaimer,
    providerDiagnostics: response.providerDiagnostics
  });
}

function formatCitationRecordForModel(label: string, record: SearchResult): string {
  const lines = [
    `[${label}]`,
    `id=${compactModelText(record.id)}`,
    `title=${compactModelText(record.title)}`,
    `url=${compactModelText(record.url)}`,
    `identifiers=${JSON.stringify(record.identifiers)}`,
    `providers=${formatModelList(record.providers)}`,
    `fullTextAvailable=${record.fullTextAvailable}`,
    `fullTextStatus=${record.fullTextStatus}`,
    `isPreprint=${record.isPreprint}`,
    `isRetracted=${record.isRetracted}`
  ];
  if (record.authors?.length) lines.push(`authors=${formatModelList(record.authors)}`);
  if (record.publicationTypes?.length) {
    lines.push(`publicationTypes=${formatModelList(record.publicationTypes)}`);
  }
  if (record.journal !== undefined) lines.push(`journal=${compactModelText(record.journal)}`);
  if (record.publicationDate !== undefined) {
    lines.push(`publicationDate=${compactModelText(record.publicationDate)}`);
  }
  if (record.citationCount !== undefined) lines.push(`citationCount=${record.citationCount}`);
  return lines.join("\n");
}

function formatModelList(values: readonly string[] | undefined): string {
  return values?.map(compactModelText).join("; ") ?? "";
}

function compactModelText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
