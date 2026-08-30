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
          search() and fetch()
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

The resolver merges independent provider records by DOI, PMID, PMCID, and normalized title. Search keeps each provider's relevance order as a fallback, then re-ranks the combined set by meaningful query-title overlap and independent-provider agreement. It returns full text only when it comes from a lawful repository endpoint. Otherwise it returns an abstract or metadata plus the best legal access location.

## Account and authorization layer

The hosted Worker acts as an OAuth 2.1 authorization server for MCP clients and uses GitHub only to establish user identity. GitHub access tokens are discarded after the profile lookup. OAuth grants, hashed tokens, and encrypted MCP authorization properties live in the `OAUTH_KV` binding. Short-lived consent and GitHub flow state stay browser-bound in signed secure cookies, while the account page uses a signed session and lets a user list and revoke client grants.

Each protected MCP request receives verified OAuth properties through the execution context. Research tool calls are keyed to a one-way HMAC account pseudonym, checked against the `MCP_ACCOUNT_RATE_LIMITER` binding, and counted in `USAGE_ANALYTICS`. Analytics fields contain only the tool category, outcome, duration, and HTTP status. Query text, article identifiers, article content, GitHub handles, and raw user IDs are excluded.

Optional personal provider settings live in a separate `USER_DATA_KV` namespace. The KV key is an HMAC pseudonym and the value is an AES-GCM envelope with the storage key bound as authenticated additional data. A personal NCBI key overrides the operator-wide NCBI key only for that account and request.

The shared research service schedules at most three provider operations concurrently. This stays below the Workers simultaneous outbound-connection limit while allowing one provider operation to make an additional sequential request when needed.
