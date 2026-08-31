import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";

const server = createMedicalResearchMcpServer({ maxResults: 5 });
const client = new Client({ name: "oit-failure-mode-smoke-test", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await server.connect(serverTransport);
await client.connect(clientTransport);

try {
  const malformedDoi = await client.callTool({
    name: "fetch",
    arguments: { id: "doi:not-a-valid-doi" }
  });
  assertToolError(malformedDoi, "The DOI is not valid");

  const missingArticle = await client.callTool({
    name: "fetch",
    arguments: { id: "pmid:999999999" }
  });
  assertToolError(missingArticle, "No article was found");

  const invertedYears = await client.callTool({
    name: "search",
    arguments: { query: "knee osteoarthritis", fromYear: 2025, toYear: 2020 }
  });
  assertToolError(invertedYears, "fromYear must be less than or equal to toYear");

  const futureSearch = structuredRecord(
    await client.callTool({
      name: "search",
      arguments: {
        query: "knee osteoarthritis",
        fromYear: 2099,
        toYear: 2100,
        limit: 3
      }
    }),
    "future search"
  );
  if (recordArray(futureSearch, "results").length !== 0) {
    throw new Error("The deliberately future-dated search unexpectedly returned records.");
  }
  assertCleanDiagnostics(futureSearch, "future search");

  const missingCitations = await client.callTool({
    name: "citations",
    arguments: { id: "pmid:999999999", direction: "references", limit: 3 }
  });
  assertToolError(missingCitations, "No article was found");

  const emptyAnnotations = structuredRecord(
    await client.callTool({
      name: "annotations",
      arguments: {
        id: "pmid:21494379",
        limit: 3,
        types: ["DefinitelyNotARealAnnotationType"]
      }
    }),
    "empty annotation filter"
  );
  if (emptyAnnotations.total !== 0 || recordArray(emptyAnnotations, "annotations").length !== 0) {
    throw new Error("A no-match annotation filter did not return a clean empty result.");
  }
  assertCleanDiagnostics(emptyAnnotations, "empty annotation filter");

  const fullTextSearch = structuredRecord(
    await client.callTool({
      name: "search",
      arguments: {
        query: "knee osteoarthritis exercise randomized controlled trial",
        fromYear: 2022,
        toYear: 2025,
        journals: ["Trials"],
        fullTextOnly: true,
        limit: 5
      }
    }),
    "full-text search"
  );
  const advertisedRecords = recordArray(fullTextSearch, "results");
  if (advertisedRecords.length === 0) {
    throw new Error("The full-text consistency sample returned no records.");
  }

  const fullTextChecks: Array<Record<string, unknown>> = [];
  for (const advertised of advertisedRecords) {
    if (advertised.fullTextAvailable !== true || typeof advertised.id !== "string") {
      throw new Error("The full-text search returned an invalid advertised record.");
    }
    const fetched = structuredRecord(
      await client.callTool({
        name: "fetch",
        arguments: { id: advertised.id, includeText: true, textLimit: 1 }
      }),
      `fetch ${advertised.id}`
    );
    const metadata = childRecord(fetched, "metadata");
    const textInfo = childRecord(fetched, "textInfo");
    if (
      metadata.fullTextStatus !== "retrieved" ||
      metadata.textType !== "lawful-full-text" ||
      typeof textInfo.availableCharacters !== "number" ||
      textInfo.availableCharacters <= 0 ||
      textInfo.returnedCharacters !== 1
    ) {
      throw new Error(`Advertised full text could not be retrieved for ${advertised.id}.`);
    }
    fullTextChecks.push({
      id: advertised.id,
      searchStatus: advertised.fullTextStatus,
      fetchStatus: metadata.fullTextStatus,
      availableCharacters: textInfo.availableCharacters
    });
  }

  const externalAccess = structuredRecord(
    await client.callTool({
      name: "fetch",
      arguments: { id: "doi:10.1056/NEJMoa2307563", includeText: false }
    }),
    "external open-access location"
  );
  const externalMetadata = childRecord(externalAccess, "metadata");
  if (
    externalMetadata.fullTextStatus !== "open-access-location" ||
    externalMetadata.textType !== "abstract" ||
    externalMetadata.isOpenAccess !== true
  ) {
    throw new Error("An external open-access location was classified incorrectly.");
  }

  const retracted = structuredRecord(
    await client.callTool({
      name: "fetch",
      arguments: { id: "pmid:32450107", includeText: false }
    }),
    "retracted publication"
  );
  const retractedMetadata = childRecord(retracted, "metadata");
  if (
    retractedMetadata.isRetracted !== true ||
    !Array.isArray(retractedMetadata.statusWarnings) ||
    retractedMetadata.statusWarnings.length === 0
  ) {
    throw new Error("The known retracted publication did not return an explicit warning.");
  }

  console.log(
    JSON.stringify(
      {
        malformedIdentifier: "rejected",
        missingArticle: "not-found",
        invertedYearRange: "rejected",
        futureSearch: "clean-empty-result",
        missingCitationArticle: "not-found",
        emptyAnnotationFilter: "clean-empty-result",
        fullTextChecks,
        externalAccessStatus: externalMetadata.fullTextStatus,
        retractionWarning: retractedMetadata.statusWarnings
      },
      null,
      2
    )
  );
} finally {
  await client.close();
  await server.close();
}

function assertToolError(
  result: { isError?: boolean; content: Array<{ type: string; text?: string }> },
  expectedMessage: string
): void {
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  if (result.isError !== true || !text.includes(expectedMessage)) {
    throw new Error(`Expected MCP error containing ${JSON.stringify(expectedMessage)}; received ${text}`);
  }
}

function structuredRecord(
  result: { isError?: boolean; content: unknown; structuredContent?: unknown },
  label: string
): Record<string, unknown> {
  if (result.isError === true) throw new Error(`${label} returned an MCP error.`);
  if (!isRecord(result.structuredContent)) {
    throw new Error(`${label} did not return structured content.`);
  }
  return result.structuredContent;
}

function childRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) throw new Error(`Expected ${key} to be an object.`);
  return value;
}

function recordArray(parent: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = parent[key];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Expected ${key} to be an array of objects.`);
  }
  return value;
}

function assertCleanDiagnostics(parent: Record<string, unknown>, label: string): void {
  const diagnostics = childRecord(parent, "providerDiagnostics");
  if (
    diagnostics.partialFailure !== false ||
    !Array.isArray(diagnostics.failed) ||
    diagnostics.failed.length !== 0
  ) {
    throw new Error(`${label} reported an unexpected provider failure.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
