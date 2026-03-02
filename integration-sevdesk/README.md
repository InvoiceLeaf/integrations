# sevDesk Integration

Scheduled InvoiceLeaf to sevDesk invoice synchronization.

## Features

- Scheduled invoice sync (`syncInvoices`)
- Contact resolution/creation in sevDesk
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getApiKey('sevdesk')`
- `context.credentials.getConnectionInfo('sevdesk')`
- `context.state.get/set(...)`
- `context.mappings.get/upsert(...)`
- `context.data.listDocuments(...)`
- `context.data.patchDocumentIntegrationMeta(...)`

## Setup Notes

- sevDesk uses API-key auth (`Authorization` header with the raw 32-char token).
- If your sevDesk account has no existing invoices, set `contactPersonId` and `addressCountryId` in integration config.
