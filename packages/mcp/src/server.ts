import { McpServer } from "@modelcontextprotocol/server";
import { ResearchService, type ResearchServiceOptions } from "@oit-medical-research/core";
import { z } from "zod";

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
    .describe("A search result ID, PMID, PMCID, DOI, or supported article URL.")
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

export function createMedicalResearchMcpServer(options: ResearchServiceOptions = {}): McpServer {
  const service = new ResearchService(options);
  const server = new McpServer({
    name: "OIT - Medical Research MCP",
    version: "0.5.0"
  });

  server.registerTool(
    "search",
    {
      title: "Search medical research",
      description:
        "Search PubMed, PubMed Central, Europe PMC, and Crossref for medical literature. Supports publication-year, journal, and repository-full-text filters and returns deduplicated records with publication types, preprint and retraction warnings, source metadata, and stable IDs for use with fetch.",
      inputSchema: SearchInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query, limit, fromYear, toYear, journals, fullTextOnly }) =>
      toolResult(() =>
        service.search(query, limit, {
          ...(fromYear !== undefined ? { fromYear } : {}),
          ...(toYear !== undefined ? { toYear } : {}),
          ...(journals !== undefined ? { journals } : {}),
          ...(fullTextOnly !== undefined ? { fullTextOnly } : {})
        })
      )
  );

  server.registerTool(
    "citations",
    {
      title: "Explore an article's citation network",
      description:
        "Retrieve papers referenced by an article or papers that cite it through Europe PMC's open citation network. Returns normalized, stable article IDs plus publication types and preprint or retraction warnings for follow-up fetch or citation calls.",
      inputSchema: CitationsInput,
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
        "Retrieve bounded, text-mined biomedical mentions for one article from Europe PMC, optionally filtered by annotation type, article section, or provider. Results include surrounding context and linked database entities, plus a warning that annotations may be incomplete or incorrect.",
      inputSchema: AnnotationsInput,
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
        "Fetch normalized metadata, abstract, lawful open full text when available, identifiers, provenance, license, access links, publication types, and explicit preprint or retraction warnings for one article.",
      inputSchema: FetchInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ id }) => toolResult(() => service.fetch(id))
  );

  return server;
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const value = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The research request failed.";
    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }]
    };
  }
}
