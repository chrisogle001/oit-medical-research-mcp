# OIT - Medical Research MCP

[![CI](https://github.com/chrisogle001/oit-medical-research-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrisogle001/oit-medical-research-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/oit-medical-research-mcp.svg)](https://www.npmjs.com/package/oit-medical-research-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A portable, read-only MCP server for searching medical literature, retrieving normalized metadata and lawful open full text, and querying public CMS datasets. The same shared TypeScript research engine runs locally over stdio and remotely on Cloudflare Workers over Streamable HTTP.

## Sources

- PubMed and PubMed Central through NCBI E-utilities
- Europe PMC
- Crossref
- Unpaywall for lawful open-access resolution
- Data.CMS.gov for public Medicare, Medicaid, provider, quality, utilization, and program datasets

The public MCP interface provides six interoperable, read-only tools:

- `search({ query, limit?, fromYear?, toYear?, journals?, fullTextOnly? })` returns up to the requested number of deduplicated results (subject to the server cap). Each result includes its stable ID, title, URL, identifiers, reconciled authors, contributing providers, explicit full-text status, publication types, preprint and retraction flags, and available journal, date, open-access, and citation metadata.
- `fetch({ id, includeText?, textLimit? })` returns metadata-first structured output with normalized identifiers, reconciled authors, DOI-follow-up enrichment, provider diagnostics, license, access links, explicit full-text retrieval status, publication types, and preprint and retraction flags. Text remains included by default; set `includeText: false` for a compact metadata-only response or use `textLimit` to request a bounded excerpt.
- `citations({ id, direction, limit? })` explores Europe PMC's open citation network. Use `direction: "references"` for papers cited by the article or `direction: "citedBy"` for papers that cite it. Results use the same stable, fetchable IDs as search.
- `annotations({ id, limit?, types?, sections?, providers? })` retrieves bounded, text-mined biomedical mentions for one article through Europe PMC. Results include the mentioned text, surrounding context, article section, annotation provider, and links to recognized database entities when available.
- `cms_search_datasets({ query, limit? })` searches the official Data.CMS.gov public catalog and returns the latest API-ready dataset UUID, update information, license, and CMS landing page.
- `cms_query_dataset({ datasetId, limit?, offset?, filters? })` returns a bounded page of public CMS dataset rows. Filters support exact and contains matching against column names returned by an initial query.

CMS tools are kept separate from literature search because public-use Medicare and Medicaid tables are not journal articles or patient-specific claims. Dataset fields, suppression rules, and interpretation vary; follow the returned CMS landing page and data dictionary before drawing conclusions.

Search filters are optional and work the same way locally and on Cloudflare. `journals` accepts up to five journal titles or common abbreviations. `fullTextOnly: true` restricts results to articles whose full text can be retrieved lawfully from PMC or Europe PMC; it does not bypass publisher access controls.

Every tool response includes `providerDiagnostics`. `attempted` identifies the configured sources consulted, `contributed` identifies sources present in the normalized result, `noRecord` identifies sources that completed without a usable contribution, and `failed` reports safe provider names when one or more upstream calls failed. `failures` adds a coarse reason such as `rate-limited`, `timeout`, or `invalid-response`, plus a status code when it is safe and available. Raw upstream errors are not exposed. A partial provider failure does not discard useful results from healthy sources. Transient provider and network errors are retried with bounded backoff; PubMed also recognizes NCBI rate-limit errors returned inside otherwise successful JSON responses.

`fullTextAvailable` remains for compatibility and means that the record has evidence of a retrievable location. The more precise `fullTextStatus` distinguishes `retrieved`, `repository-indexed`, `open-access-location`, and `not-indicated`. On `fetch`, `metadata.textType` identifies the best resolved source as lawful full text, an abstract, or metadata, while `textInfo` states whether text was included, how much was returned, and whether it was truncated. Europe PMC identifiers, PDF links, and licenses remain optional because upstream records do not supply them uniformly.

This is a research retrieval tool, not medical advice. It does not bypass paywalls.

Preprints and retracted publications receive human-readable `statusWarnings` in addition to machine-readable `isPreprint` and `isRetracted` fields. An absent provider flag is never treated as proof of peer review, but the normalized public response always includes both booleans so clients do not have to infer them from titles.

Annotations are discovery aids, not verified evidence. Every annotation response states that automated or contributed text-mining signals may be incomplete or incorrect. Inputs accept up to five values for each filter and responses are capped at 100 mentions; unusually large upstream payloads are rejected before processing.

## Local installation

Requirements: Node.js 22 or newer.

Run the published stdio server directly:

```text
npx -y oit-medical-research-mcp
```

Or install its command globally:

```powershell
npm install --global oit-medical-research-mcp
oit-medical-research-mcp
```

An MCP client configuration can use `npx` as the command and `-y`, `oit-medical-research-mcp` as its arguments. On Windows clients that require the executable suffix, use `npx.cmd`.

To build from source instead, clone the repository and run `npm install`, `npm run build`, and `npm link`.

Optional environment variables are shown in `.env.example`. NCBI and Europe PMC work without API keys; an NCBI key raises the NCBI request limit.

For development:

```powershell
npm run start:local
```

## Deploy to your own Cloudflare account

Use the one-click installer:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chrisogle001/oit-medical-research-mcp)

Cloudflare clones the public repository into the installer's account, provisions the Worker resources, and asks for two different random encryption secrets. GitHub credentials and literature-provider API keys are optional.

For a command-line deployment into your own Cloudflare account:

```powershell
npm install
npx wrangler login
npm run deploy
```

The first deployment creates separate OAuth and encrypted-user-settings KV bindings and reveals the Worker URL. Store a random `COOKIE_ENCRYPTION_KEY` and a different random `USER_DATA_ENCRYPTION_KEY` with `wrangler secret put`; both must contain at least 32 characters. GitHub is not required for MCP connections. A self-deployer may optionally configure a GitHub OAuth App for recoverable GitHub-backed account management. Full instructions are in [Cloudflare deployment](docs/CLOUDFLARE.md).

Ogle IT Services hosts the production deployment at [research.chrisogle.com](https://research.chrisogle.com). Its remote MCP endpoint is `https://research.chrisogle.com/mcp`. Use the homepage's connection instructions when adding it to an AI client; the endpoint is a protected machine-to-machine transport rather than a normal webpage. The previous Workers address remains active for existing client installations; new installations should use the custom domain. Independent installations use their own Cloudflare accounts and, optionally, their own GitHub OAuth Apps.

Configure a compatible client with `https://<your-worker>/mcp`. Unauthenticated bearer access is rejected; the client discovers OAuth automatically and opens a browser consent flow. Approval creates a cryptographically random pseudonymous account and signed browser session, so no email, password, or GitHub account is required. Concurrent client connection attempts are isolated with short-lived per-request state, and a valid eight-hour browser session is reused.

For a custom domain, set `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` as comma-separated Worker variables. Browser Origins remain validated by default.

## Configuration and privacy

Credentials are read only from the local process environment, Cloudflare secrets, or the hosted account page. They are never accepted as MCP tool arguments. A hosted user's optional NCBI key is encrypted with AES-GCM before it reaches KV and is never displayed again. The server does not log research queries, article identifiers, article text, account names, or credentials. Hosted usage counters contain only a keyed account pseudonym, tool category, outcome, duration, and status.

See [Architecture](docs/ARCHITECTURE.md), [Provider API evaluation](docs/PROVIDER_EVALUATION.md), [Security](docs/SECURITY.md), [Threat model](docs/THREAT_MODEL.md), [Cloudflare deployment](docs/CLOUDFLARE.md), and [Releasing](docs/RELEASING.md).

## License

This project is available under the [MIT License](LICENSE). It may be used, copied, modified, and redistributed, including commercially, as long as the copyright and license notice are retained. The software is provided without warranty.

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

Run `npm run smoke:cms` to verify public CMS catalog discovery and a one-row bounded dataset query without credentials.

## Status

The shared foundation, structured literature search, article retrieval, author reconciliation, discovered-DOI enrichment through Crossref and Unpaywall, explicit full-text status, provider contribution diagnostics, publication-type and safety-status labeling, open citation-network exploration, biomedical article annotations, bounded CMS public-dataset discovery and querying, local stdio transport, Cloudflare Streamable HTTP transport, OAuth 2.1 authorization, no-email pseudonymous identity, optional GitHub account management, signed-session reuse, consent flow, per-account rate limits, bounded upstream concurrency, privacy-safe usage counters, encrypted personal NCBI settings, grant revocation, and self-service account-data deletion are implemented.
