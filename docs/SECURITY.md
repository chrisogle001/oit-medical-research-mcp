# Security and privacy

## Current deployment model

- Local stdio inherits the permissions and environment of the person running it.
- The Cloudflare MCP endpoint requires an OAuth access token issued for that exact MCP resource. Anonymous requests return HTTP 401 with standards-based discovery metadata.
- After explicit MCP-client consent, the Worker creates a cryptographically random pseudonymous account. No email, password, or external identity account is required. Optional GitHub sign-in is limited to browser account management; its access token is discarded after the profile lookup and is never stored in MCP grants or exposed to tools.
- Consent and optional GitHub OAuth state are random, short-lived, and stored under namespaced per-request keys in `OAUTH_KV`. Each record is bound to the initiating browser with its own HMAC-protected `__Host-` cookie, so overlapping authorization attempts cannot overwrite one another. Validated records are deleted when consumed, and the matching cookie is cleared on success or failure. Consent remains a POST action; account mutations use a separate short-lived CSRF cookie.
- Account sessions are short-lived and HMAC-signed. A valid session completes later MCP consent requests under the same identity. Users can list and revoke their MCP client grants from `/account` while that signed session remains valid.
- Protected MCP requests require the `mcp:research` scope. Research tool calls are limited to 30 per account per minute and oversized MCP request bodies are rejected before protocol parsing.
- Provider fan-out is capped at three concurrent provider operations per research request.
- Provider diagnostics expose only configured provider names and coarse outcomes. Raw upstream response bodies, URLs containing credentials, and exception messages are not returned to MCP clients.
- `/health` and `/` reveal only service status and connection instructions.
- Browser Origin and Host validation is delegated to the current Cloudflare Agents MCP handler. Custom domains require explicit allowlists.

## Secret handling

- Never commit `.env`, `.dev.vars`, OAuth client secrets, session secrets, or provider credentials.
- Use environment variables locally and `wrangler secret put` on Cloudflare.
- Provider credentials are not MCP tool parameters and must never be pasted into a chat.
- Session, consent, and OAuth state signatures use Web Crypto HMAC-SHA-256; security-sensitive comparisons use fixed-size digests and timing-safe comparison where the runtime provides it.
- Personal provider settings use a separate `USER_DATA_ENCRYPTION_KEY`. Their KV keys are HMAC pseudonyms and their values are encrypted with AES-GCM and authenticated storage-key context. The encryption secret must differ from the browser-cookie secret.

## Data handling

The application does not intentionally log search queries, article content, article identifiers, account names, raw account IDs, or credentials. It sends queries and identifiers only to the selected literature providers. DOI and PMCID follow-up calls are derived only from normalized provider records and remain subject to the same bounded HTTP and response-size controls. Each operator remains responsible for the providers' terms and privacy policies.

Workers Analytics Engine receives one pseudonymous event per research tool call. The event contains a keyed account pseudonym, tool category, outcome, duration, and HTTP status. Cloudflare retains Analytics Engine data for three months. It is operational telemetry rather than billing-grade accounting because the platform may sample high-volume data.

Hosted users can remove their personal NCBI key or delete hosted account data from `/account`. Account deletion revokes all current MCP grants, removes encrypted provider settings, and clears the signed session. To keep deletion within the Workers Free-plan subrequest budget, users with more than ten active grants must revoke some clients first. KV deletion is eventually consistent and may take up to approximately 60 seconds to reach every Cloudflare location.

Retention defaults are:

- Consent and optional GitHub flow records and browser-binding cookies: 10 minutes.
- Account session cookie: 8 hours.
- OAuth access token: 1 hour.
- OAuth refresh token and grant: 30 days.
- Dynamically registered OAuth client: 30 days.
- Pseudonymous usage event: 3 months, enforced by Analytics Engine.
- Encrypted personal provider settings: until the user removes the key, deletes hosted account data, or the operator deletes the namespace.

## Medical and content safety

Results are evidence-retrieval material, not clinical advice. The server preserves provenance and access metadata and does not bypass authentication, paywalls, robots restrictions, or licensing controls.

The focused threat and abuse review is in [THREAT_MODEL.md](THREAT_MODEL.md). A production operator should still configure Cloudflare zone-level bot/WAF controls when using a custom domain, monitor rate-limit and upstream-failure events, protect both encryption secrets, and publish an operator-specific privacy notice and contact method.
