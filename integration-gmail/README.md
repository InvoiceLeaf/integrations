# Gmail Integration

OAuth-based Gmail attachment import for InvoiceLeaf.

## Features

- Scheduled crawl for PDF attachments (`crawlPdfAttachments`)
- On-demand crawl action (`crawl-now`)
- Gmail connection diagnostics (`testConnection`)
- Dedupe using message + attachment fingerprint via `context.state`
- Automatic document import via `context.data.importDocument(...)`
