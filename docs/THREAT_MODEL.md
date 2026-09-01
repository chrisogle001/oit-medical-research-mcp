# Hosted-service threat and abuse model

## Scope and assets

This review covers the Cloudflare Worker, its OAuth and account pages, MCP requests, literature-provider calls, `OAUTH_KV`, `USER_DATA_KV`, Analytics Engine, pseudonymous account creation, and the optional GitHub identity handoff. The local stdio deployment remains inside the installing user's security boundary.

Assets requiring protection are OAuth grants and tokens, cookie and user-data encryption secrets, personal NCBI API keys, account identity, research queries and article identifiers, and upstream-provider availability and quotas.

## Trust boundaries

- The browser crosses into the public consent and account UI.
- An MCP client crosses into the OAuth-protected `/mcp` endpoint.
- The Worker crosses into GitHub only during optional account identity verification; into PubMed/PMC, Europe PMC, Crossref, and Unpaywall during literature research; and into Data.CMS.gov for public dataset discovery and bounded queries.
- The Worker crosses into Cloudflare-managed KV, rate limiting, logs, and Analytics Engine through bindings.
- A repository installer becomes the independent operator of their deployment and secrets.

## Threats and controls

### Unauthorized MCP use or scope bypass

The OAuth provider validates bearer tokens, exact resource audiences, redirects, and S256 PKCE. The Worker additionally requires server-issued account properties and the `mcp:research` scope before invoking the MCP handler. Unauthenticated requests receive standards-based discovery rather than tool access. The default account identifier is generated from 256 bits of cryptographic randomness after browser consent.

### Confused-deputy authorization and CSRF

The application shows the requesting client and requested capability before creating a pseudonymous identity. Consent state and the optional GitHub return flow are short-lived records in `OAUTH_KV`, namespaced by independently generated state tokens, and bound to the initiating browser with state-specific signed cookies. This isolates concurrent authorization attempts. A validated record is deleted and its cookie is cleared on both success and failure to limit reload-based replay. A valid signed session can authorize another MCP client under the same identity. Account mutations use a separate short-lived CSRF cookie and POST. Account deletion also requires the displayed account login to be typed exactly.

### Credential disclosure

When optional GitHub account management is used, its temporary access token is used only for the public profile request and is discarded. OAuth token material is hashed or encrypted by the provider library. Personal NCBI keys are never tool arguments, log fields, or HTML values. They are encrypted with AES-GCM under a distinct Worker secret before KV storage, and the account-derived KV key is pseudonymous.

### Cross-account data access

The account ID comes only from cryptographically generated or verified OAuth properties or the signed account session. User-settings keys are derived server-side with keyed HMAC. The storage key is also AES-GCM authenticated data, so moving a ciphertext to another key causes decryption failure.

### Research privacy leakage

Application logs and usage events exclude query text, article identifiers, article content, account names, raw account IDs, and credentials. Analytics uses a deployment-specific HMAC pseudonym and records only tool category, outcome, duration, and status. Queries and identifiers still necessarily leave the Worker for the selected literature providers.

### Resource exhaustion and upstream quota abuse

Research calls are limited to 30 per account per minute at the Cloudflare edge. MCP request inspection is bounded to 64 KiB, tool input lengths are bounded, result counts and returned text are capped, provider HTTP calls have timeouts, bounded reads, and bounded retry backoff, and no more than three provider operations run concurrently. Fetch follow-ups visit each discovered DOI or PMCID at most once. Provider failures are isolated so a single unavailable source does not collapse the whole request; public diagnostics contain only provider names, coarse failure reasons, and safe HTTP status codes, never raw exceptions.

### Dynamic registration and public-route abuse

OAuth dynamic client records expire after 30 days and the provider bounds registration bodies. The public authorization endpoints do not call literature sources before a valid grant is used. A production custom domain should add Cloudflare bot/WAF controls for distributed registration or pseudonymous-account creation abuse; IP-only Worker limits are intentionally not used as an identity substitute.

### Stored-data persistence and deletion

Access tokens last one hour; refresh grants and dynamic clients last 30 days. Users can revoke individual grants, remove a provider key, or delete hosted account data. Full account deletion is refused before mutation when more than ten grants are present, allowing the user to revoke some safely before retrying. Successful deletion revokes all listed grants, deletes the encrypted settings record, and clears the session.

### Supply chain and self-deployment

Dependencies are pinned in the lockfile, generated bindings are checked, deployment secrets are not committed, and deterministic tests run without live providers. Every self-deployer receives separate storage and secrets. The committed rate-limit namespace IDs must be changed if they collide with an existing ID in that Cloudflare account.

## Residual risks

- The Workers rate limiter is permissive and eventually consistent across Cloudflare locations. It is an abuse control, not a billing ledger or a hard global quota.
- KV is eventually consistent. A newly created authorization record may not be immediately visible if consecutive requests are routed to different Cloudflare locations, and a consumed record or deleted encrypted provider setting can remain visible elsewhere for up to roughly 60 seconds. State-specific signed browser bindings remain required even when a KV record is visible; OAuth grants are revoked and the browser session is cleared immediately during account deletion.
- Analytics Engine retains pseudonymous events for three months and may sample high-volume series. Per-user erasure is not available because the dataset intentionally contains no reversible account identifier.
- A compromised Cloudflare account or Worker encryption secret can expose stored personal provider keys. Key separation, account MFA, least-privilege operator access, and secret rotation procedures remain operator responsibilities.
- Literature providers receive the queries or identifiers sent to them and can rate-limit, log, change, or fail independently.
- Pseudonymous identities intentionally remove third-party-account friction. Distributed creation of OAuth clients or pseudonymous accounts can therefore require zone-level Cloudflare WAF/bot controls beyond Worker code.
- Optional GitHub outages or rate limits do not block MCP authorization. An already-started MCP GitHub callback falls back to a new pseudonymous identity if its token or profile request fails.

## Review triggers

Repeat this review before adding write-capable tools, publisher credentials, clinical decision support, payments, shared institutional tenants, new identity providers, query history, embeddings, or any analytics field derived from research content.
