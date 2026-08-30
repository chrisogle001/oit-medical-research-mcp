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
if (tools.join(",") !== "fetch,search") {
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
    title?: string;
    journal?: string;
    publicationDate?: string;
    providers?: unknown;
    fullTextAvailable?: boolean;
  }>;
};
if (!search.results?.length) throw new Error("Remote search returned no literature results.");
if (search.results.length !== 3) {
  throw new Error(`Remote search returned ${search.results.length} results; expected 3.`);
}
if (!search.results.every((result) => isKneeExerciseTrialTitle(result.title))) {
  throw new Error("Remote search returned one or more weakly matched titles.");
}
if (!search.results.every(isStructuredFilterMatch)) {
  throw new Error("Remote search did not honor its structured filters or metadata contract.");
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
      searchFilters: { fromYear: 2020, journals: ["Trials"], fullTextOnly: true }
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
}): boolean {
  return (
    result.journal?.toLowerCase() === "trials" &&
    Number(result.publicationDate?.slice(0, 4)) >= 2020 &&
    result.fullTextAvailable === true &&
    Array.isArray(result.providers) &&
    result.providers.length > 0
  );
}
