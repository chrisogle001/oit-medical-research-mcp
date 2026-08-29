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
npm run deploy:cloudflare
```

The first deployment creates the OAuth KV binding and reveals the Worker URL. Create a GitHub OAuth App with `https://<your-worker>/callback` as its callback, then store `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a random `COOKIE_ENCRYPTION_KEY` of at least 32 characters with `wrangler secret put`. Full instructions are in [Cloudflare deployment](docs/CLOUDFLARE.md).

Configure a compatible client with `https://<your-worker>/mcp`. Anonymous access is rejected; the client discovers OAuth automatically and opens a browser consent and GitHub sign-in flow.

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

The deterministic test suite does not call external literature services. To verify every live provider independently, including metadata, identifiers, abstracts, and lawful open-full-text resolution, run:

```powershell
npm run smoke:providers
```

This checks targeted searches and a stable cross-provider article through PubMed, Europe PMC, Crossref, and Unpaywall, and exits unsuccessfully if any individual source fails. `CONTACT_EMAIL` and `NCBI_API_KEY` are honored when set. Unpaywall is verified through DOI retrieval because it is a fetch-only enrichment source in this server.

## Status

The shared foundation, local stdio transport, Cloudflare Streamable HTTP transport, OAuth 2.1 authorization, GitHub identity, consent flow, and account access-revocation page are implemented. Encrypted per-user provider-key settings, rate limits, and the remaining hosted-service controls are the next product layer.
