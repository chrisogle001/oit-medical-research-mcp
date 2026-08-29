# Security and privacy

## Current deployment model

- Local stdio inherits the permissions and environment of the person running it.
- The Cloudflare MCP endpoint requires an OAuth access token issued for that exact MCP resource. Anonymous requests return HTTP 401 with standards-based discovery metadata.
- GitHub establishes user identity after an explicit MCP-client consent screen. The GitHub access token is discarded after the profile lookup and is never stored in MCP grants or exposed to tools.
- Consent and GitHub OAuth state are random, short-lived, and bound to the browser in HMAC-protected `__Host-` cookies, avoiding immediate-read races in distributed KV. Consent remains a POST action; account mutations use separate short-lived CSRF cookies.
- Account sessions are short-lived and HMAC-signed. Users can list and revoke their MCP client grants from `/account`.
- `/health` and `/` reveal only service status and connection instructions.
- Browser Origin and Host validation is delegated to the current Cloudflare Agents MCP handler. Custom domains require explicit allowlists.

## Secret handling

- Never commit `.env`, `.dev.vars`, OAuth client secrets, session secrets, or provider credentials.
- Use environment variables locally and `wrangler secret put` on Cloudflare.
- Provider credentials are not MCP tool parameters and must never be pasted into a chat.
- Session, consent, and OAuth state signatures use Web Crypto HMAC-SHA-256; security-sensitive comparisons use fixed-size digests and timing-safe comparison where the runtime provides it.

## Data handling

The application does not intentionally log search queries, article content, identifiers, or credentials. It sends queries and identifiers only to the selected literature providers. Each operator remains responsible for the providers' terms and privacy policies.

## Medical and content safety

Results are evidence-retrieval material, not clinical advice. The server preserves provenance and access metadata and does not bypass authentication, paywalls, robots restrictions, or licensing controls.

## Before a shared hosted launch

Encrypt per-user provider credentials, add account deletion and per-account rate limits, define retention, and complete a threat-model and abuse review. OAuth client revocation is already available in the account page.
