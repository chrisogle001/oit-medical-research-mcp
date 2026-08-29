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

The resolver merges independent provider records by DOI, PMID, PMCID, and normalized title. It returns full text only when it comes from a lawful repository endpoint. Otherwise it returns an abstract or metadata plus the best legal access location.

## Account and authorization layer

The hosted Worker acts as an OAuth 2.1 authorization server for MCP clients and uses GitHub only to establish user identity. GitHub access tokens are discarded after the profile lookup. OAuth grants, hashed tokens, and encrypted MCP authorization properties live in the `OAUTH_KV` binding. Short-lived consent and GitHub flow state stay browser-bound in signed secure cookies, while the account page uses a signed session and lets a user list and revoke client grants.

The next product layer adds encrypted per-user provider credentials, per-account rate limits, deletion controls, and audit events that exclude research queries and article content.
