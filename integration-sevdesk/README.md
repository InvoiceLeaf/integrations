# sevDesk Integration

Bi-directional InvoiceLeaf <-> sevDesk invoice synchronization.

## Features

- Scheduled outbound invoice sync (`syncInvoices`)
- Event-driven outbound sync for create/update (`syncInvoiceEvent`)
- Event-driven outbound cancellation on delete (`deleteInvoiceEvent`)
- Scheduled inbound sevDesk import (`pullInvoicesFromSevdesk`)
- Contact resolution/creation in sevDesk
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getApiKey('sevdesk')` (or `config.apiKey` fallback)
- `context.state.get/set(...)`
- `context.mappings.get/upsert/findByExternal(...)`
- `context.data.listDocuments(...)`
- `context.data.getDocument(...)`
- `context.data.importDocument(...)`
- `context.data.patchDocumentIntegrationMeta(...)`

## Setup Notes

- sevDesk uses API-key auth (`Authorization` header with the raw 32-char token).
- If the connection UI for API-key providers is unavailable, set `apiKey` directly in integration configuration.
- `targetStatus=200` is applied using `Invoice/{invoiceId}/sendBy` after invoice creation.
- If auto-discovery cannot find IDs from existing invoices, set `contactPersonId` and `addressCountryId` explicitly.
