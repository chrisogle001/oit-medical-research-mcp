import { describe, expect, it } from "vitest";
import {
  classifyGitHubOAuthFailure,
  githubOAuthFailureMessage
} from "../apps/cloudflare/src/auth-handler.js";
import { escapeHtml, renderGitHubContinue, renderHome } from "../apps/cloudflare/src/html.js";
import {
  consumeConsentRequest,
  consumeOAuthFlow,
  createCsrfCookie,
  createPseudonymousUser,
  createSessionCookie,
  parsePendingOAuthFlow,
  readSession,
  storeConsentRequest,
  storeOAuthFlow,
  validateCsrf
} from "../apps/cloudflare/src/security.js";

const secret = "a-test-secret-that-is-definitely-longer-than-thirty-two-characters";
const consentStateA = "consent_state_A_1234567890_abcdefghijk";
const consentStateB = "consent_state_B_1234567890_abcdefghijk";
const githubState = "github_state_1234567890_abcdefghijklmn";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

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
    expect(classifyGitHubOAuthFailure({ message: "sensitive" }, 429)).toBe("rate_limited");
    expect(githubOAuthFailureMessage("incorrect_client_credentials")).toContain(
      "OAuth app credentials"
    );
    expect(githubOAuthFailureMessage("rate_limited")).toContain("wait a few minutes");
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

  it("creates a random pseudonymous identity that survives a signed session", async () => {
    const user = createPseudonymousUser();
    expect(user).toMatchObject({
      userId: expect.stringMatching(/^pseudonymous_/u),
      login: expect.stringMatching(/^private-[a-z0-9_-]{12}$/u),
      displayName: "Private researcher",
      identityProvider: "pseudonymous"
    });
    expect(user.userId).not.toContain(":");
    const cookie = (await createSessionCookie(user, secret)).split(";", 1)[0]!;
    const request = new Request("https://example.workers.dev/account", {
      headers: { Cookie: cookie }
    });
    await expect(readSession(request, secret)).resolves.toMatchObject({
      userId: user.userId,
      identityProvider: "pseudonymous"
    });
  });

  it("requires the form CSRF token to match its secure cookie", async () => {
    const setCookie = createCsrfCookie("expected");
    const request = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });
    await expect(validateCsrf(request, "expected")).resolves.toBe(true);
    await expect(validateCsrf(request, "different")).resolves.toBe(false);
  });

  it("stores consent details server-side and consumes only a matching browser binding", async () => {
    const storage = new MemoryKv();
    const authorizationRequest = {
      responseType: "code",
      clientId: "client",
      redirectUri: "https://client.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const setCookie = await storeConsentRequest(
      storage as unknown as KVNamespace,
      consentStateA,
      authorizationRequest,
      secret,
      1_000
    );
    const request = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });

    await expect(
      consumeConsentRequest(
        request,
        storage as unknown as KVNamespace,
        consentStateA,
        secret,
        2_000
      )
    ).resolves.toEqual({ ok: true, value: authorizationRequest });
    await expect(
      consumeConsentRequest(
        request,
        storage as unknown as KVNamespace,
        consentStateA,
        secret,
        2_000
      )
    ).resolves.toEqual({ ok: false, reason: "missing_record" });
  });

  it("rejects missing and tampered consent bindings without consuming stored state", async () => {
    const storage = new MemoryKv();
    const authorizationRequest = {
      responseType: "code",
      clientId: "client",
      redirectUri: "https://client.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const setCookie = await storeConsentRequest(
      storage as unknown as KVNamespace,
      consentStateA,
      authorizationRequest,
      secret
    );
    const missingRequest = new Request("https://example.workers.dev/authorize");
    const cookie = setCookie.split(";", 1)[0]!;
    const tamperedRequest = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: `${cookie.slice(0, -1)}${cookie.endsWith("a") ? "b" : "a"}` }
    });

    await expect(
      consumeConsentRequest(
        missingRequest,
        storage as unknown as KVNamespace,
        consentStateA,
        secret
      )
    ).resolves.toEqual({ ok: false, reason: "missing_binding" });
    await expect(
      consumeConsentRequest(
        tamperedRequest,
        storage as unknown as KVNamespace,
        consentStateA,
        secret
      )
    ).resolves.toEqual({ ok: false, reason: "invalid_binding" });
    expect(storage.values.size).toBe(1);
  });

  it("keeps concurrent consent requests independent", async () => {
    const storage = new MemoryKv();
    const firstRequest = {
      responseType: "code",
      clientId: "first-client",
      redirectUri: "https://first.example/callback",
      scope: ["mcp:research"],
      state: "first-client-state"
    };
    const secondRequest = {
      ...firstRequest,
      clientId: "second-client",
      redirectUri: "https://second.example/callback",
      state: "second-client-state"
    };
    const [firstCookie, secondCookie] = await Promise.all([
      storeConsentRequest(
        storage as unknown as KVNamespace,
        consentStateA,
        firstRequest,
        secret
      ),
      storeConsentRequest(
        storage as unknown as KVNamespace,
        consentStateB,
        secondRequest,
        secret
      )
    ]);
    const browserRequest = new Request("https://example.workers.dev/authorize", {
      headers: {
        Cookie: `${firstCookie.split(";", 1)[0]!}; ${secondCookie.split(";", 1)[0]!}`
      }
    });

    await expect(
      consumeConsentRequest(
        browserRequest,
        storage as unknown as KVNamespace,
        consentStateA,
        secret
      )
    ).resolves.toEqual({ ok: true, value: firstRequest });
    await expect(
      consumeConsentRequest(
        browserRequest,
        storage as unknown as KVNamespace,
        consentStateB,
        secret
      )
    ).resolves.toEqual({ ok: true, value: secondRequest });
  });

  it("rejects expired consent state even if a test KV still contains it", async () => {
    const storage = new MemoryKv();
    const authorizationRequest = {
      responseType: "code",
      clientId: "client",
      redirectUri: "https://client.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const setCookie = await storeConsentRequest(
      storage as unknown as KVNamespace,
      consentStateA,
      authorizationRequest,
      secret,
      1_000
    );
    const request = new Request("https://example.workers.dev/authorize", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });

    await expect(
      consumeConsentRequest(
        request,
        storage as unknown as KVNamespace,
        consentStateA,
        secret,
        700_000
      )
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("recovers a validated OAuth flow only once from its matching state", async () => {
    const storage = new MemoryKv();
    const flow = { kind: "account" as const, returnTo: "/account" as const };
    const setCookie = await storeOAuthFlow(
      storage as unknown as KVNamespace,
      githubState,
      flow,
      secret,
      1_000
    );
    const request = new Request("https://example.workers.dev/callback", {
      headers: { Cookie: setCookie.split(";", 1)[0]! }
    });

    await expect(
      consumeOAuthFlow(
        request,
        storage as unknown as KVNamespace,
        githubState,
        secret,
        2_000
      )
    ).resolves.toEqual({ ok: true, value: flow });
    await expect(
      consumeOAuthFlow(
        request,
        storage as unknown as KVNamespace,
        githubState,
        secret,
        2_000
      )
    ).resolves.toEqual({ ok: false, reason: "missing_record" });
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
