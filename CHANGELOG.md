# Changelog

## 0.8.0 - 2026-09-01

- Added `cms_search_datasets` for discovery of official Data.CMS.gov public datasets.
- Added `cms_query_dataset` for bounded, filtered queries against public Medicare and Medicaid data without credentials.
- Kept CMS tabular data separate from peer-reviewed literature results and added source-interpretation guidance.

## 0.7.1 - 2026-08-30

- Replaced the homepage's direct MCP transport link with clear connection instructions.
- Added a browser-friendly explanation for direct navigation to the protected `/mcp` endpoint while preserving OAuth discovery for MCP clients.

## 0.7.0 - 2026-08-30

- License the project under the MIT License.
- Publish the hosted service at `research.chrisogle.com` while retaining the existing Workers URL.
- Prepare the local stdio server for public npm installation.
- Add GitHub CI, tagged release archives, and optional npm trusted publishing.
- Add a one-click Deploy to Cloudflare path for independent installations.

## 0.6.15

- Harden full-text access status classification and live provider failure testing.
