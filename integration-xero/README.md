# Xero Integration

Scheduled InvoiceLeaf to Xero invoice synchronization.

## Features

- Scheduled invoice sync (`syncInvoices`)
- Contact resolution/creation in Xero
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getAccessToken('xero')`
- `context.credentials.getConnectionInfo('xero')`
- `context.state.get/set(...)`
- `context.mappings.get/upsert(...)`
- `context.data.listDocuments(...)`
- `context.data.patchDocumentIntegrationMeta(...)`

