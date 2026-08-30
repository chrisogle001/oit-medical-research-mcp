# Hosted-service threat and abuse model

## Scope and assets

This review covers the Cloudflare Worker, its OAuth and account pages, MCP requests, literature-provider calls, `OAUTH_KV`, `USER_DATA_KV`, Analytics Engine, and the GitHub identity handoff. The local stdio deployment remains inside the installing user's security boundary.

Assets requiring protection are OAuth grants and tokens, cookie and user-data encryption secrets, personal NCBI API keys, account identity, research queries and article identifiers, and upstream-provider availability and quotas.

## Trust boundaries

- The browser crosses into the public consent and account UI.
- An MCP client crosses into the OAuth-protected `/mcp` endpoint.
- The Worker crosses into GitHub during identity verification and into PubMed/PMC, Europe PMC, Crossref, and Unpaywall during research.
- The Worker crosses into Cloudflare-managed KV, rate limiting, logs, and Analytics Engine through bindings.
- A repository installer becomes the independent operator of their deployment and secrets.

## Threats and controls

### Unauthorized MCP use or scope bypass

The OAuth provider validates bearer tokens, exact resource audiences, redirects, and S256 PKCE. The Worker additionally requires verified account properties and the `mcp:research` scope before invoking the MCP handler. Anonymous requests receive standards-based discovery rather than tool access.

### Confused-deputy authorization and CSRF

The application shows the requesting client and requested capability before identity verification. Consent state and the GitHub return flow are short-lived, browser-bound, signed cookies. Callback state is consumed on both success and failure to prevent reload-based replay. A valid signed session can authorize another MCP client without another GitHub exchange, reducing upstream token-request exposure. Account mutations use a separate short-lived CSRF cookie and POST. Account deletion also requires the signed-in GitHub login to be typed exactly.

### Credential disclosure

GitHub's temporary access token is used only for the public profile request and is discarded. OAuth token material is hashed or encrypted by the provider library. Personal NCBI keys are never tool arguments, log fields, or HTML values. They are encrypted with AES-GCM under a distinct Worker secret before KV storage, and the account-derived KV key is pseudonymous.

### Cross-account data access

The account ID comes only from verified OAuth properties or the signed account session. User-settings keys are derived server-side with keyed HMAC. The storage key is also AES-GCM authenticated data, so moving a ciphertext to another key causes decryption failure.

### Research privacy leakage

Application logs and usage events exclude query text, article identifiers, article content, GitHub names, raw account IDs, and credentials. Analytics uses a deployment-specific HMAC pseudonym and records only tool category, outcome, duration, and status. Queries and identifiers still necessarily leave the Worker for the selected literature providers.

### Resource exhaustion and upstream quota abuse

Research calls are limited to 30 per account per minute at the Cloudflare edge. MCP request inspection is bounded to 64 KiB, tool input lengths are bounded, result counts and returned text are capped, provider HTTP calls have timeouts and bounded reads, and no more than three provider operations run concurrently. Provider failures are isolated so a single unavailable source does not collapse the whole search.

### Dynamic registration and public-route abuse

OAuth dynamic client records expire after 30 days and the provider bounds registration bodies. The public authorization endpoints do not call literature sources before a valid grant is used. A production custom domain should add Cloudflare bot/WAF controls for distributed registration or sign-in abuse; IP-only Worker limits are intentionally not used as an identity substitute.

### Stored-data persistence and deletion

Access tokens last one hour; refresh grants and dynamic clients last 30 days. Users can revoke individual grants, remove a provider key, or delete hosted account data. Full account deletion is refused before mutation when more than ten grants are present, allowing the user to revoke some safely before retrying. Successful deletion revokes all listed grants, deletes the encrypted settings record, and clears the session.

### Supply chain and self-deployment

Dependencies are pinned in the lockfile, generated bindings are checked, deployment secrets are not committed, and deterministic tests run without live providers. Every self-deployer receives separate storage and secrets. The committed rate-limit namespace IDs must be changed if they collide with an existing ID in that Cloudflare account.

## Residual risks

- The Workers rate limiter is permissive and eventually consistent across Cloudflare locations. It is an abuse control, not a billing ledger or a hard global quota.
- KV is eventually consistent. A deleted encrypted provider setting can remain readable at another edge location for up to roughly 60 seconds, although OAuth grants are revoked and the browser session is cleared immediately.
- Analytics Engine retains pseudonymous events for three months and may sample high-volume series. Per-user erasure is not available because the dataset intentionally contains no reversible account identifier.
- A compromised Cloudflare account or Worker encryption secret can expose stored personal provider keys. Key separation, account MFA, least-privilege operator access, and secret rotation procedures remain operator responsibilities.
- Literature providers receive the queries or identifiers sent to them and can rate-limit, log, change, or fail independently.
- Distributed abuse of public OAuth registration or GitHub sign-in can require zone-level Cloudflare WAF/bot controls beyond Worker code.

## Review triggers

Repeat this review before adding write-capable tools, publisher credentials, clinical decision support, payments, shared institutional tenants, new identity providers, query history, embeddings, or any analytics field derived from research content.
