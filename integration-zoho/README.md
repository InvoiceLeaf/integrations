# Zoho Books Integration

Scheduled InvoiceLeaf to Zoho Books synchronization.

## Features

- Scheduled invoice sync (`syncInvoices`)
- Customer resolution in Zoho Books
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getAccessToken('zoho-books')`
- `context.credentials.getConnectionInfo('zoho-books')`
- `context.state.get/set(...)`
- `context.mappings.get/upsert(...)`
- `context.data.listDocuments(...)`
- `context.data.patchDocumentIntegrationMeta(...)`
