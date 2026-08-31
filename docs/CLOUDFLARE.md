# Cloudflare deployment

Each person can install this project into their own Cloudflare account. GitHub is optional and is used only when the operator wants GitHub-backed account management. No Ogle IT Services Cloudflare credentials, GitHub OAuth credentials, or storage IDs are embedded in the repository.

## One-click deployment

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chrisogle001/oit-medical-research-mcp)

Cloudflare clones the repository into the installer's GitHub account, provisions the Worker and KV bindings, and asks for the two required encryption secrets described below. The root `wrangler.jsonc` is the independent-installation template and does not contain Ogle IT's custom domain.

## First deployment

1. Install dependencies with `npm install`.
2. Authenticate with `npx wrangler login`.
3. Run `npm run deploy`. Wrangler automatically creates the `OAUTH_KV` and `USER_DATA_KV` namespaces and prints the new Worker URL. The Analytics Engine dataset is created on its first event. Authorization will remain safely unavailable until the two encryption secrets below are configured.
4. Generate a random session-signing value of at least 32 characters and store it:

   ```powershell
   npx wrangler secret put COOKIE_ENCRYPTION_KEY --config wrangler.jsonc
   ```

5. Generate a different random value of at least 32 characters for personal provider settings and store it:

   ```powershell
   npx wrangler secret put USER_DATA_ENCRYPTION_KEY --config wrangler.jsonc
   ```

   Rotating this secret makes existing personal provider settings unreadable. Remove or migrate those settings before rotation.

6. Optionally store an operator-wide NCBI API key for higher NCBI request limits. A user's encrypted personal key takes precedence for that user's requests:

   ```powershell
   npx wrangler secret put NCBI_API_KEY --config wrangler.jsonc
   ```

7. Run `npm run deploy` again and configure a compatible MCP client with `https://<your-worker>/mcp`.

The client discovers OAuth automatically. A browser page identifies the requesting MCP client and asks for consent. Approval creates a random pseudonymous account and signed session; no email, password, or external identity account is required.

## Optional GitHub account management

GitHub is not part of the normal MCP connection path. To let users establish a recoverable GitHub-backed browser account from the hosted home page, create a GitHub OAuth App with the Worker URL as its homepage and `https://<your-worker>/callback` as its callback, then store its credentials:

```powershell
npx wrangler secret put GITHUB_CLIENT_ID --config wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
```

The GitHub access token is discarded immediately after the public-profile lookup. A GitHub error or rate limit never blocks the normal pseudonymous MCP authorization path.

## Local Worker development

Copy `.dev.vars.example` to `.dev.vars` and set the two encryption secrets. GitHub values are optional; when testing GitHub-backed account management, use a development OAuth App whose callback is `http://localhost:8787/callback` on the default port.

Then run:

```powershell
npm run dev:cloudflare
```

Local KV state, rate limiting, and Analytics Engine bindings are simulated by Wrangler and remain separate from deployed resources.

The committed rate-limit namespace IDs must be unique within a Cloudflare account. If `48101` or `48102` is already used by another Worker in your account, replace it with a different positive integer before deployment; bindings that share an ID also share counters.

## OIT production environment

The Ogle IT Services production deployment is available at:

- Base URL: `https://research.chrisogle.com`
- MCP endpoint: `https://research.chrisogle.com/mcp`
- GitHub callback: `https://research.chrisogle.com/callback`
- Account page: `https://research.chrisogle.com/account`

The legacy base URL `https://oit-medical-research-mcp.oit-medical-research-mcp.workers.dev` remains enabled so existing MCP connections continue to work. New connections should use the custom domain.

It uses production-only OAuth credentials, KV namespaces, encryption secrets, rate-limit counters, and the `oit_medical_research_usage` Analytics Engine dataset. The production configuration is `apps/cloudflare/wrangler.production.jsonc`; the root configuration remains portable for independent installers. The staging environment remains isolated from all production resources.

Deploy the hosted production service with:

```powershell
npm run deploy:cloudflare:production
```

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

Store the two required encryption secrets with `--env staging`, then deploy. The GitHub values are optional:

```powershell
npx wrangler secret put COOKIE_ENCRYPTION_KEY --env staging --config apps/cloudflare/wrangler.production.jsonc
npx wrangler secret put USER_DATA_ENCRYPTION_KEY --env staging --config apps/cloudflare/wrangler.production.jsonc
npm run deploy:cloudflare:staging
```

The non-interactive smoke test verifies health, anonymous rejection, and both OAuth discovery documents:

```powershell
$env:MCP_BASE_URL = "https://your-staging-worker.workers.dev"
npm run smoke:cloudflare
```

After an OAuth-state change, verify that overlapping browser flows remain isolated through pseudonymous authorization:

```powershell
npm run smoke:oauth-concurrency -- https://your-staging-worker.workers.dev
```

If an OAuth access token is available, set `MCP_OAUTH_ACCESS_TOKEN` to extend the smoke test through MCP initialization, tool discovery, and a live literature search. Do not commit or print that token.

## Custom domains

An independent operator can add a Cloudflare Custom Domain to the root `wrangler.jsonc`:

```jsonc
"workers_dev": true,
"routes": [
  {
    "pattern": "research.example.com",
    "custom_domain": true
  }
]
```

Set comma-separated `ALLOWED_HOSTNAMES` and `ALLOWED_ORIGIN_HOSTNAMES` variables to the exact permitted custom and Workers hostnames. Keeping `workers_dev` true preserves the original Workers URL. Cloudflare creates the DNS record and TLS certificate when the configuration is deployed; the hostname must not already have a conflicting CNAME record.

The OAuth resource and issuer are derived from the hostname used by the MCP client, so use the custom hostname consistently for new connections. Register its `/callback` URL only when optional GitHub account management is enabled.

## Operator responsibilities

Each independent deployment has its own OAuth clients, user grants, encrypted provider settings, pseudonymous usage dataset, secrets, and data lifecycle. The operator is responsible for Cloudflare security, optional GitHub OAuth security, provider terms, privacy disclosures, retention, rate limits, and deleting the Worker, both KV namespaces, and Analytics Engine dataset when decommissioning the service.
