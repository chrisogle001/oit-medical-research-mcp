# OIT - Medical Research MCP

A portable, read-only MCP server for searching medical literature and retrieving normalized metadata, abstracts, and lawful open full text. The same shared TypeScript research engine runs locally over stdio and remotely on Cloudflare Workers over Streamable HTTP.

## Initial sources

- PubMed and PubMed Central through NCBI E-utilities
- Europe PMC
- Crossref
- Unpaywall for lawful open-access resolution

The public MCP interface intentionally starts with two interoperable tools:

- `search({ query })` returns deduplicated `{ id, title, url }` results.
- `fetch({ id })` returns normalized text, metadata, identifiers, provenance, license, and access links.

This is a research retrieval tool, not medical advice. It does not bypass paywalls.

## Local installation

Requirements: Node.js 22 or newer.

```powershell
npm install
npm run build
npm link
```

Add the local MCP server to a compatible client with the command:

```text
oit-medical-research-mcp
```

Optional environment variables are shown in `.env.example`. NCBI and Europe PMC work without API keys; an NCBI key raises the NCBI request limit.

For development:

```powershell
npm run start:local
```

## Deploy to your own Cloudflare account

Anyone with access to this repository can deploy an independent copy into their own Cloudflare account:

```powershell
npm install
npx wrangler login
npx wrangler secret put MCP_BEARER_TOKEN --config apps/cloudflare/wrangler.jsonc
npm run deploy:cloudflare
```

Use a long random bearer token. The Worker refuses MCP requests when the secret is absent. Configure an MCP client to call `https://<your-worker>/mcp` with `Authorization: Bearer <token>`.

For a custom domain, set `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` as comma-separated Worker variables. Browser Origins remain validated by default.

## Configuration and privacy

Credentials are read only from the local process environment or Cloudflare secrets. They are never accepted as MCP tool arguments. The server does not log research queries, article text, or credentials. Cloudflare invocation logging can record request metadata, but this application emits no raw-query logs.

See [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), and [Cloudflare deployment](docs/CLOUDFLARE.md).

## Development checks

```powershell
npm run typecheck
npm test
npm run check:cloudflare
```

## Status

This is the first validated foundation. Standard bearer authentication supports private self-hosting now. A separate browser-based account/settings service and standards-based OAuth authorization are planned before offering a shared hosted service to multiple users.
