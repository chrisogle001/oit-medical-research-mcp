# Security and privacy

## Current deployment model

- Local stdio inherits the permissions and environment of the person running it.
- The Cloudflare MCP endpoint requires an OAuth access token issued for that exact MCP resource. Anonymous requests return HTTP 401 with standards-based discovery metadata.
- GitHub establishes user identity after an explicit MCP-client consent screen. The GitHub access token is discarded after the profile lookup and is never stored in MCP grants or exposed to tools.
- Consent and GitHub OAuth state are random, short-lived, and bound to the browser in HMAC-protected `__Host-` cookies, avoiding immediate-read races in distributed KV. OAuth callback state is cleared on success or failure so a callback cannot be replayed by reloading it. Consent remains a POST action; account mutations use separate short-lived CSRF cookies.
- Account sessions are short-lived and HMAC-signed. A valid session completes later MCP consent requests without repeating the upstream GitHub token exchange. Users can list and revoke their MCP client grants from `/account`.
- Protected MCP requests require the `mcp:research` scope. Research tool calls are limited to 30 per account per minute and oversized MCP request bodies are rejected before protocol parsing.
- Provider fan-out is capped at three concurrent provider operations per research request.
- `/health` and `/` reveal only service status and connection instructions.
- Browser Origin and Host validation is delegated to the current Cloudflare Agents MCP handler. Custom domains require explicit allowlists.

## Secret handling

- Never commit `.env`, `.dev.vars`, OAuth client secrets, session secrets, or provider credentials.
- Use environment variables locally and `wrangler secret put` on Cloudflare.
- Provider credentials are not MCP tool parameters and must never be pasted into a chat.
- Session, consent, and OAuth state signatures use Web Crypto HMAC-SHA-256; security-sensitive comparisons use fixed-size digests and timing-safe comparison where the runtime provides it.
- Personal provider settings use a separate `USER_DATA_ENCRYPTION_KEY`. Their KV keys are HMAC pseudonyms and their values are encrypted with AES-GCM and authenticated storage-key context. The encryption secret must differ from the browser-cookie secret.

## Data handling

The application does not intentionally log search queries, article content, article identifiers, GitHub names, raw account IDs, or credentials. It sends queries and identifiers only to the selected literature providers. Each operator remains responsible for the providers' terms and privacy policies.

Workers Analytics Engine receives one pseudonymous event per research tool call. The event contains a keyed account pseudonym, tool category, outcome, duration, and HTTP status. Cloudflare retains Analytics Engine data for three months. It is operational telemetry rather than billing-grade accounting because the platform may sample high-volume data.

Hosted users can remove their personal NCBI key or delete hosted account data from `/account`. Account deletion revokes all current MCP grants, removes encrypted provider settings, and clears the signed session. To keep deletion within the Workers Free-plan subrequest budget, users with more than ten active grants must revoke some clients first. KV deletion is eventually consistent and may take up to approximately 60 seconds to reach every Cloudflare location.

Retention defaults are:

- Consent and GitHub flow cookies: 10 minutes.
- Account session cookie: 8 hours.
- OAuth access token: 1 hour.
- OAuth refresh token and grant: 30 days.
- Dynamically registered OAuth client: 30 days.
- Pseudonymous usage event: 3 months, enforced by Analytics Engine.
- Encrypted personal provider settings: until the user removes the key, deletes hosted account data, or the operator deletes the namespace.

## Medical and content safety

Results are evidence-retrieval material, not clinical advice. The server preserves provenance and access metadata and does not bypass authentication, paywalls, robots restrictions, or licensing controls.

The focused threat and abuse review is in [THREAT_MODEL.md](THREAT_MODEL.md). A production operator should still configure Cloudflare zone-level bot/WAF controls when using a custom domain, monitor rate-limit and upstream-failure events, protect both encryption secrets, and publish an operator-specific privacy notice and contact method.
