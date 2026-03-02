# GetMyInvoices Integration

Bi-directional InvoiceLeaf <-> GetMyInvoices document synchronization.

## Features

- Scheduled outbound InvoiceLeaf -> GetMyInvoices sync (`syncInvoices`)
- Event-driven outbound sync for document create/update (`syncInvoiceEvent`)
- Event-driven outbound deletion for document delete (`deleteInvoiceEvent`)
- Scheduled inbound GetMyInvoices -> InvoiceLeaf import (`pullDocumentsFromGetmyinvoices`)
- Inbound deleted-document reconciliation via `/documents/deleted`
- Company resolution/creation in GetMyInvoices
- Idempotent mapping via `context.mappings`
- Sync checkpoint persistence via `context.state`
- Document sync metadata writeback via `context.data.patchDocumentIntegrationMeta(...)`
- Connection diagnostics (`testConnection`)

## Runtime Requirements

- `context.credentials.getApiKey('getmyinvoices')` (or `config.apiKey` fallback)
- `context.state.get/set(...)`
- `context.mappings.get/upsert/findByExternal(...)`
- `context.data.listDocuments(...)`
- `context.data.getDocument(...)`
- `context.data.getDocumentFile(...)`
- `context.data.importDocument(...)`
- `context.data.patchDocumentIntegrationMeta(...)`

## Setup Notes

- GetMyInvoices uses API-key auth (`X-API-KEY` header).
- If the API-key connection UI is unavailable, set `apiKey` directly in integration configuration.
- Outbound updates use `PUT /documents/{documentUid}` (metadata update), while new uploads use `POST /documents`.
- Inbound import downloads remote files via `GET /documents/{documentUid}/file`.
