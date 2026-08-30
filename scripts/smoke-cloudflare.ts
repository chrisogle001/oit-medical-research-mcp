const baseUrl = (process.argv[2] || process.env.MCP_BASE_URL)?.replace(/\/$/, "");
const oauthAccessToken = process.env.MCP_OAUTH_ACCESS_TOKEN;

if (!baseUrl) {
  throw new Error("Pass the Worker base URL or set MCP_BASE_URL for the Cloudflare smoke test.");
}

let requestId = 10;

const health = await fetch(`${baseUrl}/health`);
if (!health.ok) throw new Error(`Health check failed with HTTP ${health.status}.`);

const anonymous = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
});
if (anonymous.status !== 401) {
  throw new Error(`Anonymous MCP request returned HTTP ${anonymous.status}; expected 401.`);
}
const challenge = anonymous.headers.get("WWW-Authenticate");
const resourceMetadataUrl = challenge?.match(/resource_metadata="([^"]+)"/)?.[1];
if (!resourceMetadataUrl) throw new Error("The anonymous challenge did not advertise OAuth metadata.");

const resourceMetadataResponse = await fetch(resourceMetadataUrl);
if (!resourceMetadataResponse.ok) {
  throw new Error(`Protected-resource metadata returned HTTP ${resourceMetadataResponse.status}.`);
}
const resourceMetadata = (await resourceMetadataResponse.json()) as {
  resource?: string;
  authorization_servers?: string[];
};
if (resourceMetadata.resource !== `${baseUrl}/mcp`) {
  throw new Error("Protected-resource metadata advertised an unexpected MCP resource.");
}
const authorizationServer = resourceMetadata.authorization_servers?.[0];
if (!authorizationServer) throw new Error("No OAuth authorization server was advertised.");

const authorizationMetadataResponse = await fetch(
  `${authorizationServer}/.well-known/oauth-authorization-server`
);
if (!authorizationMetadataResponse.ok) {
  throw new Error(`Authorization metadata returned HTTP ${authorizationMetadataResponse.status}.`);
}
const authorizationMetadata = (await authorizationMetadataResponse.json()) as {
  authorization_endpoint?: string;
  token_endpoint?: string;
};
if (!authorizationMetadata.authorization_endpoint || !authorizationMetadata.token_endpoint) {
  throw new Error("OAuth authorization metadata is incomplete.");
}

if (!oauthAccessToken) {
  console.log(
    JSON.stringify(
      {
        endpoint: baseUrl,
        health: "ok",
        anonymousAccess: "rejected",
        oauthDiscovery: "ok",
        authenticatedProtocol: "not run (set MCP_OAUTH_ACCESS_TOKEN)"
      },
      null,
      2
    )
  );
  process.exit(0);
}

const initialized = await callMcp("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "oit-cloudflare-smoke-test", version: "0.1.0" }
});
if (initialized.result?.serverInfo?.name !== "OIT - Medical Research MCP") {
  throw new Error("Remote MCP initialization returned an unexpected server identity.");
}

const catalog = await callMcp("tools/list", {});
const tools = ((catalog.result?.tools ?? []) as Array<{ name?: string }>)
  .flatMap((tool) => (tool.name ? [tool.name] : []))
  .sort();
if (tools.join(",") !== "annotations,citations,fetch,search") {
  throw new Error(`Unexpected remote tool catalog: ${tools.join(", ")}`);
}

const searchCall = await callMcp("tools/call", {
  name: "search",
  arguments: {
    query: "randomized controlled trials of exercise for knee osteoarthritis",
    limit: 3,
    fromYear: 2020,
    journals: ["Trials"],
    fullTextOnly: true
  }
});
const firstContent = (searchCall.result?.content as Array<{ type?: string; text?: string }> | undefined)?.[0];
if (firstContent?.type !== "text" || !firstContent.text) {
  throw new Error("Remote search did not return MCP text content.");
}
const search = JSON.parse(firstContent.text) as {
  results?: Array<{
    id?: string;
    title?: string;
    journal?: string;
    publicationDate?: string;
    providers?: unknown;
    fullTextAvailable?: boolean;
    fullTextStatus?: unknown;
  }>;
};
if (!search.results?.length) throw new Error("Remote search returned no literature results.");
if (search.results.length !== 3) {
  throw new Error(`Remote search returned ${search.results.length} results; expected 3.`);
}
if (!search.results.some((result) => isKneeExerciseTrialTitle(result.title))) {
  throw new Error("Remote search returned no strongly matched title.");
}
if (!search.results.every(isStructuredFilterMatch)) {
  throw new Error("Remote search did not honor its structured filters or metadata contract.");
}

const firstResultId = search.results[0]?.id;
if (!firstResultId) throw new Error("Remote search returned a result without an ID.");
const fetchCall = await callMcp("tools/call", {
  name: "fetch",
  arguments: { id: firstResultId }
});
const fetchContent = (
  fetchCall.result?.content as Array<{ type?: string; text?: string }> | undefined
)?.[0];
if (fetchContent?.type !== "text" || !fetchContent.text) {
  throw new Error("Remote fetch did not return MCP text content.");
}
const article = JSON.parse(fetchContent.text) as {
  id?: string;
  metadata?: { textType?: unknown; fullTextStatus?: unknown; providers?: unknown };
  providerDiagnostics?: {
    attempted?: unknown;
    contributed?: unknown;
    failed?: unknown;
    partialFailure?: unknown;
  };
};
if (
  !article.id ||
  typeof article.metadata?.textType !== "string" ||
  typeof article.metadata.fullTextStatus !== "string" ||
  !Array.isArray(article.metadata.providers) ||
  !Array.isArray(article.providerDiagnostics?.attempted) ||
  !Array.isArray(article.providerDiagnostics.contributed) ||
  !Array.isArray(article.providerDiagnostics.failed) ||
  typeof article.providerDiagnostics.partialFailure !== "boolean"
) {
  throw new Error("Remote fetch returned incomplete provenance diagnostics.");
}

const citationsCall = await callMcp("tools/call", {
  name: "citations",
  arguments: { id: "pmid:32678530", direction: "references", limit: 3 }
});
const citationsContent = (
  citationsCall.result?.content as Array<{ type?: string; text?: string }> | undefined
)?.[0];
if (citationsContent?.type !== "text" || !citationsContent.text) {
  throw new Error("Remote citation lookup did not return MCP text content.");
}
const citations = JSON.parse(citationsContent.text) as {
  direction?: string;
  total?: number;
  results?: Array<{ id?: string }>;
};
if (
  citations.direction !== "references" ||
  (citations.total ?? 0) < 3 ||
  citations.results?.length !== 3 ||
  !citations.results.every((result) => result.id)
) {
  throw new Error("Remote citation lookup returned an incomplete reference network.");
}

const annotationsCall = await callMcp("tools/call", {
  name: "annotations",
  arguments: {
    id: "pmid:21494379",
    limit: 3,
    types: ["Chemicals"],
    sections: ["Title", "Abstract"],
    providers: ["Europe PMC"]
  }
});
const annotationsContent = (
  annotationsCall.result?.content as Array<{ type?: string; text?: string }> | undefined
)?.[0];
if (annotationsContent?.type !== "text" || !annotationsContent.text) {
  throw new Error("Remote annotation lookup did not return MCP text content.");
}
const annotations = JSON.parse(annotationsContent.text) as {
  source?: string;
  total?: number;
  annotations?: Array<{ text?: string; type?: string; tags?: unknown }>;
};
if (
  annotations.source !== "europe-pmc" ||
  (annotations.total ?? 0) < 3 ||
  annotations.annotations?.length !== 3 ||
  !annotations.annotations.every(
    (annotation) =>
      Boolean(annotation.text) &&
      annotation.type === "Chemicals" &&
      Array.isArray(annotation.tags) &&
      annotation.tags.length > 0
  )
) {
  throw new Error("Remote annotation lookup returned an incomplete normalized response.");
}

console.log(
  JSON.stringify(
    {
      endpoint: baseUrl,
      health: "ok",
      anonymousAccess: "rejected",
      protocol: "connected",
      tools,
      searchResultCount: search.results.length,
      searchFilters: { fromYear: 2020, journals: ["Trials"], fullTextOnly: true },
      fetchedId: article.id,
      fetchedTextType: article.metadata.textType,
      fetchedFullTextStatus: article.metadata.fullTextStatus,
      fetchProviderDiagnostics: article.providerDiagnostics,
      citationDirection: citations.direction,
      citationTotal: citations.total,
      citationResultCount: citations.results.length,
      annotationSource: annotations.source,
      annotationTotal: annotations.total,
      annotationResultCount: annotations.annotations.length
    },
    null,
    2
  )
);

async function callMcp(method: string, params: Record<string, unknown>) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params });
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${oauthAccessToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });
    const body = await response.text();
    if (response.ok) {
      return parseMcpBody(body) as {
        result?: {
          content?: unknown;
          serverInfo?: { name?: string };
          tools?: unknown;
        };
      };
    }
    if (response.status === 401 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }
    throw new Error(`MCP ${method} failed with HTTP ${response.status}: ${body}`);
  }
  throw new Error(`MCP ${method} did not become ready before the retry limit.`);
}

function parseMcpBody(body: string): unknown {
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  const payload = payloads.at(-1);
  return JSON.parse(payload ?? body);
}

function isKneeExerciseTrialTitle(title: string | undefined): boolean {
  const normalized = title?.toLowerCase() ?? "";
  return (
    normalized.includes("knee") &&
    (normalized.includes("exercise") || normalized.includes("physical therap")) &&
    (normalized.includes("randomized") || normalized.includes("randomised")) &&
    normalized.includes("trial")
  );
}

function isStructuredFilterMatch(result: {
  journal?: string;
  publicationDate?: string;
  providers?: unknown;
  fullTextAvailable?: boolean;
  fullTextStatus?: unknown;
}): boolean {
  return (
    result.journal?.toLowerCase() === "trials" &&
    Number(result.publicationDate?.slice(0, 4)) >= 2020 &&
    result.fullTextAvailable === true &&
    typeof result.fullTextStatus === "string" &&
    result.fullTextStatus !== "not-indicated" &&
    Array.isArray(result.providers) &&
    result.providers.length > 0
  );
}
