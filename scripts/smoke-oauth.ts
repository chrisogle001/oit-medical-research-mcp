import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const baseUrl = process.argv[2]?.replace(/\/$/, "");
if (!baseUrl) throw new Error("Pass the Cloudflare Worker base URL.");

const resource = `${baseUrl}/mcp`;
const verifier = toBase64Url(randomBytes(64));
const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
const expectedState = toBase64Url(randomBytes(32));
let callbackResolve: ((value: URL) => void) | undefined;
let callbackReject: ((reason: Error) => void) | undefined;
const callbackPromise = new Promise<URL>((resolve, reject) => {
  callbackResolve = resolve;
  callbackReject = reject;
});

const callbackServer = createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  response.writeHead(200, {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer"
  });
  response.end(
    "<!doctype html><html><body style=\"font-family:system-ui;padding:3rem\"><h1>Authorization received</h1><p>You can close this tab.</p></body></html>"
  );
  callbackResolve?.(requestUrl);
});
callbackServer.once("error", (error) => callbackReject?.(error));
await new Promise<void>((resolve) => callbackServer.listen(0, "127.0.0.1", resolve));
const address = callbackServer.address() as AddressInfo;
const redirectUri = `http://127.0.0.1:${address.port}/callback`;

try {
  const serverMetadata = await getJson<{
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
  }>(`${baseUrl}/.well-known/oauth-authorization-server`);
  const registration = await postJson<{ client_id: string }>(serverMetadata.registration_endpoint, {
    client_name: "OIT OAuth smoke test",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  });

  const authorizeUrl = new URL(serverMetadata.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", registration.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "mcp:research");
  authorizeUrl.searchParams.set("state", expectedState);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resource);

  console.log(JSON.stringify({ event: "authorization_required", url: authorizeUrl.toString() }));
  const callbackUrl = await withTimeout(callbackPromise, 600_000);
  if (callbackUrl.searchParams.get("state") !== expectedState) {
    throw new Error("OAuth callback state did not match.");
  }
  const authorizationError = callbackUrl.searchParams.get("error");
  if (authorizationError) throw new Error(`OAuth authorization failed: ${authorizationError}`);
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("OAuth callback did not include an authorization code.");

  const tokenResponse = await fetch(serverMetadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${tokenResponse.status}.`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("OAuth token exchange did not return an access token.");

  let requestId = 100;
  const callMcp = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(resource, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP ${method} failed with HTTP ${response.status}.`);
    return parseMcpBody(body) as {
      result?: {
        content?: Array<{ type?: string; text?: string }>;
        serverInfo?: { name?: string };
        tools?: Array<{ name?: string }>;
      };
    };
  };

  const initialized = await callMcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "oit-oauth-smoke-test", version: "0.1.0" }
  });
  if (initialized.result?.serverInfo?.name !== "OIT - Medical Research MCP") {
    throw new Error("Authenticated MCP initialization returned an unexpected server identity.");
  }
  const catalog = await callMcp("tools/list", {});
  const tools = (catalog.result?.tools || []).flatMap((tool) => (tool.name ? [tool.name] : [])).sort();
  if (tools.join(",") !== "citations,fetch,search") {
    throw new Error(`Unexpected tool catalog: ${tools.join(", ")}`);
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
  const content = searchCall.result?.content?.[0];
  if (content?.type !== "text" || !content.text) throw new Error("Search returned no MCP text content.");
  const search = JSON.parse(content.text) as {
    results?: Array<{
      id?: string;
      title?: string;
      journal?: string;
      publicationDate?: string;
      providers?: unknown;
      fullTextAvailable?: boolean;
    }>;
  };
  if (!search.results?.length) throw new Error("Authenticated literature search returned no results.");
  if (search.results.length !== 3) {
    throw new Error(`Authenticated literature search returned ${search.results.length} results; expected 3.`);
  }
  if (!search.results.every((result) => isKneeExerciseTrialTitle(result.title))) {
    throw new Error("Authenticated literature search returned one or more weakly matched titles.");
  }
  if (!search.results.every(isStructuredFilterMatch)) {
    throw new Error("Authenticated literature search did not honor its structured filters or metadata contract.");
  }
  const firstResultId = search.results[0]?.id;
  if (!firstResultId) throw new Error("Authenticated literature search returned a result without an ID.");

  const fetchCall = await callMcp("tools/call", {
    name: "fetch",
    arguments: { id: firstResultId }
  });
  const fetchContent = fetchCall.result?.content?.[0];
  if (fetchContent?.type !== "text" || !fetchContent.text) {
    throw new Error("Fetch returned no MCP text content.");
  }
  const article = JSON.parse(fetchContent.text) as {
    id?: string;
    text?: string;
    metadata?: { providers?: unknown; textType?: unknown };
  };
  if (!article.id || !article.text) throw new Error("Authenticated article fetch returned no usable article.");
  const providers = Array.isArray(article.metadata?.providers)
    ? article.metadata.providers.filter((provider): provider is string => typeof provider === "string")
    : [];
  const textType = typeof article.metadata?.textType === "string" ? article.metadata.textType : undefined;
  if (!providers.length || !textType) throw new Error("Fetched article provenance was incomplete.");

  const citationsCall = await callMcp("tools/call", {
    name: "citations",
    arguments: { id: "pmid:32678530", direction: "references", limit: 3 }
  });
  const citationsContent = citationsCall.result?.content?.[0];
  if (citationsContent?.type !== "text" || !citationsContent.text) {
    throw new Error("Citations returned no MCP text content.");
  }
  const citations = JSON.parse(citationsContent.text) as {
    direction?: string;
    total?: number;
    results?: Array<{ id?: string; title?: string }>;
  };
  if (
    citations.direction !== "references" ||
    (citations.total ?? 0) < 3 ||
    citations.results?.length !== 3 ||
    !citations.results.every((result) => result.id && result.title)
  ) {
    throw new Error("Authenticated citation lookup returned an incomplete reference network.");
  }

  console.log(
    JSON.stringify(
      {
        endpoint: baseUrl,
        oauth: "connected",
        protocol: "connected",
        tools,
        searchResultCount: search.results.length,
        searchFilters: { fromYear: 2020, journals: ["Trials"], fullTextOnly: true },
        fetchedId: article.id,
        fetchedProviders: providers,
        fetchedTextType: textType,
        fetchedTextCharacters: article.text.length,
        citationDirection: citations.direction,
        citationTotal: citations.total,
        citationResultCount: citations.results.length
      },
      null,
      2
    )
  );
} finally {
  callbackServer.close();
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}.`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`POST ${url} failed with HTTP ${response.status}.`);
  return (await response.json()) as T;
}

function parseMcpBody(body: string): unknown {
  const payload = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .at(-1);
  return JSON.parse(payload || body);
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
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

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("OAuth browser authorization timed out.")), milliseconds);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
