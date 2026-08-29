import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";
import { createMcpHandler } from "agents/mcp/server";

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "OIT - Medical Research MCP" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        name: "OIT - Medical Research MCP",
        mcpEndpoint: "/mcp",
        authentication: "Bearer token required"
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });

    if (!env.MCP_BEARER_TOKEN) {
      return Response.json(
        { error: "Server authentication is not configured." },
        { status: 503 }
      );
    }
    if (!(await isAuthorized(request, env.MCP_BEARER_TOKEN))) {
      return Response.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="medical-research-mcp"' }
        }
      );
    }

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
} satisfies ExportedHandler<Partial<Env>>;

async function isAuthorized(request: Request, expectedToken: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const [suppliedHash, expectedHash] = await Promise.all([
    sha256(suppliedToken),
    sha256(expectedToken)
  ]);
  if (suppliedHash.length !== expectedHash.length) return false;
  const workerSubtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBufferView, right: ArrayBufferView) => boolean;
  };
  if (typeof workerSubtle.timingSafeEqual === "function") {
    return workerSubtle.timingSafeEqual(suppliedHash, expectedHash);
  }

  // Node's Web Crypto implementation does not yet expose timingSafeEqual.
  // This fixed-length fallback is used by local tests; Workers use the native API above.
  let difference = 0;
  for (let index = 0; index < suppliedHash.length; index += 1) {
    difference |= suppliedHash[index]! ^ expectedHash[index]!;
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function list(value?: string): string[] | undefined {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}
