# lexoffice Integration

Scheduled InvoiceLeaf to lexoffice document synchronization.

## Features

- Scheduled document file sync (`syncInvoices`)
- Uploads document files to lexoffice `/files` API as `type=voucher`
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getApiKey('lexoffice')` (or `config.apiKey` fallback)
- `context.credentials.getConnectionInfo('lexoffice')`
- `context.state.get/set(...)`
- `context.mappings.get/upsert(...)`
- `context.data.listDocuments(...)`
- `context.data.getDocumentFile(...)`
- `context.data.patchDocumentIntegrationMeta(...)`
