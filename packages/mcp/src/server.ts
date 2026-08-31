import { McpServer } from "@modelcontextprotocol/server";
import {
  ResearchService,
  type ResearchServiceOptions,
  type SearchResponse
} from "@oit-medical-research/core";
import { z } from "zod";

const MAX_FETCH_TEXT_CHARACTERS = 120_000;
const MAX_MODEL_SEARCH_RESULTS = 10;

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
  const server = new McpServer({
    name: "OIT - Medical Research MCP",
    version: "0.6.11"
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
    async ({ id, direction, limit }) => toolResult(() => service.citations(id, direction, limit))
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
      toolResult(() =>
        service.annotations(id, limit, {
          ...(types !== undefined ? { types } : {}),
          ...(sections !== undefined ? { sections } : {}),
          ...(providers !== undefined ? { providers } : {})
        })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
