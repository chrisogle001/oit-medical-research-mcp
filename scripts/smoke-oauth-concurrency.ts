import { createHash, randomBytes } from "node:crypto";

const baseUrl = (process.argv[2] || process.env.MCP_BASE_URL)?.replace(/\/$/u, "");
if (!baseUrl) throw new Error("Pass the Cloudflare Worker base URL.");
const clientIdMetadataUrl = process.env.OAUTH_CLIENT_ID_METADATA_URL?.trim();
const redirectUri = process.env.OAUTH_REDIRECT_URI?.trim()
  || (clientIdMetadataUrl
    ? "https://chatgpt.com/connector_platform_oauth_redirect"
    : "https://client.example/callback");

const metadata = await getJson<{
  authorization_endpoint: string;
  registration_endpoint: string;
  token_endpoint: string;
}>(`${baseUrl}/.well-known/oauth-authorization-server`);
const registration = clientIdMetadataUrl
  ? { client_id: clientIdMetadataUrl }
  : await postJson<{ client_id: string }>(metadata.registration_endpoint, {
      client_name: "OIT concurrent authorization smoke test",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    });

const attempts = [createAuthorizationAttempt("first"), createAuthorizationAttempt("second")];
const expectedClientStates = attempts.map((attempt) =>
  new URL(attempt.url).searchParams.get("state")
);
const pages = await Promise.all(
  attempts.map((attempt) => fetch(attempt.url, { redirect: "manual" }))
);
const pageBodies = await Promise.all(pages.map((response) => response.text()));
const consentStates = pageBodies.map((body, index) => {
  if (pages[index]!.status !== 200) {
    throw new Error(`Authorization page ${index + 1} returned HTTP ${pages[index]!.status}.`);
  }
  const state = body.match(/consent_state=([A-Za-z0-9_-]+)/u)?.[1];
  if (!state) throw new Error(`Authorization page ${index + 1} did not include consent state.`);
  return state;
});
if (consentStates[0] === consentStates[1]) {
  throw new Error("Concurrent authorization pages reused the same consent state.");
}

const consentCookies = pages.map((response, index) => {
  const cookie = response.headers.getSetCookie().find((value) =>
    value.startsWith(`__Host-MEDICAL_RESEARCH_CONSENT_${consentStates[index]}=`)
  );
  if (!cookie) throw new Error(`Authorization page ${index + 1} did not set its own binding cookie.`);
  return cookiePair(cookie);
});
const browserCookies = consentCookies.join("; ");

const approvals = await Promise.all(
  consentStates.map((state) =>
    fetch(`${baseUrl}/authorize?consent_state=${state}`, {
      method: "POST",
      headers: {
        Cookie: browserCookies,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ decision: "approve" }),
      redirect: "manual"
    })
  )
);
const approvalResponses = approvals.map((response, index) => {
  if (response.status !== 200) {
    throw new Error(`Concurrent approval ${index + 1} returned HTTP ${response.status}.`);
  }
  return response;
});
const approvalBodies = await Promise.all(approvalResponses.map((response) => response.text()));
const issuedCodes = approvalBodies.map((body, index) => {
  const location = extractAuthorizationHandoff(body);
  if (!location) throw new Error(`Concurrent approval ${index + 1} did not hand off to its client.`);
  const redirect = new URL(location);
  if (`${redirect.origin}${redirect.pathname}` !== redirectUri) {
    throw new Error(`Concurrent approval ${index + 1} redirected to an unexpected client.`);
  }
  if (redirect.searchParams.get("state") !== expectedClientStates[index]) {
    throw new Error(`Concurrent approval ${index + 1} returned the wrong client state.`);
  }
  if (redirect.searchParams.get("iss") !== baseUrl) {
    throw new Error(`Concurrent approval ${index + 1} returned the wrong authorization issuer.`);
  }
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error(`Concurrent approval ${index + 1} did not issue a code.`);
  const sessionCookie = approvalResponses[index]!.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-MEDICAL_RESEARCH_SESSION="));
  if (!sessionCookie) {
    throw new Error(`Concurrent approval ${index + 1} did not create a pseudonymous session.`);
  }
  return code;
});
if (issuedCodes[0] === issuedCodes[1]) {
  throw new Error("Concurrent approvals reused the same authorization code.");
}

const accessTokens = await Promise.all(
  issuedCodes.map((code, index) => exchangeAuthorizationCode(code, attempts[index]!.verifier))
);
if (accessTokens[0] === accessTokens[1]) {
  throw new Error("Concurrent authorization codes returned the same access token.");
}
await Promise.all(accessTokens.map((token) => verifyAuthenticatedMcpAccess(token)));

console.log(
  JSON.stringify(
    {
      endpoint: baseUrl,
      clientRegistration: clientIdMetadataUrl ? "cimd" : "dcr",
      concurrentAuthorizationPages: "isolated",
      concurrentConsentApprovals: "accepted",
      concurrentPseudonymousAuthorizations: "isolated",
      pkceTokenExchange: "accepted",
      authenticatedMcpAccess: "accepted",
      structuredToolOutputs: "advertised"
    },
    null,
    2
  )
);

function createAuthorizationAttempt(label: string): { url: string; verifier: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", registration.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "mcp:research");
  url.searchParams.set("state", `${label}-${randomBytes(32).toString("base64url")}`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", `${baseUrl}/mcp`);
  return { url: url.toString(), verifier };
}

function extractAuthorizationHandoff(body: string): string | null {
  const encoded = body.match(/http-equiv="refresh" content="0;url=([^"]+)"/u)?.[1];
  if (!encoded) return null;
  return encoded
    .replace(/&quot;/gu, '"')
    .replace(/&#039;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

async function exchangeAuthorizationCode(code: string, verifier: string): Promise<string> {
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${baseUrl}/mcp`
    })
  });
  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 1_000);
    throw new Error(
      `OAuth token exchange failed with HTTP ${response.status}: ${errorBody || "empty response"}`
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("OAuth token exchange returned no access token.");
  return payload.access_token;
}

async function verifyAuthenticatedMcpAccess(accessToken: string): Promise<void> {
  let requestId = 1;
  const callMcp = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params })
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Authenticated MCP ${method} failed with HTTP ${response.status}.`);
    }
    return parseMcpBody(body) as {
      result?: {
        serverInfo?: { name?: string };
        tools?: Array<{ name?: string; outputSchema?: unknown }>;
      };
    };
  };

  const initialized = await callMcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "oit-concurrent-authorization-smoke-test", version: "0.1.0" }
  });
  if (initialized.result?.serverInfo?.name !== "OIT - Medical Research MCP") {
    throw new Error("Authenticated MCP initialization returned an unexpected server identity.");
  }

  const catalog = await callMcp("tools/list", {});
  const tools = catalog.result?.tools ?? [];
  for (const toolName of ["search", "citations", "annotations", "fetch"]) {
    const tool = tools.find((candidate) => candidate.name === toolName);
    const properties = (
      tool?.outputSchema as { properties?: Record<string, unknown> } | undefined
    )?.properties;
    if (!properties || !properties.providerDiagnostics) {
      throw new Error(`Authenticated MCP catalog omitted the ${toolName} structured output schema.`);
    }
  }
}

function parseMcpBody(body: string): unknown {
  const payloads = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  return JSON.parse(payloads.at(-1) ?? body);
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

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0]!;
}
