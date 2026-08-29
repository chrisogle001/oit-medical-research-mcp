# Security and privacy

## Current deployment model

- Local stdio inherits the permissions and environment of the person running it.
- The Cloudflare MCP endpoint requires a bearer secret. Missing configuration fails closed with HTTP 503; missing or incorrect credentials return HTTP 401.
- `/health` and `/` reveal only service status and connection instructions.
- Browser Origin and Host validation is delegated to the current Cloudflare Agents MCP handler. Custom domains require explicit allowlists.

## Secret handling

- Never commit `.env`, `.dev.vars`, bearer tokens, or provider credentials.
- Use environment variables locally and `wrangler secret put` on Cloudflare.
- Provider credentials are not MCP tool parameters and must never be pasted into a chat.
- Bearer tokens are compared by hashing both values and comparing the fixed-size results.

## Data handling

The application does not intentionally log search queries, article content, identifiers, or credentials. It sends queries and identifiers only to the selected literature providers. Each operator remains responsible for the providers' terms and privacy policies.

## Medical and content safety

Results are evidence-retrieval material, not clinical advice. The server preserves provenance and access metadata and does not bypass authentication, paywalls, robots restrictions, or licensing controls.

## Before a shared hosted launch

Replace the single deployment bearer token with standards-based OAuth and a separate account service. Encrypt per-user provider credentials, provide revocation and deletion, rate-limit by account, define retention, and complete a threat-model and abuse review.
