# Cloudflare deployment

Each person can install this project into their own Cloudflare and GitHub accounts. No Ogle IT Services Cloudflare credentials, GitHub OAuth credentials, or storage IDs are embedded in the repository.

## First deployment

1. Install dependencies with `npm install`.
2. Authenticate with `npx wrangler login`.
3. Run `npm run deploy:cloudflare`. Wrangler automatically creates the `OAUTH_KV` and `USER_DATA_KV` namespaces and prints the new Worker URL. The Analytics Engine dataset is created on its first event. Sign-in will remain safely unavailable until the next steps are complete.
4. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
5. Use the Worker URL as the homepage and `https://<your-worker>/callback` as the authorization callback URL.
6. Store the GitHub client ID and generated client secret:

   ```powershell
   npx wrangler secret put GITHUB_CLIENT_ID --config apps/cloudflare/wrangler.jsonc
   npx wrangler secret put GITHUB_CLIENT_SECRET --config apps/cloudflare/wrangler.jsonc
   ```

7. Generate a random session-signing value of at least 32 characters and store it:

   ```powershell
   npx wrangler secret put COOKIE_ENCRYPTION_KEY --config apps/cloudflare/wrangler.jsonc
   ```

8. Generate a different random value of at least 32 characters for personal provider settings and store it:

   ```powershell
   npx wrangler secret put USER_DATA_ENCRYPTION_KEY --config apps/cloudflare/wrangler.jsonc
   ```

   Rotating this secret makes existing personal provider settings unreadable. Remove or migrate those settings before rotation.

9. Optionally store an operator-wide NCBI API key for higher NCBI request limits. A user's encrypted personal key takes precedence for that user's requests:

   ```powershell
   npx wrangler secret put NCBI_API_KEY --config apps/cloudflare/wrangler.jsonc
   ```

10. Run `npm run deploy:cloudflare` again and configure a compatible MCP client with `https://<your-worker>/mcp`.

The client discovers OAuth automatically. A browser page identifies the requesting MCP client and asks for consent, then shows a same-origin handoff page before navigating to GitHub for identity verification. The GitHub access token is discarded immediately after the identity lookup.

## Local Worker development

Copy `apps/cloudflare/.dev.vars.example` to `apps/cloudflare/.dev.vars` and add credentials for a development GitHub OAuth App. Its callback URL should be `http://localhost:8787/callback` when the development server uses the default port.

Then run:

```powershell
npm run dev:cloudflare
```

Local KV state, rate limiting, and Analytics Engine bindings are simulated by Wrangler and remain separate from deployed resources.

The committed rate-limit namespace IDs must be unique within a Cloudflare account. If `48101` or `48102` is already used by another Worker in your account, replace it with a different positive integer before deployment; bindings that share an ID also share counters.

## OIT staging environment

The repository includes an isolated `staging` Worker and OAuth KV namespace:

- Base URL: `https://oit-medical-research-mcp-staging.oit-medical-research-mcp.workers.dev`
- MCP endpoint: `/mcp`
- OAuth callback: `/callback`
- Account page: `/account`
- Unauthenticated readiness check: `/health`

The staging GitHub OAuth App must use this exact callback URL:

```text
https://oit-medical-research-mcp-staging.oit-medical-research-mcp.workers.dev/callback
```

Store its four secrets with `--env staging`, then deploy:

```powershell
npx wrangler secret put GITHUB_CLIENT_ID --env staging --config apps/cloudflare/wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging --config apps/cloudflare/wrangler.jsonc
npx wrangler secret put COOKIE_ENCRYPTION_KEY --env staging --config apps/cloudflare/wrangler.jsonc
npx wrangler secret put USER_DATA_ENCRYPTION_KEY --env staging --config apps/cloudflare/wrangler.jsonc
npm run deploy:cloudflare:staging
```

The non-interactive smoke test verifies health, anonymous rejection, and both OAuth discovery documents:

```powershell
$env:MCP_BASE_URL = "https://your-staging-worker.workers.dev"
npm run smoke:cloudflare
```

If an OAuth access token is available, set `MCP_OAUTH_ACCESS_TOKEN` to extend the smoke test through MCP initialization, tool discovery, and a live literature search. Do not commit or print that token.

## Custom domains

Set comma-separated `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` variables to the exact permitted hostnames. The OAuth resource and issuer are derived from the hostname used by the MCP client, so use one canonical hostname consistently and register its `/callback` URL with GitHub.

## Operator responsibilities

Each independent deployment has its own OAuth clients, user grants, encrypted provider settings, pseudonymous usage dataset, secrets, and data lifecycle. The operator is responsible for Cloudflare and GitHub account security, provider terms, privacy disclosures, retention, rate limits, and deleting the Worker, both KV namespaces, and Analytics Engine dataset when decommissioning the service.
