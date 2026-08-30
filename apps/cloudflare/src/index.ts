import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { createMcpHandler } from "agents/mcp/server";
import { authHandler } from "./auth-handler.js";
import {
  classifyMcpRequest,
  mcpErrorResponse,
  writeUsageEvent
} from "./mcp-guard.js";
import { parseAuthenticatedUser } from "./security.js";
import { accountPseudonym, readUserProviderSettings } from "./user-data.js";

const RESEARCH_SCOPE = "mcp:research";
const VERIFIED_OAUTH_CONTEXT = Symbol.for(
  "cloudflare.workers-oauth-provider.verified-context.v1"
);

export const mcpApiHandler = {
  async fetch(request, env, context): Promise<Response> {
    const user = parseAuthenticatedUser(
      (context as ExecutionContext & { props?: unknown }).props
    );
    if (!user) return mcpErrorResponse(401, "A valid account authorization is required.");
    if (!hasResearchScope(context)) {
      return mcpErrorResponse(403, "The authorization does not include medical research access.");
    }
    if (
      !env.USER_DATA_KV ||
      !env.USER_DATA_ENCRYPTION_KEY ||
      env.USER_DATA_ENCRYPTION_KEY.length < 32 ||
      !env.MCP_ACCOUNT_RATE_LIMITER
    ) {
      return mcpErrorResponse(503, "The hosted account controls are not configured.");
    }

    const classification = await classifyMcpRequest(request);
    if (classification.kind === "too_large") {
      return mcpErrorResponse(413, "The MCP request is too large.");
    }

    const startedAt = Date.now();
    let account: string | undefined;
    let personalNcbiApiKey: string | undefined;
    if (classification.kind === "tool_call") {
      account = await accountPseudonym(user.userId, env.USER_DATA_ENCRYPTION_KEY);
      let success: boolean;
      try {
        ({ success } = await env.MCP_ACCOUNT_RATE_LIMITER.limit({ key: account }));
      } catch {
        console.error(JSON.stringify({ event: "account_rate_limiter_failed" }));
        writeUsageEvent(env.USAGE_ANALYTICS, {
          account,
          toolName: classification.toolName,
          outcome: "rejected",
          durationMs: Date.now() - startedAt,
          status: 503
        });
        return mcpErrorResponse(503, "Research request protection is temporarily unavailable.");
      }
      if (!success) {
        writeUsageEvent(env.USAGE_ANALYTICS, {
          account,
          toolName: classification.toolName,
          outcome: "rate_limited",
          durationMs: Date.now() - startedAt,
          status: 429
        });
        console.warn(JSON.stringify({ event: "mcp_rate_limited" }));
        return mcpErrorResponse(429, "Too many research requests. Please try again shortly.", 60);
      }
      try {
        const settings = await readUserProviderSettings(
          env.USER_DATA_KV,
          user.userId,
          env.USER_DATA_ENCRYPTION_KEY
        );
        personalNcbiApiKey = settings?.ncbiApiKey;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "provider_settings_read_failed",
            error: error instanceof Error ? error.message : "Unknown error"
          })
        );
        writeUsageEvent(env.USAGE_ANALYTICS, {
          account,
          toolName: classification.toolName,
          outcome: "rejected",
          durationMs: Date.now() - startedAt,
          status: 503
        });
        return mcpErrorResponse(503, "Personal provider settings are temporarily unavailable.");
      }
    }

    const allowedHostnames = list(env.ALLOWED_HOSTNAMES);
    const allowedOriginHostnames = list(env.ALLOWED_ORIGIN_HOSTNAMES);
    const handler = createMcpHandler(
      () =>
        createMedicalResearchMcpServer({
          ...(env.CONTACT_EMAIL ? { contactEmail: env.CONTACT_EMAIL } : {}),
          ...(personalNcbiApiKey || env.NCBI_API_KEY
            ? { ncbiApiKey: personalNcbiApiKey || env.NCBI_API_KEY }
            : {})
        }),
      {
        route: "/mcp",
        ...(allowedHostnames ? { allowedHostnames } : {}),
        ...(allowedOriginHostnames ? { allowedOriginHostnames } : {})
      }
    );
    const response = await handler(request, env, context);
    if (classification.kind === "tool_call" && account) {
      writeUsageEvent(env.USAGE_ANALYTICS, {
        account,
        toolName: classification.toolName,
        outcome: response.ok ? "completed" : "rejected",
        durationMs: Date.now() - startedAt,
        status: response.status
      });
    }
    return response;
  }
} satisfies ExportedHandler<Env>;

const worker = {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);
    const allowedHostnames = list(env.ALLOWED_HOSTNAMES);
    if (allowedHostnames && !allowedHostnames.includes(url.hostname)) {
      return Response.json({ error: "Unrecognized host." }, { status: 421 });
    }

    const origin = url.origin;
    const provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpApiHandler,
      defaultHandler: authHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientRegistrationTTL: 2_592_000,
      accessTokenTTL: 3_600,
      refreshTokenTTL: 2_592_000,
      clientIdMetadataDocumentEnabled: true,
      allowPlainPKCE: false,
      scopesSupported: [RESEARCH_SCOPE],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: [RESEARCH_SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "OIT Medical Research MCP"
      }
    });
    try {
      return await provider.fetch(request, env, context);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "worker_request_failed",
          path: url.pathname,
          errorType: error instanceof Error ? error.name : "UnknownError"
        })
      );
      return Response.json(
        { error: "The request could not be completed." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
  }
} satisfies ExportedHandler<Env>;

export default worker;

function list(value?: string): string[] | undefined {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}

function hasResearchScope(context: ExecutionContext): boolean {
  const verified = (context as ExecutionContext & Record<symbol, unknown>)[
    VERIFIED_OAUTH_CONTEXT
  ];
  return (
    typeof verified === "object" &&
    verified !== null &&
    "scopes" in verified &&
    Array.isArray(verified.scopes) &&
    verified.scopes.includes(RESEARCH_SCOPE)
  );
}
