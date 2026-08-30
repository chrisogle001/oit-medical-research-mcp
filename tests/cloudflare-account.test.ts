import type {
  AuthRequest as OAuthAuthorizationRequest,
  CompleteAuthorizationOptions,
  OAuthHelpers
} from "@cloudflare/workers-oauth-provider";
import { describe, expect, it, vi } from "vitest";
import { authHandler } from "../apps/cloudflare/src/auth-handler.js";
import {
  createConsentCookie,
  createCsrfCookie,
  createOAuthStateCookie,
  createSessionCookie
} from "../apps/cloudflare/src/security.js";
import {
  readUserProviderSettings,
  saveUserProviderSettings
} from "../apps/cloudflare/src/user-data.js";

const cookieSecret = "a-cookie-signing-secret-that-is-longer-than-thirty-two-characters";
const userDataSecret = "a-user-data-secret-that-is-also-longer-than-thirty-two-characters";
const user = { userId: "42", login: "researcher", displayName: "Researcher" };

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

function testEnv(storage: MemoryKv, oauth: Partial<OAuthHelpers> = {}): AuthEnv {
  return {
    OAUTH_KV: {} as KVNamespace,
    USER_DATA_KV: storage as unknown as KVNamespace,
    GITHUB_CLIENT_ID: "github-client",
    GITHUB_CLIENT_SECRET: "github-secret",
    COOKIE_ENCRYPTION_KEY: cookieSecret,
    USER_DATA_ENCRYPTION_KEY: userDataSecret,
    OAUTH_PROVIDER: oauth as OAuthHelpers
  } as unknown as AuthEnv;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0]!;
}

describe("Cloudflare account controls", () => {
  it("reuses a valid browser session when approving a new MCP client", async () => {
    const storage = new MemoryKv();
    const consentState = "consent-state";
    const oauthRequest: OAuthAuthorizationRequest = {
      responseType: "code",
      clientId: "claude-client",
      redirectUri: "https://claude.example/callback",
      scope: ["mcp:research"],
      state: "client-state"
    };
    const consent = cookiePair(
      await createConsentCookie(consentState, oauthRequest, cookieSecret)
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
      "__Host-MEDICAL_RESEARCH_CONSENT="
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("consumes GitHub callback state when the token exchange is rate limited", async () => {
    const storage = new MemoryKv();
    const oauthState = cookiePair(
      await createOAuthStateCookie(
        "github-state",
        { kind: "account", returnTo: "/account" },
        cookieSecret
      )
    );
    const request = new Request(
      "https://example.workers.dev/callback?state=github-state&code=temporary-code",
      { headers: { Cookie: oauthState } }
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ message: "rate limited" }, { status: 429 }));

    try {
      const response = await authHandler.fetch(request as AuthRequest, testEnv(storage));
      expect(response.status).toBe(503);
      expect(response.headers.get("Set-Cookie")).toContain(
        "__Host-MEDICAL_RESEARCH_OAUTH_STATE="
      );
      expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
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
