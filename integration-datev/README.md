# @invoiceleaf/integration-datev

DATEV integration for InvoiceLeaf focused on the `accounting:dxso-jobs` API.

## Features

- OAuth2/OIDC-based DATEV connection support for:
  - `datev-openid` (production)
  - `datev-openid-sandbox` (sandbox)
  - `datev-idp-next`
- Full dxso endpoint lifecycle actions:
  - list/get clients
  - create dxso job
  - upload job file (multipart)
  - get job status
  - finalize/cancel job
  - read protocol entries
- Auth discovery action for DATEV OIDC metadata
- Endpoint template action to inspect how to fill all path placeholders (`{client-id}`, `{job-id}`)
- Generic custom endpoint action for advanced use cases

## Required Setup

1. Connect one DATEV OAuth provider from the manifest external auth section.
2. Set `xDatevClientId` in integration config (recommended).
3. Optionally set `defaultClientId` to avoid passing `clientId` on every action.

## Config Highlights

- `environment`: `production` or `sandbox`
- `authProvider`: optional explicit provider override
- `apiBaseUrl`: optional override (defaults to DATEV dxso platform endpoints)
- `xDatevClientId`: sent as `X-DATEV-Client-Id` on each request
- `defaultImportType` + `defaultAccountingMonth`: defaults for dxso job creation

## Development

```bash
npm install
npm run typecheck
npm run build
```
