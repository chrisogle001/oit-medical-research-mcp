# Provider API evaluation

Reviewed: 2026-09-01

This document records the integration boundary for CMS, Springer Nature, and Elsevier. Provider terms and quotas can change; re-check the linked official documentation before enabling a new production provider.

## CMS

Status: implemented for public Data.CMS.gov datasets.

- The [Data.CMS.gov API](https://data.cms.gov/api-docs) is a public REST/JSON API and does not require an API key for its public-use datasets.
- The public catalog is available at [data.cms.gov/data.json](https://data.cms.gov/data.json).
- Dataset rows use `https://data.cms.gov/data-api/v1/dataset/{dataset_uuid}/data` with JSON:API-style filters plus `size` and `offset` pagination.
- CMS documents a maximum page size of 5,000 rows. This project intentionally caps MCP responses at 100 rows and five filters.
- The integration does not access Blue Button, BCDA, AB2D, or other beneficiary/organization-authorized claims APIs.

Implemented tools:

- `cms_search_datasets` searches titles, descriptions, themes, and keywords, then returns the latest API distribution.
- `cms_query_dataset` validates the dataset UUID, bounds pagination, safely encodes exact or contains filters, and returns columns with public-use rows.

## Springer Nature

Status: suitable for a future open-access pilot after credentials and terms confirmation.

- All endpoints require a key obtained through the [Springer Nature Developer Portal](https://dev.springernature.com/); see its [authentication instructions](https://dev.springernature.com/docs/quick-start/authentication/).
- New integrations should use the versioned [Meta API](https://dev.springernature.com/docs/api-endpoints/meta-api/) at `https://api.springernature.com/meta/v2/json` for metadata discovery.
- The Open Access API may return openly licensed full text. Any reuse must follow the individual article license.
- The [Full Text API](https://dev.springernature.com/docs/api-endpoints/fulltext-api/) is available only where a special TDM agreement permits access. Its legacy host must be replaced with `api.springernature.com` before 2026-08-07.
- Published basic-plan limits are 100 requests/minute and 500 requests/day for Meta and Open Access. Higher limits and full-text TDM require a paid or institutional arrangement; see [rate limits](https://dev.springernature.com/docs/rate-limit-details/rate-limits/) and [subscription models](https://dev.springernature.com/subscription/).
- Springer Nature's [API terms](https://dev.springernature.com/terms-conditions/) restrict abstract reproduction and institutional TDM storage. A public hosted MCP must not expose subscription full text or copyrighted abstracts without explicit permission.

Recommended production boundary:

1. Start with open-access records only.
2. Preserve DOI, publisher URL, license, and provider provenance.
3. Return full text only when the record carries a compatible open-access license.
4. Store the API key as a Cloudflare secret, never as a tool argument.
5. Obtain Springer Nature confirmation that the public hosted MCP use case is covered before enabling it.

Required before implementation: a Springer Nature account/API key and confirmation of the plan and public-service permissions.

## Elsevier

Status: do not enable on the public hosted MCP without Elsevier approval.

- Anyone may request a key at the [Elsevier Developer Portal](https://dev.elsevier.com/), but full access depends on institutional subscriptions and the approved use case.
- Relevant endpoints include Scopus Search at `https://api.elsevier.com/content/search/scopus`, ScienceDirect Search v2 at `https://api.elsevier.com/content/search/sciencedirect`, and article retrieval at `https://api.elsevier.com/content/article/doi/{doi}`.
- Published standard-key limits include 20,000 Scopus Search requests/week at 9 requests/second, 10,000 Abstract Retrieval requests/week at 9 requests/second, 20,000 ScienceDirect Search v2 requests/week at 2 requests/second, and 50,000 Article Retrieval requests/week at 10 requests/second. Check the current [quota table](https://dev.elsevier.com/api_key_settings.html) before deployment.
- The [Elsevier use policies](https://dev.elsevier.com/policy.html) classify this server's combined-provider search pattern as federated search. That use case requires subscriptions for participating organizations, limits users to authorized subscribers, prohibits permanent indexing except temporary caching, and may require a direct vendor license.
- The current public MCP uses server-side calls and does not verify institutional Elsevier entitlement, so a normal self-service API key is not sufficient for broad production access.

Required before implementation: an Elsevier API key, the relevant institutional subscription or commercial agreement, and written confirmation that public/server-side MCP federated search is authorized. If approved, the first implementation should expose bibliographic metadata and links only; full text should remain entitlement-checked and disabled by default.
