import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { createMcpHandler } from "agents/mcp/server";
import { authHandler } from "./auth-handler.js";

const RESEARCH_SCOPE = "mcp:research";

export const mcpApiHandler = {
  async fetch(request, env, context): Promise<Response> {
    const allowedHostnames = list(env.ALLOWED_HOSTNAMES);
    const allowedOriginHostnames = list(env.ALLOWED_ORIGIN_HOSTNAMES);
    const handler = createMcpHandler(
      () =>
        createMedicalResearchMcpServer({
          ...(env.CONTACT_EMAIL ? { contactEmail: env.CONTACT_EMAIL } : {}),
          ...(env.NCBI_API_KEY ? { ncbiApiKey: env.NCBI_API_KEY } : {})
        }),
      {
        route: "/mcp",
        ...(allowedHostnames ? { allowedHostnames } : {}),
        ...(allowedOriginHostnames ? { allowedOriginHostnames } : {})
      }
    );
    return handler(request, env, context);
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
    return provider.fetch(request, env, context);
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
