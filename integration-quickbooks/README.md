# QuickBooks Integration

Scheduled InvoiceLeaf to QuickBooks Online synchronization.

## Features

- Scheduled invoice/bill sync (`syncInvoices`)
- Customer/vendor resolution in QuickBooks
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getAccessToken('quickbooks')`
- `context.credentials.getConnectionInfo('quickbooks')`
- `context.state.get/set(...)`
- `context.mappings.get/upsert(...)`
- `context.data.listDocuments(...)`
- `context.data.patchDocumentIntegrationMeta(...)`
