import { createHash, randomBytes } from "node:crypto";

const baseUrl = (process.argv[2] || process.env.MCP_BASE_URL)?.replace(/\/$/u, "");
if (!baseUrl) throw new Error("Pass the Cloudflare Worker base URL.");

const metadata = await getJson<{
  authorization_endpoint: string;
  registration_endpoint: string;
}>(`${baseUrl}/.well-known/oauth-authorization-server`);
const registration = await postJson<{ client_id: string }>(metadata.registration_endpoint, {
  client_name: "OIT concurrent authorization smoke test",
  redirect_uris: ["https://client.example/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none"
});

const attempts = [createAuthorizationUrl("first"), createAuthorizationUrl("second")];
const expectedClientStates = attempts.map((attempt) => new URL(attempt).searchParams.get("state"));
const pages = await Promise.all(attempts.map((url) => fetch(url, { redirect: "manual" })));
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
const authorizationCodes = approvals.map((response, index) => {
  if (response.status !== 302) {
    throw new Error(`Concurrent approval ${index + 1} returned HTTP ${response.status}.`);
  }
  const location = response.headers.get("Location");
  if (!location) throw new Error(`Concurrent approval ${index + 1} did not redirect to its client.`);
  const redirect = new URL(location);
  if (`${redirect.origin}${redirect.pathname}` !== "https://client.example/callback") {
    throw new Error(`Concurrent approval ${index + 1} redirected to an unexpected client.`);
  }
  if (redirect.searchParams.get("state") !== expectedClientStates[index]) {
    throw new Error(`Concurrent approval ${index + 1} returned the wrong client state.`);
  }
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error(`Concurrent approval ${index + 1} did not issue a code.`);
  const sessionCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-MEDICAL_RESEARCH_SESSION="));
  if (!sessionCookie) {
    throw new Error(`Concurrent approval ${index + 1} did not create a pseudonymous session.`);
  }
  return code;
});
if (authorizationCodes[0] === authorizationCodes[1]) {
  throw new Error("Concurrent approvals reused the same authorization code.");
}

console.log(
  JSON.stringify(
    {
      endpoint: baseUrl,
      concurrentAuthorizationPages: "isolated",
      concurrentConsentApprovals: "accepted",
      concurrentPseudonymousAuthorizations: "isolated"
    },
    null,
    2
  )
);

function createAuthorizationUrl(label: string): string {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", registration.client_id);
  url.searchParams.set("redirect_uri", "https://client.example/callback");
  url.searchParams.set("scope", "mcp:research");
  url.searchParams.set("state", `${label}-${randomBytes(32).toString("base64url")}`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", `${baseUrl}/mcp`);
  return url.toString();
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
