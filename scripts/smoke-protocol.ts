import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";

const serverPath = resolve("dist/oit-medical-research-mcp.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe"
});
const client = new Client({ name: "oit-medical-research-smoke-test", version: "0.1.0" });
let serverError = "";
transport.stderr?.on("data", (chunk) => {
  serverError += String(chunk);
});

try {
  await client.connect(transport).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${serverError ? `\nServer stderr:\n${serverError}` : ""}`);
  });
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  if (
    names.join(",") !==
    "annotations,citations,cms_query_dataset,cms_search_datasets,fetch,search"
  ) {
    throw new Error(`Unexpected tool catalog: ${names.join(", ")}`);
  }
  const searchTool = tools.tools.find((tool) => tool.name === "search");
  const searchProperties = (searchTool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  const expectedSearchInputs = ["fromYear", "fullTextOnly", "journals", "limit", "query", "toYear"];
  if (Object.keys(searchProperties ?? {}).sort().join(",") !== expectedSearchInputs.join(",")) {
    throw new Error("The search tool did not advertise the expected structured-filter inputs.");
  }
  const fromYearSchema = searchProperties?.fromYear as { maximum?: number; minimum?: number } | undefined;
  if (fromYearSchema?.minimum !== 1800 || fromYearSchema.maximum !== 2100) {
    throw new Error("The search tool advertised an unstable publication-year range.");
  }
  assertOutputSchema(searchTool, "search", ["results", "providerDiagnostics"]);
  const fetchTool = tools.tools.find((tool) => tool.name === "fetch");
  const fetchProperties = (
    fetchTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  const fetchInputs = Object.keys(fetchProperties ?? {}).sort();
  if (fetchInputs.join(",") !== "id,includeText,textLimit") {
    throw new Error("The fetch tool did not advertise metadata-only and bounded-text inputs.");
  }
  const fetchOutputProperties = (
    fetchTool?.outputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (
    !fetchOutputProperties?.metadata ||
    !fetchOutputProperties.providerDiagnostics ||
    !fetchOutputProperties.textInfo
  ) {
    throw new Error("The fetch tool did not advertise its structured metadata output.");
  }
  const citationsTool = tools.tools.find((tool) => tool.name === "citations");
  const citationProperties = (
    citationsTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (Object.keys(citationProperties ?? {}).sort().join(",") !== "direction,id,limit") {
    throw new Error("The citations tool did not advertise the expected inputs.");
  }
  const directionSchema = citationProperties?.direction as { enum?: unknown[] } | undefined;
  if (directionSchema?.enum?.join(",") !== "references,citedBy") {
    throw new Error("The citations tool did not advertise both citation directions.");
  }
  assertOutputSchema(citationsTool, "citations", [
    "article",
    "direction",
    "total",
    "results",
    "providerDiagnostics"
  ]);
  const annotationsTool = tools.tools.find((tool) => tool.name === "annotations");
  const annotationProperties = (
    annotationsTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  const annotationInputs = Object.keys(annotationProperties ?? {}).sort();
  if (annotationInputs.join(",") !== "id,limit,providers,sections,types") {
    throw new Error("The annotations tool did not advertise the expected bounded filters.");
  }
  assertOutputSchema(annotationsTool, "annotations", [
    "article",
    "source",
    "total",
    "annotations",
    "disclaimer",
    "providerDiagnostics"
  ]);
  const cmsSearchTool = tools.tools.find((tool) => tool.name === "cms_search_datasets");
  const cmsSearchProperties = (
    cmsSearchTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (Object.keys(cmsSearchProperties ?? {}).sort().join(",") !== "limit,query") {
    throw new Error("The CMS dataset search tool did not advertise the expected inputs.");
  }
  assertOutputSchema(cmsSearchTool, "cms_search_datasets", [
    "source",
    "resultCount",
    "totalMatches",
    "totalCatalogDatasets",
    "results"
  ]);
  const cmsQueryTool = tools.tools.find((tool) => tool.name === "cms_query_dataset");
  const cmsQueryProperties = (
    cmsQueryTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (
    Object.keys(cmsQueryProperties ?? {}).sort().join(",") !==
    "datasetId,filters,limit,offset"
  ) {
    throw new Error("The CMS dataset query tool did not advertise the expected inputs.");
  }
  assertOutputSchema(cmsQueryTool, "cms_query_dataset", [
    "source",
    "datasetId",
    "columns",
    "rows",
    "note"
  ]);
  console.log(
    JSON.stringify(
      {
        protocol: "connected",
        tools: names,
        searchInputs: expectedSearchInputs,
        fetchInputs,
        citationDirections: directionSchema.enum,
        annotationInputs,
        structuredOutputs: names
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}

function assertOutputSchema(
  tool: { outputSchema?: unknown } | undefined,
  toolName: string,
  expectedProperties: string[]
): void {
  const properties = (
    tool?.outputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  for (const property of expectedProperties) {
    if (!properties?.[property]) {
      throw new Error(`The ${toolName} tool did not advertise ${property} in its output schema.`);
    }
  }
}
