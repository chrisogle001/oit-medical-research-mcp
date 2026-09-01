# Releasing

Releases use semantic versions. The root package, workspace package manifests, MCP server version, and lockfile must carry the same version.

## Preflight

From a clean checkout, run:

```powershell
npm ci
npm run typecheck
npm test
npm run smoke:protocol
npm run cf-typegen:check
npm run check:cloudflare
npm run check:cloudflare:production
npm run check:cloudflare:staging
npm run package:check
```

The deterministic checks do not call the literature providers. Run `npm run smoke:providers` and `npm run smoke:failures` separately before a production deployment.

## First npm publication

The first publication creates the npm package and must be completed by an npm account with permission to publish the unscoped `oit-medical-research-mcp` name:

```powershell
npm login
npm publish
```

After the package exists, configure npm trusted publishing in the package settings:

- Provider: GitHub Actions
- Organization or user: `chrisogle001`
- Repository: `oit-medical-research-mcp`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Then create the GitHub repository variable `NPM_TRUSTED_PUBLISHING_ENABLED` with the value `true`. Future tagged releases publish through short-lived OpenID Connect credentials and do not need a stored npm token.

## Tagged releases

After CI passes on `main`, create and push the matching tag:

```powershell
git tag -a v0.8.0 -m "v0.8.0"
git push origin v0.8.0
```

The release workflow verifies that the tag matches `package.json`, reruns all deterministic checks, optionally publishes to npm, builds the installable `.tgz`, and creates a GitHub release containing that archive.
