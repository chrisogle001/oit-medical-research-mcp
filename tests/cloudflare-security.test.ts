import { describe, expect, it } from "vitest";
import {
  classifyGitHubOAuthFailure,
  githubOAuthFailureMessage
} from "../apps/cloudflare/src/auth-handler.js";
import { escapeHtml, renderGitHubContinue, renderHome } from "../apps/cloudflare/src/html.js";
import {
  createConsentCookie,
  createCsrfCookie,
  createOAuthStateCookie,
  createSessionCookie,
  parsePendingOAuthFlow,
  readConsentCookie,
  readSession,
  validateCsrf,
  validateOAuthStateCookie
} from "../apps/cloudflare/src/security.js";

const secret = "a-test-secret-that-is-definitely-longer-than-thirty-two-characters";

describe("Cloudflare OAuth security helpers", () => {
  it("escapes client-controlled consent content", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  it("allows form submissions only to the Worker", () => {
    const policy = renderHome("https://example.workers.dev").headers.get(
      "Content-Security-Policy"
    );
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("form-action 'self' https://github.com");
    expect(policy).not.toContain("form-action *");
  });

  it("uses an escaped normal link for the GitHub navigation step", async () => {
    const response = renderGitHubContinue(
      'https://github.com/login/oauth/authorize?state=x&client_id=<unsafe>'
    );
    const body = await response.text();
    expect(body).toContain("Sign in with GitHub");
    expect(body).toContain("client_id=&lt;unsafe&gt;");
    expect(body).not.toContain("client_id=<unsafe>");
  });

  it("classifies GitHub OAuth failures without exposing upstream details", () => {
    expect(classifyGitHubOAuthFailure({ error: "bad_verification_code" })).toBe(
      "bad_verification_code"
    );
    expect(classifyGitHubOAuthFailure({ error: "unexpected", error_description: "sensitive" })).toBe(
      "upstream_rejected"
    );
    expect(githubOAuthFailureMessage("incorrect_client_credentials")).toContain(
      "OAuth app credentials"
    );
    expect(githubOAuthFailureMessage("upstream_rejected")).not.toContain("sensitive");
  });

  it("accepts an intact signed session and rejects a tampered one", async () => {
    const setCookie = await createSessionCookie(
      { userId: "42", login: "researcher", displayName: "Researcher" },
      secret,
      1_000
    );
    const cookie = setCookie.split(";", 1)[0]!;
    const request = new Request("https://example.workers.dev/account", {
      headers: { Cookie: cookie }
    });
    await expect(readSession(request, secret, 2_000)).resolves.toMatchObject({ userId: "42" });

    const last = cookie.at(-1)!;
    const tampered = `${cookie.slice(0, -1)}${last === "a" ? "b" : "a"}`;
    const tamperedRequest = new Request("https://example.workers.dev/account", {
      headers: { Cookie: tampered }
    });
    await expect(readSession(tamperedRequest, secret, 2_000)).resolves.toBeNull();
  });

  it("requires the form CSRF token to match its secure cookie", async () => {
    const setCookie = createCsrfCookie("expected");
    const request = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });
    await expect(validateCsrf(request, "expected")).resolves.toBe(true);
    await expect(validateCsrf(request, "different")).resolves.toBe(false);
  });

  it("binds consent details to a signed, expiring browser cookie", async () => {
    const authorizationRequest = {
      responseType: "code",
      clientId: "client",
      redirectUri: "https://client.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const setCookie = await createConsentCookie(
      "consent-state",
      authorizationRequest,
      secret,
      1_000
    );
    const request = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });

    await expect(readConsentCookie(request, "consent-state", secret, 2_000)).resolves.toEqual(
      authorizationRequest
    );
    await expect(readConsentCookie(request, "wrong-state", secret, 2_000)).resolves.toBeNull();
    await expect(readConsentCookie(request, "consent-state", secret, 700_000)).resolves.toBeNull();
  });

  it("recovers a validated OAuth flow only from its matching signed state cookie", async () => {
    const flow = { kind: "account" as const, returnTo: "/account" as const };
    const setCookie = await createOAuthStateCookie("github-state", flow, secret, 1_000);
    const request = new Request("https://example.workers.dev/callback", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });

    await expect(
      validateOAuthStateCookie(request, "github-state", secret, 2_000)
    ).resolves.toEqual(flow);
    await expect(validateOAuthStateCookie(request, "other-state", secret, 2_000)).resolves.toBeNull();
  });

  it("validates stored OAuth flow shapes before use", () => {
    const flow = parsePendingOAuthFlow(
      JSON.stringify({
        kind: "mcp",
        request: {
          responseType: "code",
          clientId: "client",
          redirectUri: "https://client.example/callback",
          scope: ["mcp:research"],
          state: "state"
        }
      })
    );
    expect(flow?.kind).toBe("mcp");
    expect(parsePendingOAuthFlow('{"kind":"mcp","request":{}}')).toBeNull();
  });
});
