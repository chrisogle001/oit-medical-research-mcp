# Architecture

## Goals

- One research engine across local and Cloudflare deployments.
- Small, goal-oriented MCP surface compatible with general MCP clients and deep-research workflows.
- Source adapters that can be added or replaced without changing tool contracts.
- Credentials outside prompts and tool arguments.
- Lawful full-text resolution with clear provenance and license metadata.

## Components

```text
MCP client
  ├─ stdio → apps/local
  └─ HTTPS → apps/cloudflare → OAuth 2.1 + consent
                    │             │
                    │             ├─ account rate limiter
                    │             ├─ encrypted user settings KV
                    │             └─ pseudonymous usage analytics
                    │
                    ▼
             packages/mcp
   search(), fetch(), citations(), annotations()
                    │
                    ▼
             packages/core
       normalize → dedupe → resolve
          │        │        │
       PubMed   Europe PMC  Crossref + Unpaywall
```

`packages/core` contains no Cloudflare-specific APIs. `packages/mcp` owns the stable tool contract. Each transport creates an isolated MCP server instance.

## Identifier and retrieval policy

Search results prefer PMCID, then PMID, then DOI, because PMCID is the strongest direct signal that lawful repository full text may exist. Fetch accepts any returned ID plus common PubMed, PMC, and DOI URLs.

The resolver merges independent provider records by DOI, PMID, PMCID, and normalized title. Author lists reconcile abbreviated and expanded provider forms while preserving distinct people who merely share a surname. Search keeps each provider's relevance order as a fallback, then re-ranks the combined set by meaningful query-title overlap and independent-provider agreement. Optional publication-year, journal, and repository-full-text filters are translated into each provider's native query syntax and verified again against normalized records before results are returned. Search results expose identifiers, provider provenance, explicit full-text status, publication types, preprint and retraction flags, and available bibliographic metadata so a client can assess a result before calling `fetch`.

Successful tool responses include safe provider diagnostics: attempted sources, contributing sources, sources that completed without a usable record, and source names with partial failures. Failures are classified into coarse categories such as rate limiting, timeout, network failure, and invalid response, with a safe status code when available. Raw upstream errors remain server-side. Transient transport and provider errors use bounded backoff; PubMed additionally detects NCBI error objects returned with HTTP 200.

Publication status is merged conservatively across providers. PubMed publication types and retraction relationships, Europe PMC source/type/correction metadata, and Crossref update relationships can establish a positive flag. A positive status from any provider survives record merging. Normalized search and fetch responses always expose boolean `isPreprint` and `isRetracted` fields, while positive statuses also include a human-readable warning. Crossref `posted-content` alone is not sufficient to claim an item is a preprint because that category also contains other posted works.

Citation lookup resolves any accepted article identifier through Europe PMC, then retrieves either its references or papers that cite it from Europe PMC's open citation network. Returned citation records are normalized into the same stable IDs and metadata shape as search results, so they can be passed directly to `fetch` or used for another citation hop.

Annotation lookup resolves any accepted article identifier through Europe PMC, then retrieves text-mined mentions for that article. Clients may filter by annotation type, article section, or contributing provider. Mention text, bounded surrounding context, section metadata, and public entity links are normalized into a compact response. The tool always identifies annotations as potentially incomplete or incorrect text-mining signals; they are not presented as curated clinical conclusions.

`fullTextOnly` means the article is indexed as retrievable from PMC or Europe PMC. Crossref metadata alone is not treated as proof of repository-full-text availability. Fetch follows a discovered PMCID for repository text and a discovered DOI for Crossref and Unpaywall enrichment, visiting each identifier at most once and preserving the concurrency limit for every pass. The resolver uses article text only when it comes from a lawful repository endpoint; otherwise it uses an abstract or metadata summary plus the best legal access location. Fetch serializes metadata and provider diagnostics before optional text, advertises the same object as MCP structured content, accepts `includeText: false` for compact metadata-only calls, and accepts a bounded `textLimit`. `fullTextStatus` distinguishes retrieved text, repository indexing, an open-access location, and no availability indication. `metadata.textType` describes the best resolved source, while `textInfo` describes what the response actually includes.

## Account and authorization layer

The hosted Worker acts as an OAuth 2.1 authorization server for MCP clients. After explicit consent it creates a cryptographically random pseudonymous user and signed browser session, so MCP authorization does not depend on an email, password, or external identity provider. GitHub remains optional for recoverable browser account management, and its access tokens are discarded after the profile lookup. A valid signed browser session is reused for later MCP-client approvals. OAuth grants, hashed tokens, encrypted MCP authorization properties, and namespaced short-lived authorization records live in the `OAUTH_KV` binding. Consent and optional GitHub handoff records use separate random state keys, expire after ten minutes, and are bound to the browser with state-specific HMAC-protected `__Host-` cookies. This allows overlapping client authorization attempts without one request replacing another; a validated record is deleted when consumed. The account page uses a signed session and lets a user list and revoke client grants.

Each protected MCP request receives verified OAuth properties through the execution context. Research tool calls are keyed to a one-way HMAC account pseudonym, checked against the `MCP_ACCOUNT_RATE_LIMITER` binding, and counted in `USAGE_ANALYTICS`. Analytics fields contain only the tool category, outcome, duration, and HTTP status. Query text, article identifiers, article content, account names, and raw user IDs are excluded.

Optional personal provider settings live in a separate `USER_DATA_KV` namespace. The KV key is an HMAC pseudonym and the value is an AES-GCM envelope with the storage key bound as authenticated additional data. A personal NCBI key overrides the operator-wide NCBI key only for that account and request.

The shared research service schedules at most three provider operations concurrently. This stays below the Workers simultaneous outbound-connection limit while allowing one provider operation to make an additional sequential request when needed.
