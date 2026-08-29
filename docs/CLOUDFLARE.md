# Cloudflare deployment

Each person can install this project into their own Cloudflare account; no Ogle IT Services Cloudflare credentials are embedded or required.

## First deployment

1. Install dependencies with `npm install`.
2. Authenticate with `npx wrangler login`.
3. Store a long random token with `npx wrangler secret put MCP_BEARER_TOKEN --config apps/cloudflare/wrangler.jsonc`.
4. Optionally store an NCBI key with `npx wrangler secret put NCBI_API_KEY --config apps/cloudflare/wrangler.jsonc`.
5. Run `npm run deploy:cloudflare`.

The MCP endpoint is `/mcp`; `/health` is an unauthenticated readiness check.

## Local Worker development

Create `apps/cloudflare/.dev.vars` (ignored by Git) with:

```dotenv
MCP_BEARER_TOKEN=replace-with-a-long-random-development-token
```

Then run `npm run dev:cloudflare`.

## Custom domains

The handler safely recognizes localhost and `workers.dev` by default. When adding a custom domain, set comma-separated `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` variables to the exact permitted hostnames. Do not use a wildcard for an unauthenticated endpoint.

## Shared hosted service

The current bearer-token model is intended for a private deployment controlled by one person or organization. A shared hosted edition requires the planned OAuth and account/settings service described in `docs/ARCHITECTURE.md`.
