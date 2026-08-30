# OIT - Medical Research MCP

A portable, read-only MCP server for searching medical literature and retrieving normalized metadata, abstracts, and lawful open full text. The same shared TypeScript research engine runs locally over stdio and remotely on Cloudflare Workers over Streamable HTTP.

## Initial sources

- PubMed and PubMed Central through NCBI E-utilities
- Europe PMC
- Crossref
- Unpaywall for lawful open-access resolution

The public MCP interface provides four interoperable, read-only tools:

- `search({ query, limit?, fromYear?, toYear?, journals?, fullTextOnly? })` returns up to the requested number of deduplicated results (subject to the server cap). Each result includes its stable ID, title, URL, identifiers, providers, repository-full-text availability, publication types, explicit preprint and retraction flags, and available journal, date, author, open-access, and citation metadata.
- `fetch({ id })` returns normalized text, metadata, identifiers, provenance, license, access links, publication types, and explicit preprint and retraction flags.
- `citations({ id, direction, limit? })` explores Europe PMC's open citation network. Use `direction: "references"` for papers cited by the article or `direction: "citedBy"` for papers that cite it. Results use the same stable, fetchable IDs as search.
- `annotations({ id, limit?, types?, sections?, providers? })` retrieves bounded, text-mined biomedical mentions for one article through Europe PMC. Results include the mentioned text, surrounding context, article section, annotation provider, and links to recognized database entities when available.

Search filters are optional and work the same way locally and on Cloudflare. `journals` accepts up to five journal titles or common abbreviations. `fullTextOnly: true` restricts results to articles whose full text can be retrieved lawfully from PMC or Europe PMC; it does not bypass publisher access controls.

This is a research retrieval tool, not medical advice. It does not bypass paywalls.

Preprints and retracted publications receive human-readable `statusWarnings` in addition to machine-readable `isPreprint` and `isRetracted` fields. An absent provider flag is never treated as proof of peer review, but the normalized public response always includes both booleans so clients do not have to infer them from titles.

Annotations are discovery aids, not verified evidence. Every annotation response states that automated or contributed text-mining signals may be incomplete or incorrect. Inputs accept up to five values for each filter and responses are capped at 100 mentions; unusually large upstream payloads are rejected before processing.

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

The first deployment creates separate OAuth and encrypted-user-settings KV bindings and reveals the Worker URL. Create a GitHub OAuth App with `https://<your-worker>/callback` as its callback, then store `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, a random `COOKIE_ENCRYPTION_KEY`, and a different random `USER_DATA_ENCRYPTION_KEY` with `wrangler secret put`. Both random secrets must contain at least 32 characters. Full instructions are in [Cloudflare deployment](docs/CLOUDFLARE.md).

Ogle IT Services hosts the production deployment at [oit-medical-research-mcp.oit-medical-research-mcp.workers.dev](https://oit-medical-research-mcp.oit-medical-research-mcp.workers.dev). Its remote MCP endpoint is `/mcp`; independent installations continue to use their own Cloudflare and GitHub accounts.

Configure a compatible client with `https://<your-worker>/mcp`. Anonymous access is rejected; the client discovers OAuth automatically and opens a browser consent flow. A valid eight-hour browser session is reused, so GitHub identity verification happens only when the user is not already signed in.

For a custom domain, set `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` as comma-separated Worker variables. Browser Origins remain validated by default.

## Configuration and privacy

Credentials are read only from the local process environment, Cloudflare secrets, or the hosted account page. They are never accepted as MCP tool arguments. A hosted user's optional NCBI key is encrypted with AES-GCM before it reaches KV and is never displayed again. The server does not log research queries, article identifiers, article text, GitHub names, or credentials. Hosted usage counters contain only a keyed account pseudonym, tool category, outcome, duration, and status.

See [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), [Threat model](docs/THREAT_MODEL.md), and [Cloudflare deployment](docs/CLOUDFLARE.md).

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

Run `npm run smoke:live` to verify the shared engine against live sources with journal, publication-year, and repository-full-text filters, article retrieval, publication-status labeling, a known retracted-publication fixture, a stable Europe PMC citation-network fixture, and filtered biomedical annotations.

## Status

The shared foundation, structured literature search, article retrieval, publication-type and safety-status labeling, open citation-network exploration, biomedical article annotations, local stdio transport, Cloudflare Streamable HTTP transport, OAuth 2.1 authorization, GitHub identity with signed-session reuse, consent flow, per-account rate limits, bounded upstream concurrency, privacy-safe usage counters, encrypted personal NCBI settings, grant revocation, and self-service account-data deletion are implemented.
