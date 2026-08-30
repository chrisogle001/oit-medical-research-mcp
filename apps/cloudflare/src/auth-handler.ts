import {
  AuthorizationError,
  type AuthRequest,
  type ClientInfo,
  type OAuthHelpers
} from "@cloudflare/workers-oauth-provider";
import {
  renderAccount,
  renderConsent,
  renderError,
  renderGitHubContinue,
  renderHome
} from "./html.js";
import {
  clearConsentCookie,
  clearCsrfCookie,
  clearOAuthStateCookie,
  clearSessionCookie,
  consumeConsentRequest,
  consumeOAuthFlow,
  createCsrfCookie,
  createPseudonymousUser,
  createSessionCookie,
  randomToken,
  readSession,
  storeConsentRequest,
  storeOAuthFlow,
  type AuthenticatedUser,
  type PendingOAuthFlow,
  validateCsrf
} from "./security.js";
import {
  deleteUserProviderSettings,
  normalizeNcbiApiKey,
  readUserProviderSettings,
  saveUserProviderSettings
} from "./user-data.js";

const MAX_FORM_BYTES = 16_384;
const RESEARCH_SCOPE = "mcp:research";

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

type GitHubTokenResult =
  | { ok: true; accessToken: string }
  | {
      ok: false;
      reason:
        | "bad_verification_code"
        | "incorrect_client_credentials"
        | "redirect_uri_mismatch"
        | "rate_limited"
        | "upstream_rejected"
        | "network_error";
      status?: number;
    };

export const authHandler = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const oauthEnv = env as OAuthEnv;

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "OIT - Medical Research MCP" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      const notice = url.searchParams.get("notice") || undefined;
      return renderHome(url.origin, notice);
    }
    if (request.method === "GET" && url.pathname === "/authorize") {
      return beginClientAuthorization(request, oauthEnv);
    }
    if (request.method === "POST" && url.pathname === "/authorize") {
      return continueClientAuthorization(request, oauthEnv);
    }
    if (request.method === "GET" && url.pathname === "/login") {
      return beginAccountLogin(request, oauthEnv);
    }
    if (request.method === "GET" && url.pathname === "/callback") {
      return handleGitHubCallback(request, oauthEnv);
    }
    if (request.method === "GET" && url.pathname === "/account") {
      return showAccount(request, oauthEnv);
    }
    if (request.method === "POST" && url.pathname === "/account/grants/revoke") {
      return revokeGrant(request, oauthEnv);
    }
    if (request.method === "POST" && url.pathname === "/account/settings/ncbi") {
      return updateNcbiSettings(request, oauthEnv);
    }
    if (request.method === "POST" && url.pathname === "/account/delete") {
      return deleteAccount(request, oauthEnv);
    }
    if (request.method === "POST" && url.pathname === "/logout") {
      return logout(request, oauthEnv);
    }
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;

async function beginClientAuthorization(request: Request, env: OAuthEnv): Promise<Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;

  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return authorizationErrorResponse(error);
  }

  let client: ClientInfo | null;
  try {
    client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  } catch {
    return renderError("Client unavailable", "The requesting MCP client could not be validated.");
  }
  if (!client) return renderError("Unknown MCP client", "The requesting client is not registered.");

  const consentState = randomToken();
  const response = renderConsent({ client, oauthRequest, consentState });
  try {
    response.headers.append(
      "Set-Cookie",
      await storeConsentRequest(
        env.OAUTH_KV,
        consentState,
        oauthRequest,
        env.COOKIE_ENCRYPTION_KEY
      )
    );
  } catch {
    logAuthorizationStateFailure("oauth_consent_state_store_failed", "storage_error");
    return renderError(
      "Authorization temporarily unavailable",
      "The authorization request could not be saved. Please try connecting again.",
      503
    );
  }
  return response;
}

async function continueClientAuthorization(request: Request, env: OAuthEnv): Promise<Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;
  const form = await readSmallForm(request);
  if (!form) return renderError("Invalid request", "The submitted form was invalid or too large.", 413);
  const consentState = new URL(request.url).searchParams.get("consent_state");
  const decision = form.get("decision");
  if (!consentState) {
    return renderError("Invalid authorization form", "Please restart the connection from your MCP client.");
  }

  let consentResult: Awaited<ReturnType<typeof consumeConsentRequest>>;
  try {
    consentResult = await consumeConsentRequest(
      request,
      env.OAUTH_KV,
      consentState,
      env.COOKIE_ENCRYPTION_KEY
    );
  } catch {
    logAuthorizationStateFailure("oauth_consent_state_rejected", "storage_error");
    return appendConsentCookieIfValid(
      renderError(
        "Authorization temporarily unavailable",
        "The authorization request could not be checked. Please try connecting again.",
        503
      ),
      consentState
    );
  }
  if (!consentResult.ok) {
    logAuthorizationStateFailure("oauth_consent_state_rejected", consentResult.reason);
    return appendConsentCookieIfValid(
      renderError("Authorization request expired", "Please restart the connection from your MCP client."),
      consentState
    );
  }
  const oauthRequest = consentResult.value;

  if (decision === "deny") {
    return appendCookie(
      redirectAuthorizationError(oauthRequest, "access_denied", "You declined access."),
      clearConsentCookie(consentState)
    );
  }
  if (decision !== "approve") {
    return appendCookie(
      renderError("Invalid request", "No authorization choice was provided."),
      clearConsentCookie(consentState)
    );
  }

  const session = await readSession(request, env.COOKIE_ENCRYPTION_KEY);
  const response = session
    ? await completeMcpAuthorization(env, oauthRequest, session)
    : await completePseudonymousMcpAuthorization(env, oauthRequest);
  return appendCookie(response, clearConsentCookie(consentState));
}

async function beginAccountLogin(request: Request, env: OAuthEnv): Promise<Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;
  const session = await readSession(request, env.COOKIE_ENCRYPTION_KEY);
  if (session) return redirectResponse(new URL("/account", request.url).toString());
  const githubConfigurationError = validateGitHubConfiguration(env);
  if (githubConfigurationError) return githubConfigurationError;
  return startGitHubFlow(request, env, { kind: "account", returnTo: "/account" });
}

async function startGitHubFlow(
  request: Request,
  env: OAuthEnv,
  flow: PendingOAuthFlow
): Promise<Response> {
  const state = randomToken();
  const callback = new URL("/callback", request.url).toString();
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", callback);
  github.searchParams.set("state", state);

  const response = renderGitHubContinue(github.toString());
  response.headers.set("Cache-Control", "no-store");
  try {
    response.headers.append(
      "Set-Cookie",
      await storeOAuthFlow(env.OAUTH_KV, state, flow, env.COOKIE_ENCRYPTION_KEY)
    );
  } catch {
    logAuthorizationStateFailure("github_oauth_state_store_failed", "storage_error");
    return renderError(
      "Sign-in temporarily unavailable",
      "The sign-in request could not be saved. Please try again.",
      503
    );
  }
  return response;
}

async function handleGitHubCallback(request: Request, env: OAuthEnv): Promise<Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) {
    logAuthorizationStateFailure("github_oauth_state_rejected", "missing_state");
    return renderError("Sign-in expired", "The browser session could not be matched to this sign-in.");
  }

  let flowResult: Awaited<ReturnType<typeof consumeOAuthFlow>>;
  try {
    flowResult = await consumeOAuthFlow(
      request,
      env.OAUTH_KV,
      state,
      env.COOKIE_ENCRYPTION_KEY
    );
  } catch {
    logAuthorizationStateFailure("github_oauth_state_rejected", "storage_error");
    return appendOAuthCookieIfValid(
      renderError(
        "Sign-in temporarily unavailable",
        "The browser session could not be checked. Please try connecting again.",
        503
      ),
      state
    );
  }
  if (!flowResult.ok) {
    logAuthorizationStateFailure("github_oauth_state_rejected", flowResult.reason);
    return appendOAuthCookieIfValid(
      renderError("Sign-in expired", "The browser session could not be matched to this sign-in."),
      state
    );
  }
  const flow = flowResult.value;

  const githubConfigurationError = validateGitHubConfiguration(env);
  if (githubConfigurationError) {
    const response =
      flow.kind === "mcp"
        ? await completePseudonymousMcpAuthorization(env, flow.request)
        : githubConfigurationError;
    return appendCookie(response, clearOAuthStateCookie(state));
  }

  const upstreamError = url.searchParams.get("error");
  if (upstreamError) {
    const response =
      flow.kind === "mcp"
        ? redirectAuthorizationError(flow.request, "access_denied", "GitHub sign-in was not completed.")
        : renderError("Sign-in cancelled", "GitHub sign-in was not completed.");
    return appendCookie(response, clearOAuthStateCookie(state));
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return appendCookie(
      renderError("Invalid callback", "GitHub did not provide an authorization code."),
      clearOAuthStateCookie(state)
    );
  }
  const tokenResult = await exchangeGitHubCode(
    code,
    new URL("/callback", request.url).toString(),
    env
  );
  if (!tokenResult.ok) {
    console.warn(
      JSON.stringify({
        event: "github_oauth_token_exchange_failed",
        reason: tokenResult.reason,
        ...(tokenResult.status ? { status: tokenResult.status } : {})
      })
    );
    if (flow.kind === "mcp") {
      console.warn(
        JSON.stringify({
          event: "github_oauth_fell_back_to_pseudonymous_identity",
          reason: tokenResult.reason
        })
      );
      return appendCookie(
        await completePseudonymousMcpAuthorization(env, flow.request),
        clearOAuthStateCookie(state)
      );
    }
    return appendCookie(
      renderError(
        "GitHub sign-in failed",
        githubOAuthFailureMessage(tokenResult.reason),
        tokenResult.reason === "rate_limited" ? 503 : 502
      ),
      clearOAuthStateCookie(state)
    );
  }
  const user = await fetchGitHubUser(tokenResult.accessToken);
  if (!user) {
    if (flow.kind === "mcp") {
      console.warn(JSON.stringify({ event: "github_profile_fell_back_to_pseudonymous_identity" }));
      return appendCookie(
        await completePseudonymousMcpAuthorization(env, flow.request),
        clearOAuthStateCookie(state)
      );
    }
    return appendCookie(
      renderError(
        "GitHub profile unavailable",
        "The signed-in GitHub profile could not be read.",
        502
      ),
      clearOAuthStateCookie(state)
    );
  }

  const sessionCookie = await createSessionCookie(user, env.COOKIE_ENCRYPTION_KEY);
  if (flow.kind === "account") {
    const headers = new Headers({ Location: flow.returnTo, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie);
    return appendCookie(
      new Response(null, { status: 302, headers }),
      clearOAuthStateCookie(state)
    );
  }

  return appendCookie(
    await completeMcpAuthorization(env, flow.request, user, sessionCookie),
    clearOAuthStateCookie(state)
  );
}

async function completePseudonymousMcpAuthorization(
  env: OAuthEnv,
  oauthRequest: AuthRequest
): Promise<Response> {
  const user = createPseudonymousUser();
  const sessionCookie = await createSessionCookie(user, env.COOKIE_ENCRYPTION_KEY);
  return completeMcpAuthorization(env, oauthRequest, user, sessionCookie);
}

async function completeMcpAuthorization(
  env: OAuthEnv,
  oauthRequest: AuthRequest,
  user: AuthenticatedUser,
  sessionCookie?: string
): Promise<Response> {
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return renderError("Unknown MCP client", "The requesting client is no longer registered.");
  const grantedScopes = oauthRequest.scope.filter((scope) => scope === RESEARCH_SCOPE);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: user.userId,
    metadata: { clientName: client.clientName || "MCP client" },
    scope: grantedScopes,
    props: { ...user, scopes: grantedScopes }
  });
  const headers = new Headers({ Location: redirectTo, "Cache-Control": "no-store" });
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  return new Response(null, { status: 302, headers });
}

async function showAccount(request: Request, env: OAuthEnv): Promise<Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;
  const session = await readSession(request, env.COOKIE_ENCRYPTION_KEY);
  if (!session) {
    const response = redirectResponse(new URL("/login", request.url).toString());
    response.headers.append("Set-Cookie", clearSessionCookie());
    return response;
  }
  const grants = await env.OAUTH_PROVIDER.listUserGrants(session.userId, { limit: 50 });
  let ncbiApiKeyConfigured: boolean;
  try {
    const settings = await readUserProviderSettings(
      env.USER_DATA_KV,
      session.userId,
      env.USER_DATA_ENCRYPTION_KEY
    );
    ncbiApiKeyConfigured = Boolean(settings?.ncbiApiKey);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "provider_settings_read_failed",
        error: error instanceof Error ? error.message : "Unknown error"
      })
    );
    return renderError(
      "Settings unavailable",
      "Your encrypted provider settings could not be read. Please contact the server operator.",
      503
    );
  }
  const csrfToken = randomToken();
  const notice = new URL(request.url).searchParams.get("notice") || undefined;
  const response = renderAccount({
    user: session,
    grants: grants.items,
    csrfToken,
    ncbiApiKeyConfigured,
    ...(notice ? { notice } : {})
  });
  response.headers.append("Set-Cookie", createCsrfCookie(csrfToken));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function updateNcbiSettings(request: Request, env: OAuthEnv): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const form = await readSmallForm(request);
  if (!form) return renderError("Invalid request", "The submitted form was invalid or too large.", 413);
  const csrfToken = form.get("csrf_token");
  const action = form.get("action");
  if (typeof csrfToken !== "string" || !(await validateCsrf(request, csrfToken))) {
    return renderError("Request expired", "Reload the account page and try again.");
  }

  if (action === "clear") {
    try {
      await deleteUserProviderSettings(
        env.USER_DATA_KV,
        session.userId,
        env.USER_DATA_ENCRYPTION_KEY
      );
    } catch {
      console.error(JSON.stringify({ event: "provider_settings_delete_failed" }));
      return renderError(
        "Settings unavailable",
        "The personal NCBI API key could not be removed. Please try again.",
        503
      );
    }
    return accountRedirect(request, "Personal NCBI API key removed.");
  }
  const apiKey = form.get("api_key");
  const normalized = typeof apiKey === "string" ? normalizeNcbiApiKey(apiKey) : null;
  if (action !== "save" || !normalized) {
    return renderError(
      "Invalid NCBI API key",
      "Enter an API key containing 8–128 letters, numbers, hyphens, or underscores."
    );
  }
  try {
    await saveUserProviderSettings(
      env.USER_DATA_KV,
      session.userId,
      env.USER_DATA_ENCRYPTION_KEY,
      { ncbiApiKey: normalized }
    );
  } catch {
    console.error(JSON.stringify({ event: "provider_settings_save_failed" }));
    return renderError(
      "Settings unavailable",
      "The personal NCBI API key could not be saved. Please try again.",
      503
    );
  }
  return accountRedirect(request, "Personal NCBI API key saved securely.");
}

async function deleteAccount(request: Request, env: OAuthEnv): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const form = await readSmallForm(request);
  if (!form) return renderError("Invalid request", "The submitted form was invalid or too large.", 413);
  const csrfToken = form.get("csrf_token");
  const confirmation = form.get("confirmation");
  if (typeof csrfToken !== "string" || !(await validateCsrf(request, csrfToken))) {
    return renderError("Request expired", "Reload the account page and try again.");
  }
  if (confirmation !== session.login) {
    return renderError(
      "Account deletion not confirmed",
      `Type ${session.login} exactly to delete your hosted account data.`
    );
  }

  try {
    const grants = await env.OAUTH_PROVIDER.listUserGrants(session.userId, { limit: 10 });
    if (grants.cursor) {
      return renderError(
        "Too many connected clients",
        "Revoke some connected MCP clients from the account page, then try account deletion again.",
        409
      );
    }
    for (const grant of grants.items) {
      await env.OAUTH_PROVIDER.revokeGrant(grant.id, session.userId);
    }
    await deleteUserProviderSettings(
      env.USER_DATA_KV,
      session.userId,
      env.USER_DATA_ENCRYPTION_KEY
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "account_deletion_failed",
        error: error instanceof Error ? error.message : "Unknown error"
      })
    );
    return renderError(
      "Account deletion incomplete",
      "The server could not finish deleting your data. No success was recorded; please try again.",
      503
    );
  }

  const response = redirectResponse(
    new URL(
      "/?notice=Your%20hosted%20account%20data%20and%20MCP%20grants%20were%20deleted.",
      request.url
    ).toString(),
    303
  );
  response.headers.append("Set-Cookie", clearSessionCookie());
  response.headers.append("Set-Cookie", clearCsrfCookie());
  return response;
}

async function revokeGrant(request: Request, env: OAuthEnv): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const form = await readSmallForm(request);
  if (!form) return renderError("Invalid request", "The submitted form was invalid or too large.", 413);
  const csrfToken = form.get("csrf_token");
  const grantId = form.get("grant_id");
  if (
    typeof csrfToken !== "string" ||
    typeof grantId !== "string" ||
    !(await validateCsrf(request, csrfToken))
  ) {
    return renderError("Request expired", "Reload the account page and try again.");
  }
  await env.OAUTH_PROVIDER.revokeGrant(grantId, session.userId);
  const response = redirectResponse(
    new URL("/account?notice=Client%20access%20revoked.", request.url).toString(),
    303
  );
  response.headers.append("Set-Cookie", clearCsrfCookie());
  return response;
}

async function logout(request: Request, env: OAuthEnv): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const form = await readSmallForm(request);
  if (!form) return renderError("Invalid request", "The submitted form was invalid or too large.", 413);
  const csrfToken = form.get("csrf_token");
  if (typeof csrfToken !== "string" || !(await validateCsrf(request, csrfToken))) {
    return renderError("Request expired", "Reload the account page and try again.");
  }
  const response = redirectResponse(new URL("/", request.url).toString(), 303);
  response.headers.append("Set-Cookie", clearSessionCookie());
  return response;
}

async function requireSession(
  request: Request,
  env: OAuthEnv
): Promise<AuthenticatedUser | Response> {
  const configurationError = validateConfiguration(env);
  if (configurationError) return configurationError;
  const session = await readSession(request, env.COOKIE_ENCRYPTION_KEY);
  return session || redirectResponse(new URL("/login", request.url).toString(), 303);
}

async function exchangeGitHubCode(
  code: string,
  callback: string,
  env: OAuthEnv
): Promise<GitHubTokenResult> {
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "OIT-Medical-Research-MCP"
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callback
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await readBoundedJson(response, 65_536);
    if (response.ok && isRecord(payload) && typeof payload.access_token === "string") {
      return { ok: true, accessToken: payload.access_token };
    }
    return {
      ok: false,
      reason: classifyGitHubOAuthFailure(payload, response.status),
      status: response.status
    };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

export function classifyGitHubOAuthFailure(
  payload: unknown,
  status?: number
): Exclude<GitHubTokenResult, { ok: true }>["reason"] {
  if (status === 429) return "rate_limited";
  if (!isRecord(payload) || typeof payload.error !== "string") return "upstream_rejected";
  if (
    payload.error === "bad_verification_code" ||
    payload.error === "incorrect_client_credentials" ||
    payload.error === "redirect_uri_mismatch"
  ) {
    return payload.error;
  }
  return "upstream_rejected";
}

export function githubOAuthFailureMessage(
  reason: Exclude<GitHubTokenResult, { ok: true }>["reason"]
): string {
  switch (reason) {
    case "bad_verification_code":
      return "GitHub rejected the temporary sign-in code because it was expired, reused, or no longer valid.";
    case "incorrect_client_credentials":
      return "GitHub rejected the server's OAuth app credentials. The server owner must update its GitHub client secret.";
    case "redirect_uri_mismatch":
      return "GitHub rejected the callback address. The OAuth app callback must match this server exactly.";
    case "network_error":
      return "The server could not reach GitHub's OAuth service in time. Please try again.";
    case "rate_limited":
      return "GitHub is temporarily limiting sign-in requests. Please wait a few minutes and try again.";
    default:
      return "GitHub rejected the token exchange. The server owner should review the safe OAuth diagnostic log.";
  }
}

async function fetchGitHubUser(accessToken: string): Promise<AuthenticatedUser | null> {
  let payload: unknown;
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "OIT-Medical-Research-MCP",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    payload = await readBoundedJson(response, 1_000_000);
  } catch {
    return null;
  }
  if (
    !isRecord(payload) ||
    (typeof payload.id !== "number" && typeof payload.id !== "string") ||
    typeof payload.login !== "string"
  ) {
    return null;
  }
  const displayName = typeof payload.name === "string" && payload.name.trim() ? payload.name : payload.login;
  const avatarUrl =
    typeof payload.avatar_url === "string" && isGitHubAvatar(payload.avatar_url)
      ? payload.avatar_url
      : undefined;
  return {
    userId: String(payload.id),
    login: payload.login,
    displayName,
    ...(avatarUrl ? { avatarUrl } : {}),
    identityProvider: "github"
  };
}

function authorizationErrorResponse(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) {
    return renderError("Invalid authorization request", "The MCP client sent an invalid request.");
  }
  if (!error.redirectUri) return renderError("Invalid authorization request", error.description);
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return redirectResponse(redirect.toString());
}

function redirectAuthorizationError(
  request: AuthRequest,
  code: string,
  description: string
): Response {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", code);
  redirect.searchParams.set("error_description", description);
  redirect.searchParams.set("state", request.state);
  if (request.issuer) redirect.searchParams.set("iss", request.issuer);
  return redirectResponse(redirect.toString());
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: location, "Cache-Control": "no-store" }
  });
}

function appendCookie(response: Response, cookie: string): Response {
  response.headers.append("Set-Cookie", cookie);
  return response;
}

function appendConsentCookieIfValid(response: Response, state: string): Response {
  try {
    return appendCookie(response, clearConsentCookie(state));
  } catch {
    return response;
  }
}

function appendOAuthCookieIfValid(response: Response, state: string): Response {
  try {
    return appendCookie(response, clearOAuthStateCookie(state));
  } catch {
    return response;
  }
}

function logAuthorizationStateFailure(event: string, reason: string): void {
  console.warn(JSON.stringify({ event, reason }));
}

function validateConfiguration(env: OAuthEnv): Response | null {
  if (
    !env.OAUTH_KV ||
    !env.USER_DATA_KV
  ) {
    return renderError("Sign-in not configured", "The server owner has not finished OAuth setup.", 503);
  }
  if (!env.COOKIE_ENCRYPTION_KEY || env.COOKIE_ENCRYPTION_KEY.length < 32) {
    return renderError("Sign-in not configured", "The server session secret is missing or too short.", 503);
  }
  if (!env.USER_DATA_ENCRYPTION_KEY || env.USER_DATA_ENCRYPTION_KEY.length < 32) {
    return renderError(
      "Sign-in not configured",
      "The encrypted user-settings secret is missing or too short.",
      503
    );
  }
  return null;
}

function validateGitHubConfiguration(env: OAuthEnv): Response | null {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return renderError(
      "GitHub sign-in not configured",
      "GitHub account management is optional and has not been configured for this server.",
      503
    );
  }
  return null;
}

function accountRedirect(request: Request, notice: string): Response {
  const destination = new URL("/account", request.url);
  destination.searchParams.set("notice", notice);
  const response = redirectResponse(destination.toString(), 303);
  response.headers.append("Set-Cookie", clearCsrfCookie());
  return response;
}

async function readSmallForm(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return null;
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) return null;
  const bytes = await readBoundedBody(request.body, MAX_FORM_BYTES);
  if (!bytes) return null;
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > limit) return null;
  const bytes = await readBoundedBody(response.body, limit);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function isGitHubAvatar(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
