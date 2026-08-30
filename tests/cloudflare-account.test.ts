import type {
  AuthRequest as OAuthAuthorizationRequest,
  CompleteAuthorizationOptions,
  OAuthHelpers
} from "@cloudflare/workers-oauth-provider";
import { describe, expect, it, vi } from "vitest";
import { authHandler } from "../apps/cloudflare/src/auth-handler.js";
import {
  createCsrfCookie,
  createSessionCookie,
  storeConsentRequest,
  storeOAuthFlow
} from "../apps/cloudflare/src/security.js";
import {
  readUserProviderSettings,
  saveUserProviderSettings
} from "../apps/cloudflare/src/user-data.js";

const cookieSecret = "a-cookie-signing-secret-that-is-longer-than-thirty-two-characters";
const userDataSecret = "a-user-data-secret-that-is-also-longer-than-thirty-two-characters";
const user = { userId: "42", login: "researcher", displayName: "Researcher" };
const consentState = "consent_state_1234567890_abcdefghijklmn";
const githubState = "github_state_1234567890_abcdefghijklmn";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

type AuthEnv = Parameters<typeof authHandler.fetch>[1];
type AuthRequest = Parameters<typeof authHandler.fetch>[0];

async function authenticatedRequest(path: string, body: URLSearchParams): Promise<Request> {
  const csrfToken = "csrf-test-token";
  const session = (await createSessionCookie(user, cookieSecret)).split(";", 1)[0]!;
  const csrf = createCsrfCookie(csrfToken).split(";", 1)[0]!;
  body.set("csrf_token", csrfToken);
  return new Request(`https://example.workers.dev${path}`, {
    method: "POST",
    headers: {
      Cookie: `${session}; ${csrf}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
}

async function authenticatedGet(path: string): Promise<Request> {
  const session = (await createSessionCookie(user, cookieSecret)).split(";", 1)[0]!;
  return new Request(`https://example.workers.dev${path}`, { headers: { Cookie: session } });
}

function testEnv(
  storage: MemoryKv,
  oauth: Partial<OAuthHelpers> = {},
  githubConfigured = true
): AuthEnv {
  return {
    OAUTH_KV: storage as unknown as KVNamespace,
    USER_DATA_KV: storage as unknown as KVNamespace,
    ...(githubConfigured
      ? {
          GITHUB_CLIENT_ID: "github-client",
          GITHUB_CLIENT_SECRET: "github-secret"
        }
      : {}),
    COOKIE_ENCRYPTION_KEY: cookieSecret,
    USER_DATA_ENCRYPTION_KEY: userDataSecret,
    OAUTH_PROVIDER: oauth as OAuthHelpers
  } as unknown as AuthEnv;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0]!;
}

describe("Cloudflare account controls", () => {
  it("authorizes a new MCP client with a pseudonymous account and no GitHub request", async () => {
    const storage = new MemoryKv();
    const oauthRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "claude-client",
      redirectUri: "https://claude.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const consent = cookiePair(
      await storeConsentRequest(
        storage as unknown as KVNamespace,
        consentState,
        oauthRequest,
        cookieSecret
      )
    );
    let completed: CompleteAuthorizationOptions | null = null;
    const request = new Request(
      `https://example.workers.dev/authorize?consent_state=${consentState}`,
      {
        method: "POST",
        headers: {
          Cookie: consent,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ decision: "approve" })
      }
    );

    const response = await authHandler.fetch(
      request as AuthRequest,
      testEnv(storage, {
        async lookupClient(clientId) {
          return {
            clientId,
            clientName: "Claude",
            redirectUris: [oauthRequest.redirectUri],
            tokenEndpointAuthMethod: "none"
          };
        },
        async completeAuthorization(options) {
          completed = options;
          return { redirectTo: "https://claude.example/callback?code=issued" };
        }
      }, false)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://claude.example/callback?code=issued"
    );
    expect(completed).toMatchObject({
      request: oauthRequest,
      userId: expect.stringMatching(/^pseudonymous_/u),
      scope: ["mcp:research"],
      props: {
        identityProvider: "pseudonymous",
        displayName: "Private researcher"
      }
    });
    expect(response.headers.get("Set-Cookie")).toContain(
      "__Host-MEDICAL_RESEARCH_SESSION="
    );
    expect(response.headers.get("Set-Cookie")).toContain(
      `__Host-MEDICAL_RESEARCH_CONSENT_${consentState}=`
    );
  });

  it("replaces a legacy pseudonymous session before issuing an OAuth code", async () => {
    const storage = new MemoryKv();
    const oauthRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "chatgpt-client",
      redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
      scope: ["mcp:research"],
      state: "client-state",
      codeChallenge: "code-challenge",
      codeChallengeMethod: "S256"
    };
    const consent = cookiePair(
      await storeConsentRequest(
        storage as unknown as KVNamespace,
        consentState,
        oauthRequest,
        cookieSecret
      )
    );
    const legacySession = cookiePair(
      await createSessionCookie(
        {
          userId: "pseudonymous:legacy-user",
          login: "private-legacy-user",
          displayName: "Private researcher",
          identityProvider: "pseudonymous"
        },
        cookieSecret
      )
    );
    let completed: CompleteAuthorizationOptions | null = null;
    let completedUserId = "";
    const request = new Request(
      `https://example.workers.dev/authorize?consent_state=${consentState}`,
      {
        method: "POST",
        headers: {
          Cookie: `${consent}; ${legacySession}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ decision: "approve" })
      }
    );

    const response = await authHandler.fetch(
      request as AuthRequest,
      testEnv(storage, {
        async lookupClient(clientId) {
          return {
            clientId,
            clientName: "ChatGPT",
            redirectUris: [oauthRequest.redirectUri],
            tokenEndpointAuthMethod: "none"
          };
        },
        async completeAuthorization(options) {
          completed = options;
          completedUserId = options.userId;
          return { redirectTo: `${oauthRequest.redirectUri}?code=issued` };
        }
      }, false)
    );

    expect(response.status).toBe(302);
    expect(completed).toMatchObject({
      userId: expect.stringMatching(/^pseudonymous_/u),
      props: { identityProvider: "pseudonymous" }
    });
    expect(completedUserId).not.toContain(":");
    expect(response.headers.get("Set-Cookie")).toContain(
      "__Host-MEDICAL_RESEARCH_SESSION="
    );
  });

  it("reuses a valid browser session when approving a new MCP client", async () => {
    const storage = new MemoryKv();
    const oauthRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "claude-client",
      redirectUri: "https://claude.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const consent = cookiePair(
      await storeConsentRequest(
        storage as unknown as KVNamespace,
        consentState,
        oauthRequest,
        cookieSecret
      )
    );
    const session = cookiePair(await createSessionCookie(user, cookieSecret));
    let completed: CompleteAuthorizationOptions | null = null;
    const request = new Request(
      `https://example.workers.dev/authorize?consent_state=${consentState}`,
      {
        method: "POST",
        headers: {
          Cookie: `${consent}; ${session}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ decision: "approve" })
      }
    );

    const response = await authHandler.fetch(
      request as AuthRequest,
      testEnv(storage, {
        async lookupClient(clientId) {
          return {
            clientId,
            clientName: "Claude",
            redirectUris: [oauthRequest.redirectUri],
            tokenEndpointAuthMethod: "none"
          };
        },
        async completeAuthorization(options) {
          completed = options;
          return { redirectTo: "https://claude.example/callback?code=issued" };
        }
      })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://claude.example/callback?code=issued"
    );
    expect(completed).toMatchObject({
      request: oauthRequest,
      userId: user.userId,
      scope: ["mcp:research"]
    });
    expect(response.headers.get("Set-Cookie")).toContain(
      `__Host-MEDICAL_RESEARCH_CONSENT_${consentState}=`
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("opens account management directly for an existing pseudonymous session", async () => {
    const storage = new MemoryKv();
    const session = cookiePair(
      await createSessionCookie(
        {
          userId: "pseudonymous_test-user",
          login: "private-test-user",
          displayName: "Private researcher",
          identityProvider: "pseudonymous"
        },
        cookieSecret
      )
    );
    const response = await authHandler.fetch(
      new Request("https://example.workers.dev/login", {
        headers: { Cookie: session }
      }) as AuthRequest,
      testEnv(storage, {}, false)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.workers.dev/account");
  });

  it("completes overlapping MCP authorization requests without state collisions", async () => {
    const storage = new MemoryKv();
    const firstRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "chatgpt-client-first",
      redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
      scope: ["mcp:research"],
      state: "chatgpt-client-state-first",
      codeChallenge: "first-code-challenge",
      codeChallengeMethod: "S256",
      resource: "https://example.workers.dev/mcp"
    };
    const secondRequest: OAuthAuthorizationRequest = {
      ...firstRequest,
      clientId: "chatgpt-client-second",
      state: "chatgpt-client-state-second",
      codeChallenge: "second-code-challenge"
    };
    const pending = [firstRequest, secondRequest];
    const completed: CompleteAuthorizationOptions[] = [];
    const env = testEnv(storage, {
      async parseAuthRequest() {
        return pending.shift()!;
      },
      async lookupClient(clientId) {
        return {
          clientId,
          clientName: "ChatGPT",
          redirectUris: [firstRequest.redirectUri],
          tokenEndpointAuthMethod: "none"
        };
      },
      async completeAuthorization(options) {
        completed.push(options);
        return {
          redirectTo: `${options.request.redirectUri}?code=${options.request.clientId}`
        };
      }
    });

    const [firstPage, secondPage] = await Promise.all([
      authHandler.fetch(
        new Request("https://example.workers.dev/authorize?attempt=first") as AuthRequest,
        env
      ),
      authHandler.fetch(
        new Request("https://example.workers.dev/authorize?attempt=second") as AuthRequest,
        env
      )
    ]);
    const firstBody = await firstPage.text();
    const secondBody = await secondPage.text();
    const firstState = firstBody.match(/consent_state=([A-Za-z0-9_-]+)/u)?.[1];
    const secondState = secondBody.match(/consent_state=([A-Za-z0-9_-]+)/u)?.[1];
    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(firstState).not.toBe(secondState);

    const browserCookies = [
      cookiePair(firstPage.headers.get("Set-Cookie")!),
      cookiePair(secondPage.headers.get("Set-Cookie")!),
      cookiePair(await createSessionCookie(user, cookieSecret))
    ].join("; ");
    const approve = (state: string) =>
      new Request(`https://example.workers.dev/authorize?consent_state=${state}`, {
        method: "POST",
        headers: {
          Cookie: browserCookies,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ decision: "approve" })
      });

    const firstResult = await authHandler.fetch(approve(firstState!) as AuthRequest, env);
    const secondResult = await authHandler.fetch(approve(secondState!) as AuthRequest, env);

    expect(firstResult.status).toBe(302);
    expect(secondResult.status).toBe(302);
    expect(completed).toHaveLength(2);
    expect(completed.map((item) => item.request.clientId).sort()).toEqual([
      "chatgpt-client-first",
      "chatgpt-client-second"
    ]);
  });

  it("consumes GitHub callback state when the token exchange is rate limited", async () => {
    const storage = new MemoryKv();
    const oauthState = cookiePair(
      await storeOAuthFlow(
        storage as unknown as KVNamespace,
        githubState,
        { kind: "account", returnTo: "/account" },
        cookieSecret
      )
    );
    const request = new Request(
      `https://example.workers.dev/callback?state=${githubState}&code=temporary-code`,
      { headers: { Cookie: oauthState } }
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ message: "rate limited" }, { status: 429 }));

    try {
      const response = await authHandler.fetch(request as AuthRequest, testEnv(storage));
      expect(response.status).toBe(503);
      expect(response.headers.get("Set-Cookie")).toContain(
        `__Host-MEDICAL_RESEARCH_OAUTH_STATE_${githubState}=`
      );
      expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("recovers a pending MCP authorization when GitHub rate limits the exchange", async () => {
    const storage = new MemoryKv();
    const oauthRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "claude-client",
      redirectUri: "https://claude.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const oauthState = cookiePair(
      await storeOAuthFlow(
        storage as unknown as KVNamespace,
        githubState,
        { kind: "mcp", request: oauthRequest },
        cookieSecret
      )
    );
    let completed: CompleteAuthorizationOptions | null = null;
    const request = new Request(
      `https://example.workers.dev/callback?state=${githubState}&code=temporary-code`,
      { headers: { Cookie: oauthState } }
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ message: "rate limited" }, { status: 429 }));

    try {
      const response = await authHandler.fetch(
        request as AuthRequest,
        testEnv(storage, {
          async lookupClient(clientId) {
            return {
              clientId,
              clientName: "Claude",
              redirectUris: [oauthRequest.redirectUri],
              tokenEndpointAuthMethod: "none"
            };
          },
          async completeAuthorization(options) {
            completed = options;
            return { redirectTo: "https://claude.example/callback?code=recovered" };
          }
        })
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        "https://claude.example/callback?code=recovered"
      );
      expect(completed).toMatchObject({
        userId: expect.stringMatching(/^pseudonymous_/u),
        props: { identityProvider: "pseudonymous" }
      });
      expect(response.headers.get("Set-Cookie")).toContain(
        "__Host-MEDICAL_RESEARCH_SESSION="
      );
      expect(response.headers.get("Set-Cookie")).toContain(
        `__Host-MEDICAL_RESEARCH_OAUTH_STATE_${githubState}=`
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("stores a personal NCBI key only after session and CSRF validation", async () => {
    const storage = new MemoryKv();
    const request = await authenticatedRequest(
      "/account/settings/ncbi",
      new URLSearchParams({ action: "save", api_key: "abc12345_secure" })
    );
    const response = await authHandler.fetch(request as AuthRequest, testEnv(storage));

    expect(response.status).toBe(303);
    await expect(
      readUserProviderSettings(storage as unknown as KVNamespace, user.userId, userDataSecret)
    ).resolves.toEqual({ ncbiApiKey: "abc12345_secure" });
  });

  it("shows only the configured state and never renders a stored NCBI key", async () => {
    const storage = new MemoryKv();
    const apiKey = "abc12345_never_render";
    await saveUserProviderSettings(
      storage as unknown as KVNamespace,
      user.userId,
      userDataSecret,
      { ncbiApiKey: apiKey }
    );
    const request = await authenticatedGet("/account");
    const response = await authHandler.fetch(
      request as AuthRequest,
      testEnv(storage, {
        async listUserGrants() {
          return {
            items: [
              {
                id: "grant-seconds",
                clientId: "client-seconds",
                userId: user.userId,
                scope: ["mcp:research"],
                metadata: {},
                createdAt: Math.floor(Date.UTC(2026, 7, 29) / 1000)
              }
            ]
          };
        }
      })
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Configured");
    expect(body).toContain("2026");
    expect(body).not.toContain("1970");
    expect(body).not.toContain(apiKey);
  });

  it("revokes grants and removes encrypted settings during account deletion", async () => {
    const storage = new MemoryKv();
    await saveUserProviderSettings(
      storage as unknown as KVNamespace,
      user.userId,
      userDataSecret,
      { ncbiApiKey: "abc12345_secure" }
    );
    const revoked: string[] = [];
    const request = await authenticatedRequest(
      "/account/delete",
      new URLSearchParams({ confirmation: user.login })
    );
    const response = await authHandler.fetch(
      request as AuthRequest,
      testEnv(storage, {
        async listUserGrants() {
          return {
            items: [
              {
                id: "grant-1",
                clientId: "client-1",
                userId: user.userId,
                scope: ["mcp:research"],
                metadata: {},
                createdAt: Date.now()
              },
              {
                id: "grant-2",
                clientId: "client-2",
                userId: user.userId,
                scope: ["mcp:research"],
                metadata: {},
                createdAt: Date.now()
              }
            ]
          };
        },
        async revokeGrant(grantId) {
          revoked.push(grantId);
        }
      })
    );

    expect(response.status).toBe(303);
    expect(revoked).toEqual(["grant-1", "grant-2"]);
    await expect(
      readUserProviderSettings(storage as unknown as KVNamespace, user.userId, userDataSecret)
    ).resolves.toBeNull();
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
